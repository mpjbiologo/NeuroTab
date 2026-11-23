// NeuroTab — Página do modo reunião (0.8.3, #41).
// Grava em uma aba própria (o reconhecimento de voz não funciona escondido): microfone, ou microfone + áudio da
// aba da reunião (escolha de tela do navegador, sem permissão nova). Transcreve, salva a cada trecho, e no fim
// a IA da pessoa gera resumo, pontos, decisões, tarefas e perguntas. Vira uma nota no cérebro.
import { h } from './lib/ui.js';
import { loadData, saveData } from './lib/store.js';
import { initI18n, t, LOCALE } from './lib/i18n.js';
import { startIconizer } from './lib/icons.js';
import { configureSpeech, createRecognizer } from './lib/speech-engine.js';
import { complete, isConfigured } from './lib/ai.js';
import * as Brain from './lib/brain.js';
import {
  newMeeting, elapsedOf, pause, resume, finish, addSegment, addMark, clock, markedSegments, transcriptText,
  chunkTranscript, summaryPrompt, partPrompt, parseSummary, meetingNote, taskText, isInterrupted,
} from './lib/meeting.js';
import { saveMeeting, getMeeting, listMeetings, addAudioChunk, audioBlob, deleteAudio, deleteMeeting, pruneAudio } from './lib/meeting-store.js';
import { mixStreams, canRecognizeTrack, canCaptureTabAudio } from './lib/audio-mix.js';

const $ = (s) => document.querySelector(s);
const LIVE_KEY = 'nt_meeting_live';
let data;
let lang = 'pt-BR';
const R = { m: null, mix: null, rec: null, recorder: null, fails: 0, tick: 0, meterTick: 0, shown: null };

// ---------- estado compartilhado com a nova aba (📋 vermelho) e o ícone da extensão ----------
async function publishLive() {
  const m = R.m;
  if (!m || m.state === 'ended') {
    await chrome.storage.local.remove(LIVE_KEY);
    await badge(null);
    return;
  }
  const tab = await chrome.tabs.getCurrent?.().catch(() => null);
  await chrome.storage.local.set({ [LIVE_KEY]: { id: m.id, state: m.state, startedAt: m.startedAt, elapsed: m.elapsed, resumedAt: m.resumedAt, tabId: tab?.id ?? -1 } });
  await badge(m.state);
}

async function badge(state) {
  try {
    const cur = await chrome.action.getBadgeText({});
    if (state) {
      await chrome.action.setBadgeBackgroundColor({ color: state === 'paused' ? '#e0a030' : '#e5484d' });
      await chrome.action.setBadgeText({ text: state === 'paused' ? '❚❚' : 'REC' });
      await chrome.action.setTitle({ title: t('NeuroTab · reunião sendo gravada') });
    } else if (cur === 'REC' || cur === '❚❚') {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: 'NeuroTab' });
    }
  } catch { /* sem ícone de ação */ }
}

let saveTimer = 0;
function persist(now = false) {
  clearTimeout(saveTimer);
  const go = () => saveMeeting(R.m).catch((e) => console.warn('NeuroTab: reunião não salva', e));
  if (now) return go();
  saveTimer = setTimeout(go, 400);
}

// ---------- telas ----------
function show(id) {
  for (const s of ['#setupSec', '#liveSec', '#doneSec', '#resumeSec']) $(s).hidden = s !== id;
  $('#histSec').hidden = id === '#liveSec';
}

function paintSetup() {
  const s = data.settings;
  const tabOk = canCaptureTabAudio();
  $('#srcTab').disabled = !tabOk;
  $('#srcTabL').classList.toggle('off', !tabOk);
  const note = $('#srcTabNote');
  note.hidden = tabOk && canRecognizeTrack();
  note.textContent = !tabOk
    ? t('Este navegador não captura o áudio de outra aba: use o modo presencial.')
    : t('Este navegador só transcreve o microfone pelo reconhecimento de voz próprio. Para transcrever todos, use o Whisper local (Configurações → Voz) ou atualize o navegador.');
  const src = s.meetingSource === 'tab' && tabOk ? 'tab' : 'mic';
  $(src === 'tab' ? '#srcTab' : '#srcMic').checked = true;
  $('#keepAudio').checked = !!s.meetingKeepAudio;
  $('#consent').hidden = !!s.meetingConsentSkip;
  show('#setupSec');
}

