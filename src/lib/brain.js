// NeuroTab — "segundo cérebro": notas, trechos, páginas, tarefas e lembretes.
import { BRAIN_KEY, uid, hostOf } from './store.js';

export const TYPES = {
  note: { label: 'Nota', icon: '📝' },
  task: { label: 'Tarefa', icon: '☑️' },
  clip: { label: 'Trecho', icon: '✂️' },
  page: { label: 'Página', icon: '🔖' },
  idea: { label: 'Ideia', icon: '💡' },
};

export async function loadItems() {
  const r = await chrome.storage.local.get(BRAIN_KEY);
  return Array.isArray(r[BRAIN_KEY]) ? r[BRAIN_KEY] : [];
}

export async function saveItems(items) {
  await chrome.storage.local.set({ [BRAIN_KEY]: items });
}

export function makeItem(p = {}) {
  const now = Date.now();
  return {
    id: uid(),
    type: TYPES[p.type] ? p.type : 'note',
    title: (p.title || '').trim(),
    text: (p.text || '').trim(),
    url: p.url || '',
    pageTitle: p.pageTitle || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    summary: p.summary || '',
    pinned: !!p.pinned,
    done: !!p.done,
    remindAt: p.remindAt || null, // timestamp (ms)
    notifiedAt: null,
    source: p.source || 'manual', // manual | voice | context | popup | keep
    createdAt: p.createdAt || now,
    updatedAt: now,
    enriched: !!p.enriched,
  };
}

export async function addItem(p) {
  const items = await loadItems();
  const item = makeItem(p);
  items.unshift(item);
  await saveItems(items);
  return item;
}

export async function updateItem(id, patch) {
  const items = await loadItems();
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  if ('remindAt' in patch && patch.remindAt !== it.remindAt) patch.notifiedAt = null;
  Object.assign(it, patch, { updatedAt: Date.now() });
  await saveItems(items);
  return it;
}

export async function deleteItem(id) {
  const items = await loadItems();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const [removed] = items.splice(idx, 1);
  await saveItems(items);
  return { removed, idx };
}

export async function restoreItem(item, idx) {
  const items = await loadItems();
  items.splice(Math.min(idx, items.length), 0, item);
  await saveItems(items);
}

export function displayTitle(it) {
  if (it.title) return it.title;
  const first = (it.text || '').split('\n').find((l) => l.trim()) || '';
  return first.length > 80 ? first.slice(0, 78) + '…' : first || it.pageTitle || hostOf(it.url) || 'Sem título';
}

// ---------- Busca simples (sem IA) ----------
const STOP = new Set('a o os as de da do das dos e é em no na nos nas um uma uns umas para por com sem que se sobre meu minha meus minhas eu me você qual quais quando onde como o que oq the of to and in is for on'.split(' '));

