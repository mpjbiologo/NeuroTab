// NeuroTab — Palavra de ativação (experimental): escuta contínua com a nova aba visível e em foco.
import { $, toast, hasDictation } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { wakeVariants, afterWake, wakeWindowMs, shouldListen } from '../lib/wake-word.js';
import { S } from './state.js';
import { processVoice, startVoice, voiceCode } from './voice.js';

// =====================================================================
// PALAVRA DE ATIVAÇÃO (experimental)
// Escuta contínua só com a nova aba visível e em foco; desliga sozinha após X minutos sem uso.
// No Edge/Chrome o áudio passa pelo serviço de reconhecimento do navegador (Microsoft/Google).
// =====================================================================
const wake = { rec: null, until: 0, paused: false, external: false, busy: false, blocked: false, backoff: 0, retry: null, lang: '' };

const variants = () => wakeVariants(S.data.settings.wakePhrase);
const wakeMs = () => wakeWindowMs(S.data.settings.wakeMinutes);
const wakeEnabled = () => !!S.data.settings.wakeWord && hasDictation();
const wakeShouldListen = () => shouldListen({
  enabled: wakeEnabled(), paused: wake.paused, blocked: wake.blocked, external: wake.external, busy: wake.busy,
  session: !!S.voiceSession, visible: document.visibilityState === 'visible', focused: document.hasFocus(),
  now: Date.now(), until: wake.until,
});

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
      const rest = afterWake(ev.results[i][0].transcript, variants());
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

/** Pausa a escuta contínua enquanto a voz responde (para não ouvir a própria resposta falada). */
export async function whileWakePaused(fn) {
  wake.busy = true;
  stopWake();
  try { return await fn(); } finally { wake.busy = false; setTimeout(() => updateWake(), 400); }
}