// ---------- gravação ----------
async function getMic() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    throw new Error(/denied|allowed|permission/i.test(e?.name + e?.message) ? 'Microfone bloqueado. Libere o microfone para esta página e tente de novo.' : 'Nenhum microfone encontrado.');
  }
}

async function getTabAudio() {
  const ds = await navigator.mediaDevices.getDisplayMedia({
    video: true, audio: { suppressLocalAudioPlayback: false }, systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include', preferCurrentTab: false,
  });
  ds.getVideoTracks().forEach((tr) => tr.stop()); // só o áudio interessa
  const a = ds.getAudioTracks();
  return a.length ? new MediaStream(a) : null;
}

const realStream = (st) => st && typeof st.getAudioTracks === 'function' && st.getAudioTracks().length > 0;

async function begin(m) {
  R.m = m;
  R.fails = 0;
  $('#liveWarn').textContent = '';
  const mic = await getMic();
  let tab = null;
  if (m.source === 'tab') {
    try {
      tab = await getTabAudio();
      if (!tab) warn(t('A aba foi compartilhada sem o áudio: marque "Compartilhar áudio da aba". Seguindo só com o microfone.'));
    } catch {
      warn(t('O compartilhamento da aba foi cancelado. Seguindo só com o microfone.'));
    }
  }
  try {
    const srcs = [realStream(mic) && { id: 'mic', stream: mic }, realStream(tab) && { id: 'tab', stream: tab }].filter(Boolean);
    R.mix = srcs.length ? mixStreams(srcs) : null;
  } catch {
    R.mix = null;
  }
  if (!R.mix) mic?.getTracks?.().forEach((tr) => tr.stop());
  const tabTrack = tab?.getAudioTracks()[0];
  tabTrack?.addEventListener('ended', () => {
    R.mix?.remove('tab');
    warn(t('O compartilhamento da aba parou: seguindo só com o microfone.'));
    restartRec();
    paintMeters();
  });
  $('#mTabL').hidden = $('#mTabW').hidden = !R.mix?.has('tab');
  if (m.keepAudio) startRecorder();
  show('#liveSec');
  paintLive();
  startRec();
  await publishLive();
  persist(true);
  clearInterval(R.tick);
  R.tick = setInterval(paintTimer, 500);
  clearInterval(R.meterTick);
  R.meterTick = setInterval(paintMeters, 120);
}

function startRecorder() {
  if (!R.mix || !globalThis.MediaRecorder) { warn(t('Não deu para gravar o áudio neste navegador; a transcrição continua.')); R.m = { ...R.m, keepAudio: false }; return; }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((x) => MediaRecorder.isTypeSupported?.(x)) || '';
  const rec = new MediaRecorder(R.mix.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : {});
  rec.ondataavailable = async (e) => {
    if (!e.data?.size || !R.m) return;
    const n = R.m.audioChunks || 0;
    R.m = { ...R.m, audioChunks: n + 1, audioBytes: (R.m.audioBytes || 0) + e.data.size };
    await addAudioChunk(R.m.id, n, e.data);
    persist();
  };
  rec.start(10000);
  R.recorder = rec;
}

