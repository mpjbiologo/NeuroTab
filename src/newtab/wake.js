// NeuroTab — Palavra de ativação (experimental): escuta contínua com a nova aba visível e em foco.
import * as Brain from '../lib/brain.js';
import { $, toast, hasDictation, speak, miniMarkdown } from '../lib/ui.js';
import { runCommand, commandLang } from '../lib/assistant.js';
import { t, tIn, LOCALE } from '../lib/i18n.js';
import { setHTML } from '../lib/safe-html.js';
import { S } from './state.js';
import { startVoice, voiceApi } from './voice.js';

// =====================================================================
// PALAVRA DE ATIVAÇÃO (experimental)
// Escuta contínua só com a nova aba visível e em foco; desliga sozinha após X minutos sem uso.
// No Edge/Chrome o áudio passa pelo serviço de reconhecimento do navegador (Microsoft/Google).
// =====================================================================
const wake = { rec: null, until: 0, paused: false, external: false, busy: false, blocked: false, backoff: 0, retry: null, lang: '' };

const WAKE_VARIANTS = ['neurotab', 'neurotabe', 'neurotabi', 'neurotap', 'neurotabs', 'neuraltab', 'neurotav', 'newrotab', 'neurotabby', 'neurotape'];
function wakeVariants() {
  const p = Brain.fold(S.data.settings.wakePhrase || 'NeuroTab').replace(/[^a-z0-9]/g, '');
  return p === 'neurotab' ? WAKE_VARIANTS : [p];
}

/** Procura a palavra de ativação; devolve o que vem depois dela ('' se nada) ou null se não achou. */
function afterWake(text) {
  const words = text.trim().split(/\s+/);
  const variants = wakeVariants();
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const j = Brain.fold(words.slice(i, i + n).join('')).replace(/[^a-z0-9]/g, '');
      if (variants.includes(j)) return words.slice(i + n).join(' ').replace(/^[\s,.:;!]+/, '').trim();
    }
  }
  return null;
}

const wakeMs = () => Math.max(1, +S.data.settings.wakeMinutes || 10) * 60e3;
const wakeEnabled = () => !!S.data.settings.wakeWord && hasDictation();
function wakeShouldListen() {
  return wakeEnabled() && !wake.paused && !wake.blocked && !wake.external && !wake.busy && !S.voiceSession
    && document.visibilityState === 'visible' && document.hasFocus() && Date.now() < wake.until;
}

function paintWake() {
  const pill = $('#wakePill');
  if (!pill) return;
  pill.hidden = !wakeEnabled();
  if (pill.hidden) return;
  const phrase = S.data.settings.wakePhrase || 'NeuroTab';
  pill.classList.toggle('on', !!wake.rec);
  pill.classList.toggle('blocked', wake.blocked);
  pill.textContent = wake.blocked ? t('Permitir microfone')
    : wake.rec ? `${t('Ouvindo')} “${phrase}”`
      : t('Palavra de ativação pausada');
  pill.title = wake.rec ? t('Clique para pausar a escuta') : t('Clique para voltar a ouvir');
}

function startWake() {
  if (wake.rec || !wakeShouldListen()) { paintWake(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = wake.lang = voiceCode();
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (!ev.results[i].isFinal) continue;
      const rest = afterWake(ev.results[i][0].transcript);
      if (rest == null) continue;
      wake.until = Date.now() + wakeMs();
      wake.busy = true;
      stopWake();
      wake.busy = false;
      if (rest.length >= 2) processVoice(rest);
      else startVoice();
      return;
    }
  };
  rec.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') wake.blocked = true;
    else if (ev.error === 'network') wake.backoff = Math.min((wake.backoff || 5000) * 2, 60000);
  };
  rec.onend = () => {
    if (wake.rec === rec) wake.rec = null;
    paintWake();
    clearTimeout(wake.retry);
    if (wakeShouldListen()) wake.retry = setTimeout(startWake, wake.backoff || 300); // o navegador encerra a escuta de tempos em tempos
  };
  rec.onstart = () => { wake.backoff = 0; };
  try {
    rec.start();
    wake.rec = rec;
  } catch (e) {
    console.warn('NeuroTab: palavra de ativação', e);
  }
  paintWake();
}

function stopWake() {
  clearTimeout(wake.retry);
  const r = wake.rec;
  wake.rec = null;
  if (r) { r.onend = null; try { r.abort(); } catch { /* já parado */ } }
  paintWake();
}

/** Liga/desliga conforme o estado da aba e das configurações. renew=true reinicia o prazo. */
export function updateWake(renew = false) {
  if (!wakeEnabled()) { stopWake(); return; }
  if (renew && !wake.paused) wake.until = Date.now() + wakeMs();
  if (wake.rec && wake.lang !== voiceCode()) stopWake(); // idioma mudou
  if (wakeShouldListen()) startWake(); else if (wake.rec && !(Date.now() < wake.until && document.visibilityState === 'visible')) stopWake();
  else paintWake();
}

export function setupWake() {
  wake.until = Date.now() + wakeMs();
  $('#wakePill').addEventListener('click', async () => {
    if (wake.blocked) {
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: true });
        st.getTracks().forEach((tr) => tr.stop());
        wake.blocked = false;
      } catch {
        toast('O navegador bloqueou o microfone. Libere no ícone da barra de endereço.');
        return;
      }
    } else if (wake.rec) {
      wake.paused = true;
      stopWake();
      return;
    }
    wake.paused = false;
    updateWake(true);
  });
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? updateWake(true) : stopWake()));
  window.addEventListener('focus', () => updateWake(true));
  window.addEventListener('blur', () => stopWake());
  window.addEventListener('nt-dictation', (e) => {
    wake.external = e.detail === 'start';
    if (wake.external) stopWake();
    else setTimeout(() => updateWake(), 600);
  });
  setInterval(() => { if (wake.rec && Date.now() >= wake.until) stopWake(); }, 15000);
  updateWake(true);
}

/** Idioma dos comandos de voz: o escolhido em "IA e voz" ou o da interface. */
export const voiceCode = () => S.data.settings.voiceLang || LOCALE;

/** Mostra a frase ouvida, executa o comando e fala a resposta. */
export async function processVoice(said) {
  wake.busy = true; // a escuta contínua não deve ouvir a própria resposta falada
  stopWake();
  try { await runVoice(said); } finally { wake.busy = false; setTimeout(() => updateWake(), 400); }
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
