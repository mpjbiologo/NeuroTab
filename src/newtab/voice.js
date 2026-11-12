// NeuroTab — Assistente de voz: ouvir um comando, executar e responder (falando e na tela).
import { SEARCH_ENGINES, hostOf } from '../lib/store.js';
import * as Brain from '../lib/brain.js';
import { isConfigured, ask as aiAsk, interpretCommand } from '../lib/ai.js';
import { $, toast, startDictation, hasDictation, speak, miniMarkdown } from '../lib/ui.js';
import { tasksSummary, runCommand, commandLang } from '../lib/assistant.js';
import { t, tIn, LOCALE } from '../lib/i18n.js';
import { setHTML } from '../lib/safe-html.js';
import { getWeather } from '../lib/weather.js';
import { S } from './state.js';
import { ctx } from './context.js';
import { whileWakePaused } from './wake.js';

export function voiceApi() {
  const eng = SEARCH_ENGINES[S.data.settings.searchEngine] || SEARCH_ENGINES.google;
  return {
    capture: (p) => ctx.capture(p),
    aiReady: () => isConfigured(S.data.settings),
    ask: (q) => aiAsk(S.data.settings, S.items, q, []),
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
      location.href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=driving`;
      return `Abrindo a rota para ${p.name}.`;
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
  fab.addEventListener('click', () => startVoice());
  $('#voiceClose').addEventListener('click', () => stopVoice(true));
  $('#voice').addEventListener('click', (e) => { if (e.target.id === 'voice') stopVoice(true); });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'm') { e.preventDefault(); S.voiceSession ? stopVoice() : startVoice(); }
    if (e.key === 'Escape' && !$('#voice').hidden) stopVoice(true);
  });
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'startVoice' && document.visibilityState === 'visible') startVoice(); });
  if (location.hash === '#voice') { history.replaceState(null, '', location.pathname); setTimeout(startVoice, 300); }
}

export function startVoice() {
  if (S.voiceSession) return;
  const ov = $('#voice');
  const heard = $('#voiceHeard');
  const reply = $('#voiceReply');
  ov.hidden = false;
  ov.classList.add('listening');
  heard.textContent = t('Pode falar…');
  heard.classList.add('interim');
  reply.textContent = '';
  speechSynthesis?.cancel();
  let finalText = '';
  let silence;
  S.voiceSession = startDictation({
    lang: voiceCode(),
    onText: (fin, interim) => {
      finalText = fin;
      heard.textContent = (fin + ' ' + interim).trim() || t('Pode falar…');
      heard.classList.toggle('interim', !fin);
      clearTimeout(silence);
      silence = setTimeout(() => S.voiceSession?.stop(), 1600); // termina após pausa
    },
    onEnd: async (fin) => {
      clearTimeout(silence);
      S.voiceSession = null;
      ov.classList.remove('listening');
      const said = (fin || finalText).trim();
      if (!said) { heard.textContent = t('Não ouvi nada. Toque em 🎙 para tentar de novo.'); setTimeout(() => { if (!S.voiceSession) ov.hidden = true; }, 2500); return; }
      await processVoice(said);
    },
    onError: (msg) => { reply.textContent = t(msg); },
  });
  if (!S.voiceSession) { ov.hidden = true; toast('Reconhecimento de voz indisponível neste navegador.'); }
}

/** Idioma dos comandos de voz: o escolhido em "IA e voz" ou o da interface. */
export const voiceCode = () => S.data.settings.voiceLang || LOCALE;

/** Mostra a frase ouvida, executa o comando e fala a resposta. */
export function processVoice(said) {
  return whileWakePaused(() => runVoice(said));
}

async function runVoice(said) {
  const ov = $('#voice');
  const heard = $('#voiceHeard');
  const reply = $('#voiceReply');
  ov.hidden = false;
  heard.textContent = `“${said}”`;
  heard.classList.remove('interim');
  reply.textContent = t('Processando…');
  try {
    const lang = commandLang(voiceCode());
    const r = await runCommand(said, voiceApi(), lang);
    // A resposta sai no idioma em que a pessoa falou (respostas longas da IA já vêm no idioma da interface).
    const text = r.long || r.translated ? r.reply : tIn(lang, r.reply);
    // Respostas da IA vêm em Markdown (listas, negrito): formata em vez de mostrar os asteriscos.
    if (r.long) setHTML(reply, miniMarkdown(text));
    else reply.textContent = text;
    reply.scrollTop = 0;
    await speak(text, { ...S.data.settings, voiceLang: r.long ? S.data.settings.voiceLang : voiceCode() });
    // Respostas longas ficam na tela até a pessoa fechar; as curtas somem sozinhas.
    if (!r.long) setTimeout(() => { if (!S.voiceSession) ov.hidden = true; }, Math.min(15000, Math.max(1800, text.length * 55)));
  } catch (e) {
    reply.textContent = t(e.message);
    setTimeout(() => { if (!S.voiceSession) ov.hidden = true; }, 4000);
  }
}

export function stopVoice(close) {
  if (S.voiceSession) S.voiceSession.stop();
  if (close) { S.voiceSession = null; $('#voice').hidden = true; speechSynthesis?.cancel(); }
}
