// NeuroTab — Botões dos modos de voz perto do microfone (0.8.3): 💬 conversa (#44) e 📋 reunião (#41).
import { $, toast } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { S } from './state.js';

export const MEETING_KEY = 'nt_meeting_live';
let live = null; // { state: 'recording'|'paused', startedAt, elapsed, tabId }
let tick = 0;

export const meetingLive = () => !!live && (live.state === 'recording' || live.state === 'paused');

/** Abre (ou mostra) a aba da reunião. */
export async function openMeeting() {
  const url = chrome.runtime.getURL('src/meeting.html');
  try {
    const ctxs = await chrome.runtime.getContexts?.({ contextTypes: ['TAB'], documentUrls: [url] });
    const c = ctxs?.[0];
    if (c?.tabId >= 0) {
      await chrome.tabs.update(c.tabId, { active: true });
      if (c.windowId >= 0) await chrome.windows.update(c.windowId, { focused: true }).catch(() => {});
      return;
    }
  } catch { /* abre uma nova */ }
  if (live?.tabId >= 0 && (await chrome.tabs.update(live.tabId, { active: true }).then(() => true).catch(() => false))) return;
  chrome.tabs.create({ url, pinned: !!S.data.settings.meetingPinTab });
}

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const elapsed = () => (live ? (live.elapsed || 0) + (live.state === 'recording' && live.resumedAt ? Date.now() - live.resumedAt : 0) : 0);

/** Pinta 💬 e 📋 conforme o estado (chamado pela voz e pela reunião). */
export function paintModeFabs() {
  const chat = $('#chatFab');
  const meet = $('#meetFab');
  if (!chat || !meet) return;
  const conv = document.querySelector('#voice.chat-mode') && !$('#voice').hidden;
  chat.classList.toggle('on', !!conv);
  chat.setAttribute('aria-pressed', String(!!conv));
  chat.title = conv ? t('Conversa ligada — clique para desligar (Alt+C)') : t('Modo conversa: o cérebro responde a tudo (Alt+C)');
  const on = meetingLive();
  meet.classList.toggle('on', on);
  meet.classList.toggle('paused', live?.state === 'paused');
  meet.querySelector('.mf-time').textContent = on ? fmt(elapsed()) : '';
  meet.title = on ? t('Reunião sendo gravada — clique para abrir') : t('Modo reunião: grava, transcreve e resume (Alt+R)');
}

export function setupModeFabs() {
  const show = S.data.settings.voiceModeButtons !== false;
  const has = !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  const wrap = $('#modeFabs');
  wrap.hidden = !show || !has;
  document.body.classList.toggle('has-mode-fabs', !wrap.hidden);
  $('#meetFab').addEventListener('click', () => openMeeting());
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'r' && !e.target.closest?.('input,textarea,[contenteditable="true"]')) {
      e.preventDefault();
      if (!has) { toast(t('Reconhecimento de voz indisponível neste navegador.')); return; }
      openMeeting();
    }
  });
  const read = async () => {
    live = (await chrome.storage.local.get(MEETING_KEY))[MEETING_KEY] || null;
    paintModeFabs();
    clearInterval(tick);
    if (meetingLive()) tick = setInterval(paintModeFabs, 1000);
  };
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[MEETING_KEY]) read(); });
  read();
}
