// NeuroTab — Assistente de voz: ouvir um comando, executar e responder (falando e na tela).
import { SEARCH_ENGINES, hostOf } from '../lib/store.js';
import * as Brain from '../lib/brain.js';
import { isConfigured, ask as aiAsk, interpretCommand } from '../lib/ai.js';
import { $, h, toast, startDictation, hasDictation, speak, miniMarkdown, beep } from '../lib/ui.js';
import { tasksSummary, runCommand, commandLang } from '../lib/assistant.js';
import { t, tIn, LOCALE } from '../lib/i18n.js';
import { setHTML } from '../lib/safe-html.js';
import { getWeather } from '../lib/weather.js';
import { S } from './state.js';
import { ctx, brainExtras } from './context.js';
import { localAnswer, placesText } from '../lib/places.js';
import { showRoute } from './route-request.js';
import { whileWakePaused, paintWake } from './wake.js';
import { assistantName, isCancel, commandWindowMs } from '../lib/wake-word.js';
import { onEscape } from '../lib/window-manager.js';
import { greetingFor, isGoodbye, silenceClock, silenceMs, FAREWELL, STATE_LABEL } from '../lib/voice-session.js';
import { createViz, openMeter, vizStyle } from '../lib/voice-viz.js';
import { newHistory, addTurn, historyMessages, conversationNote, isSaveThat, modeRequest } from '../lib/chat-history.js';
import { openMeeting, meetingLive, paintModeFabs } from './modes.js';

// Tela de voz: estado atual, visual (canvas) e microfone do visual; conversa em andamento (#39, #40).
const V = { viz: null, meter: null, meterP: null, conv: null };
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function setState(s) {
  const ov = $('#voice');
  ov.dataset.state = s;
  const lab = $('#voiceState');
  if (lab) lab.textContent = STATE_LABEL[s] ? t(STATE_LABEL[s]) : '';
  V.viz?.setState(s);
}

function ensureViz() {
  const style = vizStyle(S.data.settings.voiceViz);
  const orb = $('#voice .voice-orb');
  orb.classList.toggle('viz', style !== 'classic');
  if (style === 'classic') { dropViz(); return; }
  const reduced = reducedMotion();
  if (!V.viz) {
    const c = h('canvas', { class: 'voice-viz', 'aria-hidden': 'true' });
    orb.prepend(c); // antes do 🎙: o ícone fica por cima
    V.viz = createViz(c, { style, reduced, meter: V.meter });
    c.dataset.style = style;
  } else V.viz.setStyle(style);
  if (!V.meter && !V.meterP && S.data.settings.voiceVizMic !== false && !reduced) {
    V.meterP = openMeter().then((m) => {
      V.meterP = null;
      if ($('#voice').hidden || !V.viz) { m?.close(); return; }
      V.meter = m;
      V.viz.setMeter(m);
    });
  }
}

function dropViz() {
  V.viz?.destroy();
  V.viz = null;
  $('#voice canvas.voice-viz')?.remove();
  V.meter?.close();
  V.meter = null;
}

/** Fecha a tela de voz e libera o microfone do visual. */
function hideVoice() {
  $('#voice').hidden = true;
  $('#voice').classList.remove('conversation', 'listening');
  setState('closed');
  dropViz();
}
const hideLater = (ms) => setTimeout(() => { if (!S.voiceSession && !V.conv) hideVoice(); }, ms);

/** Fala com o visual pulsando a cada palavra. */
function say(text, lang) {
  setState('speaking');
  const done = speak(text, { ...S.data.settings, voiceLang: lang || voiceCode() }, { onWord: () => V.viz?.pulse(), onStart: () => V.viz?.pulse() });
  if (V.conv?.kind === 'chat' && S.data.settings.voiceChatBargeIn) bargeIn(done);
  return done;
}

/** Interromper falando por cima (opção do modo conversa): voz alta e contínua no microfone corta a fala. */
async function bargeIn(done) {
  let own = null;
  const m = V.meter || (own = await openMeter());
  if (!m) return;
  let loud = 0;
  let over = false;
  done.then(() => { over = true; });
  while (!over) {
    await new Promise((r) => setTimeout(r, 100));
    loud = m.level() > 0.45 ? loud + 1 : 0;
    if (loud >= 4) { speechSynthesis.cancel(); break; }
  }
  own?.close();
}