function startRec() {
  if (!R.m || R.m.state !== 'recording' || R.rec) return;
  const { rec, error } = createRecognizer(lang);
  if (!rec) { warn(t(error)); return; }
  R.rec = rec;
  rec.continuous = true;
  rec.interimResults = true;
  const t0 = Date.now();
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) onFinal(r[0].transcript);
      else interim += r[0].transcript;
    }
    paintInterim(interim);
  };
  rec.onerror = (e) => {
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) {
      R.fatal = true;
      warn(t('O reconhecimento de voz não conseguiu usar o microfone. A gravação do áudio continua, se ligada.'));
    }
  };
  rec.onend = () => {
    if (R.rec === rec) R.rec = null;
    paintInterim('');
    if (R.m?.state !== 'recording' || R.fatal) return;
    // O navegador encerra a escuta de tempos em tempos: reabre (com calma se cair muito rápido).
    R.fails = Date.now() - t0 < 1500 ? R.fails + 1 : 0;
    setTimeout(startRec, Math.min(8000, 200 * 2 ** Math.min(R.fails, 5)));
  };
  try {
    if (R.mix && R.mix.has('tab')) rec.start(R.mix.track); // mistura microfone + aba (Chrome/Edge 135+)
    else rec.start();
  } catch (err) {
    R.rec = null;
    warn(t('Não deu para iniciar a transcrição: ') + err.message);
  }
}

function restartRec() {
  const r = R.rec;
  R.rec = null;
  try { r?.stop(); } catch { /* já parou */ }
  setTimeout(startRec, 300);
}

function onFinal(text) {
  if (!R.m || !String(text).trim()) return;
  R.m = addSegment(R.m, text);
  paintTranscript();
  persist();
}

function warn(msg) { $('#liveWarn').textContent = msg; }

async function togglePause() {
  if (!R.m) return;
  if (R.m.state === 'recording') {
    R.m = pause(R.m);
    const r = R.rec;
    R.rec = null;
    try { r?.stop(); } catch { /* já parou */ }
    if (R.recorder?.state === 'recording') R.recorder.pause();
  } else if (R.m.state === 'paused') {
    R.m = resume(R.m);
    if (R.recorder?.state === 'paused') R.recorder.resume();
    startRec();
  }
  paintLive();
  await publishLive();
  persist(true);
}

function mark() {
  if (!R.m) return;
  R.m = addMark(R.m);
  paintTranscript();
  $('#markBtn').animate?.([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], 250);
  persist();
}

async function end() {
  if (!R.m || R.m.state === 'ended') return;
  $('#endBtn').disabled = true;
  R.m = finish(R.m);
  const r = R.rec;
  R.rec = null;
  try { r?.stop(); } catch { /* já parou */ }
  if (R.recorder && R.recorder.state !== 'inactive') {
    await new Promise((res) => { R.recorder.addEventListener('stop', () => setTimeout(res, 50), { once: true }); R.recorder.stop(); });
  }
  R.recorder = null;
  R.mix?.close();
  R.mix = null;
  clearInterval(R.tick);
  clearInterval(R.meterTick);
  await persist(true);
  await publishLive();
  $('#endBtn').disabled = false;
  await afterEnd(R.m);
}

/** Depois de encerrar: nota no cérebro e, se houver IA, o resumo. */
async function afterEnd(m) {
  m = await writeNote(m);
  await openDone(m);
  if (m.segments.length && isConfigured(data.settings, 'meeting')) await summarize(m);
}

const labels = () => ({
  title: t('Reunião'), duration: t('Duração'), source: t('Fonte'), mic: t('presencial (microfone)'), tab: t('online (microfone + áudio da aba)'),
  summary: t('Resumo'), points: t('Pontos importantes'), decisions: t('Decisões'), tasks: t('Tarefas'), questions: t('Perguntas em aberto'),
  transcript: t('Transcrição'), marked: t('Marcados durante a reunião'),
  noSummary: t('Resumo ainda não gerado (configure a IA e use "Gerar resumo" na página da reunião).'), locale: LOCALE,
});

async function writeNote(m) {
  const text = meetingNote(m, labels());
  let id = m.noteId;
  if (id && (await Brain.updateItem(id, { text }))) { /* atualizada */ } else {
    const it = await Brain.addItem({ type: 'note', text, source: 'meeting', tags: ['reunião'] });
    id = it.id;
  }
  m = { ...m, noteId: id };
  await saveMeeting(m);
  return m;
}

