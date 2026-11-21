// NeuroTab — "Como foi hoje?" (#58): um registro por dia de humor, energia e uma frase.
// Os dados ficam só neste computador (chrome.storage.local, chave nt_mood): não sincronizam e não vão para a IA.
// Aqui ficam só funções puras; o widget está em src/widgets/mood.js.

export const MOOD_KEY = 'nt_mood';
export const MOODS = [
  { v: 1, emoji: '😞', label: 'Muito ruim' },
  { v: 2, emoji: '😕', label: 'Ruim' },
  { v: 3, emoji: '😐', label: 'Mais ou menos' },
  { v: 4, emoji: '🙂', label: 'Bom' },
  { v: 5, emoji: '😄', label: 'Muito bom' },
];
export const ENERGY = [
  { v: 1, label: 'Sem energia' },
  { v: 2, label: 'Pouca energia' },
  { v: 3, label: 'Energia média' },
  { v: 4, label: 'Boa energia' },
  { v: 5, label: 'Muita energia' },
];
export const NOTE_MAX = 280;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function parseDay(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const level = (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

/** Um registro válido, ou null se ficou vazio. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const out = { mood: level(e.mood), energy: level(e.energy), note: typeof e.note === 'string' ? e.note.trim().slice(0, NOTE_MAX) : '', at: Number(e.at) || 0 };
  return out.mood || out.energy || out.note ? out : null;
}

export function sanitize(raw) {
  const days = {};
  for (const [k, e] of Object.entries(raw?.days || {})) {
    if (!DAY.test(k)) continue;
    const c = cleanEntry(e);
    if (c) days[k] = c;
  }
  return { v: 1, days };
}

/** Grava (ou mescla) o registro de um dia. Devolve um novo estado. Patch com tudo vazio apaga o dia. */
export function setEntry(state, day, patch, now = Date.now()) {
  if (!DAY.test(day)) throw new Error('Dia inválido');
  const s = sanitize(state);
  const merged = cleanEntry({ ...(s.days[day] || {}), ...patch, at: now });
  if (merged) s.days[day] = merged; else delete s.days[day];
  return s;
}

export function deleteEntry(state, day) {
  const s = sanitize(state);
  delete s.days[day];
  return s;
}

/** Os últimos `n` dias até `end` (inclusive), com o registro de cada um (ou null). */
export function series(state, n, end = new Date()) {
  const s = sanitize(state);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    const k = dayKey(d);
    out.push({ day: k, ...(s.days[k] || { mood: null, energy: null, note: '' }) });
  }
  return out;
}

/** Médias e quantos dias têm registro. Sem julgamentos: só os números. */
export function summary(list) {
  const avg = (key) => {
    const v = list.map((x) => x[key]).filter(Boolean);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  return { days: list.filter((x) => x.mood || x.energy || x.note).length, mood: avg('mood'), energy: avg('energy') };
}

/** Planilha (CSV) com todos os registros, do mais antigo ao mais novo. */
export function toCSV(state) {
  const s = sanitize(state);
  const esc = (v) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = Object.keys(s.days).sort().map((k) => {
    const e = s.days[k];
    return [k, e.mood ?? '', e.energy ?? '', esc(e.note || '')].join(',');
  });
  return ['data,humor,energia,frase', ...rows].join('\n') + '\n';
}

/** Dias de um mês para o calendário: semanas começando no domingo, com null nas bordas. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array(first.getDay()).fill(null);
  for (let d = 1; d <= days; d++) cells.push(dayKey(new Date(year, month, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}