export function voiceApi(o = {}) {
  const eng = SEARCH_ENGINES[S.data.settings.searchEngine] || SEARCH_ENGINES.google;
  return {
    capture: (p) => ctx.capture(p),
    aiReady: () => isConfigured(S.data.settings),
    // No modo conversa (#44) vai junto o histórico: "e amanhã?", "explica melhor".
    ask: (q) => aiAsk(S.data.settings, S.items, q, o.history || [], brainExtras(q), { historyMax: Math.max(6, (o.history || []).length) }),
    placesAnswer: (q, lang) => {
      const a = localAnswer(q, S.data.settings, lang);
      if (!a) return null;
      if (a.kind === 'traffic') { showRoute({ live: true, to: a.place }); return a.text; }
      if (a.kind !== 'route' || !a.trip) return a.text;
      // Pedido de rota por voz: mostra o trajeto no widget Trânsito (maximizado), sem sair da NeuroTab.
      showRoute(a.trip);
      return placesText(lang).showing(a.trip.to.name);
    },
    interpret: (text) => interpretCommand(S.data.settings, text),
    open: (url) => { location.href = url; },
    searchUrl: (q) => eng.url + encodeURIComponent(q),
    findLink: (name) => {
      const f = Brain.fold(name).replace(/\s+/g, '');
      return S.data.links.find((l) => Brain.fold(l.title).replace(/\s+/g, '') === f)
        || S.data.links.find((l) => Brain.fold(l.title).replace(/\s+/g, '').includes(f))
        || S.data.links.find((l) => Brain.fold(hostOf(l.url)).includes(f));
    },
    tasksText: () => tasksSummary(S.items),
    items: () => S.items,
    routeTo: (name) => {
      const f = Brain.fold(name);
      const p = (S.data.settings.mapPlaces || []).find((x) => Brain.fold(x.name) === f || Brain.fold(x.name).includes(f));
      if (!p) return null;
      showRoute({ from: null, to: p, mode: 'driving' });
      return placesText('pt').showing(p.name);
    },
    weatherText: async () => {
      const w = S.data.settings.places?.[0];
      const d = w && (await getWeather(w));
      if (!d) return 'Escolha sua cidade no relógio (📍) primeiro.';
      return `Em ${w.name}, agora faz ${Math.round(d.current.temperature_2m)} graus, sensação de ${Math.round(d.current.apparent_temperature)}. Hoje: máxima de ${Math.round(d.daily.temperature_2m_max[0])} e mínima de ${Math.round(d.daily.temperature_2m_min[0])}, com ${d.daily.precipitation_probability_max[0] ?? 0}% de chance de chuva.`;
    },
    quotesText: async (t) => {
      const c = (await chrome.storage.local.get('nt_cache_quotes')).nt_cache_quotes;
      if (!c?.rows?.length) return 'Adicione o widget de cotações para eu saber os valores.';
      let rows = c.rows.filter((r) => !r.err);
      const want = /dolar|dollar/.test(t) ? 'USD' : /euro/.test(t) ? 'EUR' : /bitcoin/.test(t) ? 'BTC' : null;
      if (want) rows = rows.filter((r) => r.name === want);
      if (!rows.length) return 'Não tenho essa cotação no widget.';
      return rows.slice(0, 4).map((r) => `${r.sub || r.name}: ${Number(r.price).toLocaleString('pt-BR', { style: 'currency', currency: r.cur || 'BRL' })}, ${r.pct >= 0 ? 'alta' : 'queda'} de ${Math.abs(r.pct || 0).toFixed(1).replace('.', ',')}%`).join('. ') + '.';
    },
  };
}