// ---------- resumo pela IA ----------
async function summarize(m) {
  const box = $('#sumBox');
  const text = transcriptText(m);
  if (!text) { box.replaceChildren(h('p', { class: 'muted' }, t('Nada foi transcrito nesta reunião.'))); return m; }
  if (!isConfigured(data.settings, 'meeting')) {
    box.replaceChildren(h('p', { class: 'warn' }, t('Configure uma IA (Configurações → IA) para gerar o resumo. A transcrição já está salva.')));
    return m;
  }
  $('#genSum').disabled = true;
  try {
    const parts = chunkTranscript(text);
    let input = text;
    if (parts.length > 1) {
      const notes = [];
      for (let i = 0; i < parts.length; i++) {
        box.replaceChildren(h('p', { class: 'muted' }, `⏳ ${t('Resumindo a parte')} ${i + 1} ${t('de')} ${parts.length}…`));
        notes.push(await complete(data.settings, { task: 'meeting', system: partPrompt(lang, i + 1, parts.length), messages: [{ role: 'user', content: parts[i] }], maxTokens: 1200 }));
      }
      input = notes.map((n, i) => `PARTE ${i + 1}:\n${n}`).join('\n\n');
    }
    box.replaceChildren(h('p', { class: 'muted' }, '⏳ ' + t('Gerando o resumo, os pontos importantes e as tarefas…')));
    const raw = await complete(data.settings, { task: 'meeting', system: summaryPrompt(lang), messages: [{ role: 'user', content: input }], json: true, maxTokens: 2200 });
    m = { ...m, summary: parseSummary(raw) };
    await saveMeeting(m);
    m = await writeNote(m);
    if (R.shown?.id === m.id) await openDone(m);
  } catch (e) {
    box.replaceChildren(h('p', { class: 'err' }, '✕ ' + t(e.message)), h('p', { class: 'small muted' }, t('A transcrição está salva; tente "Gerar resumo" de novo.')));
  } finally {
    $('#genSum').disabled = false;
  }
  return m;
}

// ---------- telas: ao vivo ----------
function paintLive() {
  const paused = R.m?.state === 'paused';
  $('#liveSec').classList.toggle('paused', paused);
  $('#liveState').textContent = paused ? t('Pausada') : t('Gravando');
  $('#pauseBtn').textContent = paused ? '▶ ' + t('Continuar') : '⏸ ' + t('Pausar');
  paintTimer();
  paintTranscript();
}
function paintTimer() { if (R.m) $('#timer').textContent = clock(elapsedOf(R.m)); }
function paintMeters() {
  const lv = (id) => (R.mix ? R.mix.level(id) : 0);
  $('#mMic').style.width = Math.round(lv('mic') * 100) + '%';
  $('#mTab').style.width = Math.round(lv('tab') * 100) + '%';
}
function paintTranscript() {
  const m = R.m;
  const box = $('#transcript');
  const marked = markedSegments(m);
  const rows = m.segments.map((s, i) => h('div', { class: 'seg' + (marked.has(i) ? ' marked' : '') }, h('time', {}, clock(s.t)), h('span', {}, marked.has(i) ? '⭐ ' : '', s.text)));
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  box.replaceChildren(...rows, ...(R.interim ? [h('div', { class: 'seg interim' }, h('time', {}, '…'), h('span', {}, R.interim))] : []));
  if (stick) box.scrollTop = box.scrollHeight;
}
function paintInterim(text) { R.interim = text; paintTranscript(); }