export function fold(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function terms(q) {
  return fold(q).split(/[^a-z0-9#@.-]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

export function searchItems(items, query, limit = 20) {
  const ts = terms(query);
  if (!ts.length) return items.slice(0, limit);
  const now = Date.now();
  return items
    .map((it) => {
      const title = fold(displayTitle(it));
      const hay = fold([it.text, it.summary, it.pageTitle, it.url].join(' '));
      const tags = fold(it.tags.join(' '));
      let score = 0;
      for (const t of ts) {
        if (title.includes(t)) score += 4;
        if (tags.includes(t)) score += 3;
        const m = hay.split(t).length - 1;
        score += Math.min(m, 5);
      }
      if (score && it.pinned) score += 1;
      if (score) score += Math.max(0, 1 - (now - it.createdAt) / (90 * 864e5)); // leve bônus p/ recentes
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.it);
}

// ---------- Lembretes em linguagem natural (sem IA) ----------
// Entende: "amanhã às 9h", "hoje 14:30", "depois de amanhã 8h", "em 20 minutos", "em 2 horas", "dia 15 às 10h", "15/11 9h".
export function parseReminder(text, now = new Date()) {
  const t = fold(text);
  let m = t.match(/\bem (\d{1,3}) ?(min|minutos?|h|horas?)\b/);
  if (m) {
    const n = +m[1];
    return now.getTime() + n * (m[2].startsWith('h') ? 3600e3 : 60e3);
  }
  const time = t.match(/\b(?:as |a |às )?(\d{1,2})(?:h|:)(\d{2})?\b/);
  let day = null;
  if (/\bdepois de amanha\b/.test(t)) day = addDays(now, 2);
  else if (/\bamanha\b/.test(t)) day = addDays(now, 1);
  else if (/\bhoje\b/.test(t)) day = new Date(now);
  else if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    day = new Date(y, +m[2] - 1, +m[1]);
  } else if ((m = t.match(/\bdia (\d{1,2})\b/))) {
    day = new Date(now.getFullYear(), now.getMonth(), +m[1]);
    if (day < startOfDay(now)) day.setMonth(day.getMonth() + 1);
  }
  if (!day && !time) return null;
  if (!/\b(lembr|avis|alarm|despert|me chama|notific)/.test(t) && !day) return null;
  const explicitDay = !!day;
  day = day || new Date(now);
  const h = time ? +time[1] : 9;
  const min = time && time[2] ? +time[2] : 0;
  if (h > 23 || min > 59) return null;
  day.setHours(h, min, 0, 0);
  if (day.getTime() <= now.getTime() && !explicitDay) day = addDays(day, 1);
  return day.getTime();
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function relTime(ts) {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (abs < 60e3) return 'agora';
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 86400e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
  if (abs < 7 * 86400e3) return rtf.format(Math.round(diff / 86400e3), 'day');
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: abs > 300 * 86400e3 ? 'numeric' : undefined });
}

export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------- Importar Google Keep (Google Takeout) ----------
export function fromKeepNote(json, fileName = '') {
  if (!json || json.isTrashed) return null;
  let text = json.textContent || '';
  if (Array.isArray(json.listContent) && json.listContent.length) {
    text = json.listContent.map((l) => `${l.isChecked ? '☑' : '☐'} ${l.text}`).join('\n');
  }
  const url = json.annotations?.find((a) => a.url)?.url || '';
  if (!text.trim() && !json.title && !url) return null;
  const created = json.createdTimestampUsec ? Math.round(json.createdTimestampUsec / 1000) : Date.now();
  const item = makeItem({
    type: url && !text ? 'page' : 'note',
    title: json.title || '',
    text,
    url,
    tags: (json.labels || []).map((l) => l.name).filter(Boolean),
    pinned: !!json.isPinned,
    source: 'keep',
    createdAt: created,
  });
  item.keepId = fileName || `${json.title}|${created}`;
  return item;
}

// ---------- Exportar Markdown (Obsidian, Notion, etc.) ----------
export function toMarkdown(items) {
  const lines = [`# NeuroTab — Segundo cérebro`, ``, `Exportado em ${new Date().toLocaleString('pt-BR')} · ${items.length} itens`, ``];
  for (const it of items) {
    lines.push(`## ${TYPES[it.type]?.icon || ''} ${displayTitle(it)}`.trim());
    const meta = [new Date(it.createdAt).toLocaleString('pt-BR')];
    if (it.tags.length) meta.push(it.tags.map((t) => '#' + t.replace(/\s+/g, '-')).join(' '));
    if (it.remindAt) meta.push('⏰ ' + fmtDateTime(it.remindAt));
    if (it.type === 'task') meta.push(it.done ? '✅ concluída' : '⬜ pendente');
    lines.push(`*${meta.join(' · ')}*`, '');
    if (it.summary) lines.push(`> ${it.summary}`, '');
    if (it.text) lines.push(it.text, '');
    if (it.url) lines.push(`Fonte: [${it.pageTitle || hostOf(it.url)}](${it.url})`, '');
    lines.push('---', '');
  }
  return lines.join('\n');
}