export function setupVoice() {
  const fab = $('#voiceFab');
  fab.hidden = !hasDictation();
  document.body.classList.toggle('has-fab', !fab.hidden);
  fab.addEventListener('click', () => openVoice());
  $('#voiceClose').addEventListener('click', () => stopVoice(true));
  $('#voice').addEventListener('click', (e) => { if (e.target.id === 'voice') stopVoice(true); });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'm') { e.preventDefault(); V.conv ? stopVoice(true) : S.voiceSession ? stopVoice() : openVoice(); }
  });
  onEscape({ layer: 'overlay', isOpen: () => !$('#voice').hidden, close: () => stopVoice(true) });
  // 💬 Modo conversa (#44): botão, Alt+C; o navegador não ouve com a aba escondida, então encerra.
  $('#chatFab')?.addEventListener('click', () => toggleChat());
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c' && !e.target.closest?.('input,textarea,[contenteditable="true"]')) { e.preventDefault(); toggleChat(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && V.conv) endConversation('hidden'); });
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'startVoice' && document.visibilityState === 'visible') openVoice(); });
  if (location.hash === '#voice') { history.replaceState(null, '', location.pathname); setTimeout(openVoice, 300); }
}

/** Botão 🎙, Alt+M e atalho global: um pedido só, ou a conversa se a pessoa escolheu assim. */
export function openVoice() {
  if (meetingLive()) { toast(t('Há uma reunião sendo gravada: encerre a reunião para usar a voz aqui.')); return; }
  if (S.data.settings.voiceConvButton) startConversation({ greet: false });
  else startVoice();
}

/** Liga ou desliga o modo conversa. */
export function toggleChat() {
  if (V.conv?.kind === 'chat') { endConversation('user'); return; }
  startChat();
}

export async function startChat() {
  if (meetingLive()) { toast(t('Há uma reunião sendo gravada: encerre a reunião para usar o modo conversa.')); return; }
  if (!hasDictation()) { toast(t('Reconhecimento de voz indisponível neste navegador.')); return; }
  if (V.conv) endConversation('switch');
  if (S.voiceSession) stopVoice(true);
  if (!S.data.settings.voiceChatNoticed && !(await chatNotice())) return;
  startConversation({ greet: S.data.settings.voiceGreet !== false, kind: 'chat' });
}

/** Aviso da primeira vez: custo (cada fala é uma chamada à IA) e privacidade. */
function chatNotice() {
  return new Promise((resolve) => {
    const ov = $('#voice');
    ov.hidden = false;
    ensureViz();
    setState('idle');
    $('#voiceHeard').textContent = t('Modo conversa');
    $('#voiceHeard').classList.remove('interim');
    const done = async (ok) => {
      if (ok) await ctx.saveSettings({ voiceChatNoticed: true });
      $('#voiceReply').replaceChildren();
      if (!ok) hideVoice();
      resolve(ok);
    };
    $('#voiceReply').replaceChildren(
      h('p', {}, t('O microfone fica ligado e tudo o que você disser vai para a sua IA, com o histórico da conversa. Cada fala é uma chamada à IA (pode ter custo, conforme o seu provedor).')),
      h('p', { class: 'small muted' }, t('Desliga com o botão 💬, dizendo "pode parar", com Esc, trocando de aba ou após alguns minutos sem ninguém falar.')),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => done(true) }, t('Entendi, ligar')), h('button', { class: 'btn', onclick: () => done(false) }, t('Cancelar'))));
  });
}

