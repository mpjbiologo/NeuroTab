// NeuroTab — despertadores, timer, pomodoro e cronômetro (estado em chrome.storage).
import { uid } from './store.js';

export const K = {
  alarms: 'nt_alarms',
  timer: 'nt_timer',
  pomo: 'nt_pomo',
  stopwatch: 'nt_stopwatch',
  sound: 'nt_sound',
};

export const DAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const get = async (k, def) => (await chrome.storage.local.get(k))[k] ?? def;
const set = (k, v) => chrome.storage.local.set({ [k]: v });

// ---------- Despertadores ----------
export async function loadAlarms() { return get(K.alarms, []); }
export async function saveAlarms(a) { await set(K.alarms, a); }

export function makeAlarm(p = {}) {
  return { id: uid(), time: p.time || '07:00', label: p.label || '', days: p.days || [], sound: p.sound || 'suave', enabled: p.enabled ?? true, snoozeUntil: null };
}

export async function addAlarm(p) {
  const a = await loadAlarms();
  const al = makeAlarm(p);
  a.push(al);
  a.sort((x, y) => x.time.localeCompare(y.time));
  await saveAlarms(a);
  return al;
}

export async function updateAlarm(id, patch) {
  const a = await loadAlarms();
  const al = a.find((x) => x.id === id);
  if (!al) return;
  Object.assign(al, patch);
  if ('time' in patch || 'days' in patch || 'enabled' in patch) al.snoozeUntil = null;
  a.sort((x, y) => x.time.localeCompare(y.time));
  await saveAlarms(a);
}

export async function deleteAlarm(id) {
  await saveAlarms((await loadAlarms()).filter((x) => x.id !== id));
}

/** Próximo disparo (timestamp) a partir de `from`. days vazio = só uma vez. */
export function nextOccurrence(al, from = Date.now()) {
  const [h, m] = al.time.split(':').map(Number);
  const base = new Date(from);
  for (let i = 0; i < 8; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= from) continue;
    if (!al.days?.length || al.days.includes(d.getDay())) return d.getTime();
  }
  return null;
}

export function describeDays(days) {
  if (!days?.length) return 'Uma vez';
  const s = [...days].sort().join('');
  if (s === '0123456') return 'Todos os dias';
  if (s === '12345') return 'Dias úteis';
  if (s === '06') return 'Fim de semana';
  return [...days].sort().map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
}

export function untilText(ts) {
  const min = Math.round((ts - Date.now()) / 60e3);
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  const mm = min % 60;
  if (h < 24) return `em ${h} h${mm ? ` ${mm} min` : ''}`;
  return `em ${Math.floor(h / 24)} dia(s)`;
}

// ---------- Timer ----------
export async function getTimer() { return get(K.timer, { endAt: null, duration: 0, label: '', pausedLeft: null }); }
export async function startTimer(ms, label = '') {
  await set(K.timer, { endAt: Date.now() + ms, duration: ms, label, pausedLeft: null });
}
export async function pauseTimer() {
  const t = await getTimer();
  if (!t.endAt) return;
  await set(K.timer, { ...t, endAt: null, pausedLeft: Math.max(0, t.endAt - Date.now()) });
}
export async function resumeTimer() {
  const t = await getTimer();
  if (t.pausedLeft == null) return;
  await set(K.timer, { ...t, endAt: Date.now() + t.pausedLeft, pausedLeft: null });
}
export async function resetTimer() { await set(K.timer, { endAt: null, duration: 0, label: '', pausedLeft: null }); }

// ---------- Pomodoro ----------
export const POMO_DEFAULT = { running: false, phase: 'focus', endAt: null, pausedLeft: null, cycle: 1, focusMin: 25, breakMin: 5, longMin: 15, every: 4 };
export async function getPomo() { return { ...POMO_DEFAULT, ...(await get(K.pomo, {})) }; }
export function phaseMinutes(p, phase = p.phase) {
  return phase === 'focus' ? p.focusMin : phase === 'long' ? p.longMin : p.breakMin;
}
export async function startPomo(patch = {}) {
  const p = { ...(await getPomo()), ...patch };
  const ms = (p.pausedLeft ?? phaseMinutes(p) * 60e3);
  await set(K.pomo, { ...p, running: true, endAt: Date.now() + ms, pausedLeft: null });
}
export async function pausePomo() {
  const p = await getPomo();
  if (!p.running) return;
  await set(K.pomo, { ...p, running: false, endAt: null, pausedLeft: Math.max(0, p.endAt - Date.now()) });
}
export function nextPhase(p) {
  if (p.phase === 'focus') return { phase: p.cycle % p.every === 0 ? 'long' : 'break', cycle: p.cycle };
  return { phase: 'focus', cycle: p.cycle + 1 };
}
export async function skipPomo() {
  const p = await getPomo();
  const n = { ...p, ...nextPhase(p), pausedLeft: null };
  await set(K.pomo, { ...n, running: p.running, endAt: p.running ? Date.now() + phaseMinutes(n) * 60e3 : null });
}
export async function stopPomo() {
  const p = await getPomo();
  await set(K.pomo, { ...p, running: false, endAt: null, pausedLeft: null, phase: 'focus', cycle: 1 });
}

// ---------- Cronômetro ----------
export async function getStopwatch() { return get(K.stopwatch, { running: false, startAt: null, elapsed: 0, laps: [] }); }
export const swElapsed = (s) => s.elapsed + (s.running ? Date.now() - s.startAt : 0);
export async function swToggle() {
  const s = await getStopwatch();
  if (s.running) await set(K.stopwatch, { ...s, running: false, elapsed: swElapsed(s), startAt: null });
  else await set(K.stopwatch, { ...s, running: true, startAt: Date.now() });
}
export async function swLap() {
  const s = await getStopwatch();
  await set(K.stopwatch, { ...s, laps: [swElapsed(s), ...s.laps].slice(0, 50) });
}
export async function swReset() { await set(K.stopwatch, { running: false, startAt: null, elapsed: 0, laps: [] }); }

// ---------- Som ----------
export async function stopSound() {
  try { await chrome.runtime.sendMessage({ type: 'stopSound' }); } catch {}
}

export function fmtDur(ms, tenths = false) {
  const neg = ms < 0;
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  const s = Math.floor((ms % 60e3) / 1000);
  const p = (n) => String(n).padStart(2, '0');
  let out = h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  if (tenths) out += ',' + Math.floor((ms % 1000) / 100);
  return (neg ? '-' : '') + out;
}

/** "25", "5:30", "1h30", "90s", "10 min" → ms */
export function parseDuration(text) {
  const t = String(text).trim().toLowerCase().replace(',', '.');
  let m;
  if ((m = t.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/))) return m[3] ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 : (+m[1] * 60 + +m[2]) * 1000;
  let ms = 0;
  let any = false;
  for (const [, n, u] of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hora|horas|m|min|minuto|minutos|s|seg|segundo|segundos)?/g)) {
    if (!n) continue;
    any = true;
    const v = parseFloat(n);
    if (!u || u.startsWith('m')) ms += v * 60e3;
    else if (u.startsWith('h')) ms += v * 3600e3;
    else ms += v * 1000;
  }
  return any ? Math.round(ms) : null;
}