// ---------- telas: depois ----------
async function openDone(m) {
  R.shown = m;
  show('#doneSec');
  const d = new Date(m.startedAt);
  $('#doneTitle').textContent = `${t('Reunião')} — ${d.toLocaleDateString(LOCALE)} ${d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}`;
  $('#doneInfo').textContent = `${t('Duração')}: ${clock(m.elapsed)} · ${m.segments.length} ${t('trechos')} · ${m.marks.length} ⭐${m.noteId ? ' · ' + t('salva no cérebro') : ''}`;
  $('#fullText').textContent = transcriptText(m) || '—';
  paintSummary(m);
  const blob = m.audioChunks ? await audioBlob(m.id) : null;
  $('#dlAudio').hidden = !blob;
  $('#audioBox').replaceChildren(...(blob ? [h('audio', { controls: true, src: URL.createObjectURL(blob) })] : []));
  paintHist();
}

function paintSummary(m) {
  const s = m.summary;
  const box = $('#sumBox');
  if (!s) {
    box.replaceChildren(h('p', { class: 'muted' }, isConfigured(data.settings, 'meeting') ? t('Resumo ainda não gerado.') : t('Configure uma IA (Configurações → IA) para gerar o resumo. A transcrição já está salva.')));
    return;
  }
  const sec = (title, items) => (items.length ? [h('h3', {}, t(title)), h('ul', {}, ...items.map((x) => h('li', {}, x)))] : []);
  const tasks = s.tarefas.length ? [h('h3', {}, t('Tarefas')), ...s.tarefas.map((x, i) => h('div', { class: 'task-row' }, h('span', {}, taskText(x)), h('button', { class: 'btn sm', 'data-task': i, onclick: (e) => createTask(x, e.currentTarget) }, '➕ ', t('Criar tarefa')))),
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', id: 'allTasks', onclick: async (e) => { for (const b of document.querySelectorAll('[data-task]:not(:disabled)')) b.click(); e.currentTarget.disabled = true; } }, t('Criar todas as tarefas')))] : [];
  box.replaceChildren(h('h3', {}, t('Resumo')), ...s.resumo.split(/\n{2,}/).map((p) => h('p', {}, p)), ...sec('Pontos importantes', s.pontos), ...sec('Decisões', s.decisoes), ...tasks, ...sec('Perguntas em aberto', s.perguntas));
}

async function createTask(x, btn) {
  btn.disabled = true;
  const when = x.prazo ? Brain.parseReminder(x.prazo) : null;
  await Brain.addItem({ type: 'task', text: taskText(x), remindAt: when && when > Date.now() ? when : null, source: 'meeting' });
  btn.textContent = '✓ ' + t('Criada');
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const fileBase = (m) => `reuniao-${new Date(m.startedAt).toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;

// ---------- histórico ----------
async function paintHist() {
  const all = (await listMeetings()).filter((m) => m.state === 'ended');
  const box = $('#hist');
  if (!all.length) { box.replaceChildren(h('p', { class: 'small muted' }, t('Nenhuma reunião ainda.'))); return; }
  box.replaceChildren(...all.map((m) => {
    const d = new Date(m.startedAt);
    return h('div', { class: 'hist-row', 'data-id': m.id },
      h('span', {}, h('b', {}, `${d.toLocaleDateString(LOCALE)} ${d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}`), ` · ${clock(m.elapsed)}`, m.summary ? ' · ✨' : '', m.audioBytes ? ` · 🔊 ${(m.audioBytes / 1048576).toFixed(1)} MB` : ''),
      h('span', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => openDone(m) }, t('Abrir')),
        m.audioBytes ? h('button', { class: 'btn sm', onclick: async () => { if (confirm(t('Apagar o áudio desta reunião? A transcrição e o resumo ficam.'))) { await deleteAudio(m.id); if (R.shown?.id === m.id) await openDone(await getMeeting(m.id)); else paintHist(); } } }, t('Apagar o áudio')) : null,
        h('button', { class: 'btn sm', onclick: async () => { if (confirm(t('Apagar esta reunião (transcrição, resumo e áudio)? A nota no cérebro fica.'))) { await deleteMeeting(m.id); if (R.shown?.id === m.id) paintSetup(); paintHist(); } } }, t('Apagar'))));
  }));
}

// ---------- início ----------
async function init() {
  data = await loadData();
  initI18n(data.settings.lang);
  startIconizer();
  lang = data.settings.voiceLang || LOCALE;
  await configureSpeech(data.settings, lang).catch(() => {});
  pruneAudio(+data.settings.meetingAudioDays || 0).catch(() => {});

  $('#start').onclick = async () => {
    const source = $('#srcTab').checked ? 'tab' : 'mic';
    const keepAudio = $('#keepAudio').checked;
    data = await loadData();
    Object.assign(data.settings, { meetingSource: source, meetingKeepAudio: keepAudio, meetingConsentSkip: data.settings.meetingConsentSkip || $('#consentSkip').checked });
    await saveData(data);
    $('#setupMsg').textContent = '';
    try {
      await begin(newMeeting({ source, keepAudio, lang }));
    } catch (e) {
      R.m = null;
      $('#setupMsg').className = 'small err';
      $('#setupMsg').textContent = t(e.message);
      show('#setupSec');
    }
  };
  $('#pauseBtn').onclick = togglePause;
  $('#markBtn').onclick = mark;
  $('#endBtn').onclick = end;
  $('#genSum').onclick = () => R.shown && summarize(R.shown);
  $('#copySum').onclick = async () => {
    const m = R.shown;
    if (!m) return;
    await navigator.clipboard.writeText(meetingNote(m, labels()).split(`\n## ${t('Transcrição')}`)[0]).catch(() => {});
    $('#copySum').textContent = '✓ ' + t('Copiado');
    setTimeout(() => { $('#copySum').textContent = '📋 ' + t('Copiar resumo'); }, 1500);
  };
  $('#exportMd').onclick = () => R.shown && download(new Blob([meetingNote(R.shown, labels())], { type: 'text/markdown' }), fileBase(R.shown) + '.md');
  $('#dlAudio').onclick = async () => { const b = R.shown && (await audioBlob(R.shown.id)); if (b) download(b, fileBase(R.shown) + '.webm'); };
  $('#newMeeting').onclick = paintSetup;
  document.addEventListener('keydown', (e) => {
    if (!R.m || R.m.state === 'ended' || $('#liveSec').hidden) return;
    if (e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); mark(); }
  });
  // Fechar a aba no meio avisa (a transcrição já está salva e dá para retomar).
  window.addEventListener('beforeunload', (e) => { if (R.m && R.m.state !== 'ended') { e.preventDefault(); e.returnValue = ''; } });

  // Reunião interrompida (aba fechada, navegador caiu)?
  const live = (await chrome.storage.local.get(LIVE_KEY))[LIVE_KEY];
  const prev = live?.id ? await getMeeting(live.id) : null;
  if (isInterrupted(prev)) {
    show('#resumeSec');
    $('#resumeInfo').textContent = `${t('Começou em')} ${new Date(prev.startedAt).toLocaleString(LOCALE)} · ${clock(prev.elapsed || elapsedOf({ ...prev, state: 'paused' }))} ${t('gravados')} · ${prev.segments.length} ${t('trechos')}`;
    // Quanto já foi gravado: a gravação parou quando a aba fechou (savedAt), não agora.
    const stopped = { ...prev, state: 'paused', elapsed: prev.state === 'recording' && prev.resumedAt ? (prev.elapsed || 0) + Math.max(0, (prev.savedAt || prev.resumedAt) - prev.resumedAt) : prev.elapsed || 0, resumedAt: null };
    $('#resumeGo').onclick = async () => {
      try { await begin(resume(stopped)); } catch (e) { $('#resumeInfo').textContent = t(e.message); }
    };
    $('#resumeEnd').onclick = async () => {
      R.m = finish(stopped, stopped.savedAt || Date.now());
      R.m.endedAt = Date.now();
      await persist(true);
      await publishLive();
      await afterEnd(R.m);
    };
  } else {
    if (live) await chrome.storage.local.remove(LIVE_KEY);
    paintSetup();
  }
  paintHist();
}

init();