export function startVoice({ fromWake = false } = {}) {
  if (S.voiceSession || V.conv) return;
  const ov = $('#voice');
  const heard = $('#voiceHeard');
  const reply = $('#voiceReply');
  ov.hidden = false;
  ov.classList.add('listening');
  ensureViz();
  setState(fromWake ? 'wake' : 'listening');
  if (fromWake) setTimeout(() => { if (S.voiceSession && $('#voice').dataset.state === 'wake') setState('listening'); }, 400);
  const name = assistantName(S.data.settings);
  const prompt = name === 'NeuroTab' ? t('Pode falar…') : `${name}: ${t('pode falar…')}`;
  heard.textContent = prompt;
  heard.classList.add('interim');
  reply.textContent = '';
  speechSynthesis?.cancel();
  let finalText = '';
  let silence;
  let heardSomething = false;
  let lastError = '';
  // Chamado pela frase de ativação: se ninguém falar o comando a tempo, encerra (#15).
  const giveUp = fromWake ? setTimeout(() => { if (!heardSomething) stopVoice(true); }, commandWindowMs(S.data.settings.wakeCommandSecs)) : null;
  S.voiceSession = startDictation({
    lang: voiceCode(),
    onText: (fin, interim) => {
      finalText = fin;
      if (fin || interim) heardSomething = true;
      heard.textContent = (fin + ' ' + interim).trim() || prompt;
      heard.classList.toggle('interim', !fin);
      clearTimeout(silence);
      silence = setTimeout(() => S.voiceSession?.stop(), 1600); // termina após pausa
    },
    onEnd: async (fin) => {
      clearTimeout(silence);
      clearTimeout(giveUp);
      S.voiceSession = null;
      ov.classList.remove('listening');
      paintWake();
      const said = (fin || finalText).trim();
      if (said && isCancel(said)) { heard.textContent = t('Cancelado'); setState('closed'); hideLater(1200); return; }
      // Com erro (microfone bloqueado, Whisper fora…), a explicação do erro é a mensagem: não diz "não ouvi".
      if (!said && lastError) { heard.textContent = t('Não deu para ouvir'); setState('error'); return; }
      if (!said) { heard.textContent = t('Não ouvi nada. Toque no microfone para tentar de novo.'); setState('closed'); hideLater(2500); return; }
      await processVoice(said);
    },
    onError: (msg) => { lastError = msg; reply.textContent = t(msg); },
  });
  if (!S.voiceSession) { clearTimeout(giveUp); hideVoice(); toast(t(lastError || 'Reconhecimento de voz indisponível neste navegador.')); paintWake(); return; }
  // 🔒 no computador · ☁ serviço do navegador (#49)
  const where = $('#voiceWhere');
  if (where) {
    where.textContent = S.voiceSession.local ? '🔒' : '☁';
    where.title = t(S.voiceSession.local ? 'Voz processada no seu computador' : 'Voz processada pelo serviço do navegador');
  }
  paintWake();
}

/** Idioma dos comandos de voz: o escolhido em "IA e voz" ou o da interface. */
export const voiceCode = () => S.data.settings.voiceLang || LOCALE;

/** Mostra a frase ouvida, executa o comando e fala a resposta. */
export function processVoice(said) {
  return whileWakePaused(() => runVoice(said));
}

/** Executa o pedido e mostra a resposta; devolve { text, long, lang } para falar. */
async function execute(said, conv = null) {
  const heard = $('#voiceHeard');
  const reply = $('#voiceReply');
  heard.textContent = `“${said}”`;
  heard.classList.remove('interim');
  // Trocar de modo por voz: "NeuroTab, modo conversa", "iniciar reunião".
  const mode = modeRequest(said);
  if (mode === 'meeting' || (mode === 'chat' && conv?.kind !== 'chat')) return { switchTo: mode };
  reply.textContent = t('Processando…');
  setState('thinking');
  const lang = commandLang(voiceCode());
  const chat = conv?.kind === 'chat';
  let r;
  const last = chat && conv.history.all.at(-1);
  if (chat && isSaveThat(said) && last) {
    // "anota isso": guarda a última resposta como nota
    await ctx.capture({ type: 'note', text: last.assistant, source: 'voice' });
    r = { reply: 'Anotado.' };
  } else if (mode === 'chat') r = { reply: 'O modo conversa já está ligado.' };
  else r = await runCommand(said, voiceApi(chat ? { history: historyMessages(conv.history) } : {}), lang, { chat });
  // A resposta sai no idioma em que a pessoa falou (respostas longas da IA já vêm no idioma da interface).
  const text = r.long || r.translated ? r.reply : tIn(lang, r.reply);
  // Respostas da IA vêm em Markdown (listas, negrito): formata em vez de mostrar os asteriscos.
  if (r.long) setHTML(reply, miniMarkdown(text));
  else reply.textContent = text;
  reply.scrollTop = 0;
  if (chat) conv.history = addTurn(conv.history, said, text);
  return { text, long: !!r.long, lang: r.long ? S.data.settings.voiceLang : voiceCode() };
}

async function runVoice(said) {
  $('#voice').hidden = false;
  ensureViz();
  try {
    const r = await execute(said);
    if (r.switchTo) { hideVoice(); switchMode(r.switchTo); return; }
    await say(r.text, r.lang);
    setState('idle');
    // Respostas longas ficam na tela até a pessoa fechar; as curtas somem sozinhas.
    if (!r.long) hideLater(Math.min(15000, Math.max(1800, r.text.length * 55)));
  } catch (e) {
    $('#voiceReply').textContent = t(e.message);
    setState('error');
    hideLater(4000);
  }
}

// ---------- Conversa por voz (#40) ----------
/** Chamado pela palavra de ativação: cumprimenta (falando), ouve, responde e volta a ouvir até o silêncio. */
function switchMode(mode) {
  if (mode === 'chat') startChat();
  else openMeeting();
}

/** kind: 'wake' (chamado, para após o silêncio, #40) ou 'chat' (modo conversa, #44: histórico e liga/desliga). */
export function startConversation({ greet = true, first = '', kind = 'wake' } = {}) {
  if (V.conv || S.voiceSession) return;
  if (meetingLive()) { toast(t('Há uma reunião sendo gravada: encerre a reunião para usar a voz aqui.')); return; }
  const conv = { open: true, current: null, clock: null, kind, history: newHistory() };
  V.conv = conv;
  return whileWakePaused(() => converse(conv, { greet, first }));
}

async function converse(conv, { greet, first }) {
  const s = S.data.settings;
  const ov = $('#voice');
  ov.hidden = false;
  ov.classList.add('conversation');
  ov.classList.toggle('chat-mode', conv.kind === 'chat');
  paintModeFabs();
  $('#voiceHeard').textContent = '';
  $('#voiceHeard').classList.add('interim');
  $('#voiceReply').textContent = '';
  ensureViz();
  setState('wake');
  const idle = conv.kind === 'chat' ? Math.min(60, Math.max(1, +s.voiceChatIdleMin || 10)) * 60000 : silenceMs(s.voiceSilenceSecs);
  conv.clock = silenceClock(idle, () => endConversation('silence'));
  try {
    if (greet && conv.open) {
      const g = greetingFor(s, voiceCode());
      $('#voiceReply').textContent = g;
      setState('greeting');
      await speak(g, { ...s, voiceLang: voiceCode() }, { onWord: () => V.viz?.pulse(), onStart: () => V.viz?.pulse() });
    }
    if (first && conv.open) await turn(conv, first);
    let empty = 0;
    while (conv.open) {
      // O microfone só abre depois que a fala terminou: o assistente não ouve a si mesmo.
      setState('listening');
      ov.classList.add('listening');
      $('#voiceHeard').textContent = t('Pode falar…');
      $('#voiceHeard').classList.add('interim');
      conv.clock.kick();
      const t0 = Date.now();
      const said = await listenOnce(conv);
      ov.classList.remove('listening');
      if (!conv.open) break;
      if (!said) {
        // O navegador encerra a escuta de tempos em tempos: reabre até o prazo de silêncio (com calma se for muito rápido).
        empty = Date.now() - t0 < 1500 ? empty + 1 : 0;
        await new Promise((r) => setTimeout(r, Math.min(5000, 250 * 2 ** Math.min(empty, 4))));
        continue;
      }
      empty = 0;
      if (isGoodbye(said, assistantName(s)) || isCancel(said)) { endConversation('bye'); break; }
      conv.clock.pause();
      await turn(conv, said);
    }
  } finally {
    conv.clock.stop();
  }
}

async function turn(conv, said) {
  try {
    const r = await execute(said, conv);
    if (r.switchTo) { endConversation('switch'); switchMode(r.switchTo); return; }
    if (!conv.open) return;
    await say(r.text, r.lang);
  } catch (e) {
    $('#voiceReply').textContent = t(e.message);
  }
}

/** Ouve um pedido (termina após uma pausa curta). null/'' = nada ouvido. */
function listenOnce(conv) {
  return new Promise((resolve) => {
    const heard = $('#voiceHeard');
    let finalText = '';
    let pause;
    let fatal = '';
    const sess = startDictation({
      lang: voiceCode(),
      onText: (fin, interim) => {
        finalText = fin;
        conv.clock.kick(); // conta o silêncio pela última fala, inclusive as parciais
        heard.textContent = (fin + ' ' + interim).trim();
        heard.classList.toggle('interim', !fin);
        clearTimeout(pause);
        pause = setTimeout(() => sess?.stop(), 1600);
      },
      onEnd: (fin) => {
        clearTimeout(pause);
        if (S.voiceSession === sess) S.voiceSession = null;
        conv.current = null;
        paintWake();
        if (fatal) { endConversation('error', fatal); resolve(null); return; }
        resolve((fin || finalText).trim());
      },
      onError: (msg) => {
        // Microfone bloqueado ou motor indisponível encerram; "não ouvi" e quedas de rede só reabrem a escuta.
        if (/bloquead|blocked|bloqueado|Nenhum microfone|idioma|Whisper/i.test(msg)) fatal = msg;
      },
    });
    if (!sess) { endConversation('error', 'Reconhecimento de voz indisponível neste navegador.'); resolve(null); return; }
    conv.current = sess;
    S.voiceSession = sess;
    const where = $('#voiceWhere');
    if (where) {
      where.textContent = sess.local ? '🔒' : '☁';
      where.title = t(sess.local ? 'Voz processada no seu computador' : 'Voz processada pelo serviço do navegador');
    }
    paintWake();
  });
}

/** Encerra a conversa: por silêncio ou despedida (aviso curto), por erro (mensagem) ou pela pessoa (fecha). */
function endConversation(reason, msg = '') {
  const conv = V.conv;
  if (!conv) return;
  conv.open = false;
  V.conv = null;
  conv.clock?.stop();
  const cur = conv.current;
  conv.current = null;
  if (S.voiceSession === cur) S.voiceSession = null;
  try { cur?.stop(); } catch { /* já parou */ }
  speechSynthesis?.cancel();
  const ov = $('#voice');
  ov.classList.remove('conversation', 'listening', 'chat-mode');
  paintModeFabs();
  // Modo conversa com algo dito: oferece salvar como nota (fica na tela até a pessoa responder ou 20 s).
  if (conv.kind === 'chat' && conv.history.all.length && reason !== 'switch') {
    offerSave(conv, reason);
    paintWake();
    return;
  }
  if (reason === 'silence' || reason === 'bye') {
    const l = String(voiceCode()).slice(0, 2);
    $('#voiceHeard').textContent = FAREWELL[l] || FAREWELL.pt;
    $('#voiceHeard').classList.remove('interim');
    if (reason === 'silence') beep({ down: true });
    setState('closed');
    hideLater(1500);
  } else if (reason === 'error') {
    $('#voiceReply').textContent = t(msg);
    setState('error');
    hideLater(5000);
  } else {
    hideVoice();
  }
  paintWake();
}

function offerSave(conv, reason) {
  const ov = $('#voice');
  ov.hidden = false;
  const l = String(voiceCode()).slice(0, 2);
  $('#voiceHeard').textContent = reason === 'silence' || reason === 'bye' ? FAREWELL[l] || FAREWELL.pt : t('Conversa encerrada');
  $('#voiceHeard').classList.remove('interim');
  if (reason === 'silence') beep({ down: true });
  setState('closed');
  let timer;
  const close = () => { clearTimeout(timer); if (!S.voiceSession && !V.conv) hideVoice(); };
  const save = async () => {
    const text = conversationNote(conv.history, { title: t('Conversa por voz'), you: t('Você'), assistant: assistantName(S.data.settings) || 'NeuroTab', locale: LOCALE });
    await ctx.capture({ type: 'note', text, source: 'voice' });
    $('#voiceReply').textContent = '✅ ' + t('Conversa salva no cérebro.');
    timer = setTimeout(close, 1500);
  };
  $('#voiceReply').replaceChildren(
    h('p', {}, t('Salvar a conversa como nota?')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'chatSave', onclick: save }, t('Salvar')), h('button', { class: 'btn', onclick: close }, t('Não'))));
  timer = setTimeout(close, 20000);
}

export function stopVoice(close) {
  if (V.conv && close) { endConversation('user'); return; }
  if (S.voiceSession) S.voiceSession.stop();
  if (close) { S.voiceSession = null; hideVoice(); speechSynthesis?.cancel(); }
  paintWake();
}

/** Para os testes e para a palavra de ativação saberem se há conversa aberta. */
export const inConversation = () => !!V.conv;
