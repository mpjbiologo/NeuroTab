// NeuroTab — Armazenamento (0.8.3, #68): quanto cada parte ocupa e o que dá para limpar.
// A parte pura (classificar, somar, escolher o que cada limpeza apaga) fica separada da leitura do navegador.
import { openDB } from './idb.js';

/** Categorias, na ordem da tela. clear: o que o botão faz (ver CLEARS). */
export const CATEGORIES = [
  { id: 'notes', icon: '🧠', label: 'Notas, tarefas e cérebro', where: 'Dados da extensão', hint: 'Só pela lixeira ou pelo backup.' },
  { id: 'settings', icon: '⚙️', label: 'Configurações, atalhos e widgets', where: 'Dados da extensão', hint: 'Hábitos, agenda, cotações e o resto dos widgets.' },
  { id: 'trash', icon: '🗑️', label: 'Lixeira', where: 'Dados da extensão', clear: 'trash' },
  { id: 'caches', icon: '♻️', label: 'Caches (notícias, citações, clima, agenda, recomendações)', where: 'Dados da extensão', clear: 'caches', hint: 'Baixados de novo quando precisar.' },
  { id: 'history', icon: '🕘', label: 'Históricos (calculadora, área de transferência)', where: 'Dados da extensão', clear: 'history' },
  { id: 'backup', icon: '🛟', label: 'Cópia de segurança da última atualização', where: 'Dados da extensão', clear: 'backup' },
  { id: 'vectors', icon: '🔎', label: 'Índice da busca por significado', where: 'Banco do navegador', clear: 'vectors', hint: 'Refeito sozinho quando a busca for usada.' },
  { id: 'photos', icon: '🖼️', label: 'Fotos dos slides', where: 'Banco do navegador', clear: 'photos', hint: 'As suas fotos enviadas para o fundo.' },
  { id: 'captures', icon: '📸', label: 'Biblioteca de imagens', where: 'Banco do navegador', clear: 'captures-temp', hint: 'Limpar apaga só as imagens abertas para análise e não guardadas.' },
  { id: 'meetings', icon: '📋', label: 'Reuniões (transcrições e resumos)', where: 'Banco do navegador', hint: 'Apague cada reunião na página do modo reunião.' },
  { id: 'meetingAudio', icon: '🔊', label: 'Áudios de reuniões', where: 'Banco do navegador', clear: 'meeting-audio', hint: 'As transcrições e os resumos ficam.' },
];

const CACHE_RE = /^nt_(cache_|wx_|calendar_cache$|catalog$)/; // só o que é baixado de novo sozinho
const HISTORY_KEYS = new Set(['nt_calc_history', 'nt_clipboard']);

/** Em que categoria fica uma chave do chrome.storage.local. */
export function classifyKey(key) {
  if (key === 'nt_brain' || key === 'nt_meta') return 'notes';
  if (key === 'nt_trash') return 'trash';
  if (key === 'nt_migration_backup') return 'backup';
  if (HISTORY_KEYS.has(key)) return 'history';
  if (CACHE_RE.test(key)) return 'caches';
  return 'settings';
}

/** Tamanho aproximado de um valor guardado (bytes). */
export function sizeOf(v) {
  if (v == null) return 0;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v.size;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (typeof v === 'string') return new TextEncoder().encode(v).length;
  if (typeof v !== 'object') return 8;
  let n = 0;
  if (Array.isArray(v)) { for (const x of v) n += sizeOf(x) + 1; return n + 2; }
  for (const [k, x] of Object.entries(v)) n += k.length + 3 + sizeOf(x);
  return n + 2;
}

/** Soma por categoria. local: { chave: bytes }; idb: { store: bytes }. Devolve [{ ...categoria, bytes }] (maiores primeiro). */
export function summarize(local = {}, idb = {}) {
  const by = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  for (const [k, b] of Object.entries(local)) by[classifyKey(k)] += b;
  by.vectors += idb.vectors || 0;
  by.photos += idb.photos || 0;
  by.captures += idb.captures || 0;
  by.meetings += idb.meetings || 0;
  by.meetingAudio += idb.meeting_audio || 0;
  return CATEGORIES.map((c) => ({ ...c, bytes: by[c.id] })).sort((a, b) => b.bytes - a.bytes);
}

/** Chaves que a limpeza de uma categoria do storage.local apaga. */
export const keysToClear = (keys, cat) => keys.filter((k) => classifyKey(k) === cat);

export function fmtBytes(n, locale = 'pt-BR') {
  const nf = (x, d) => x.toLocaleString(locale, { maximumFractionDigits: d });
  if (n < 1024) return `${nf(n, 0)} B`;
  if (n < 1048576) return `${nf(n / 1024, n < 10240 ? 1 : 0)} KB`;
  if (n < 1073741824) return `${nf(n / 1048576, 1)} MB`;
  return `${nf(n / 1073741824, 2)} GB`;
}

/** Vídeos baixados pela NeuroTab: itens de Mídia com media.download. */
export function downloadedItems(items) {
  return (items || []).filter((i) => i?.media?.download && (i.media.download.file || i.media.download.downloadId != null))
    .map((i) => ({ id: i.id, title: i.title || i.media.caption || i.url || '', ...i.media.download }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

// ---------- leitura do navegador ----------

/** Bytes de cada chave do storage.local (getBytesInUse no Chrome; estimativa no Firefox). */
export async function localUsage() {
  const all = await chrome.storage.local.get(null);
  const out = {};
  const exact = typeof chrome.storage.local.getBytesInUse === 'function';
  for (const k of Object.keys(all)) {
    out[k] = exact ? await chrome.storage.local.getBytesInUse(k).catch(() => sizeOf(all[k])) : sizeOf(all[k]);
  }
  return out;
}

/** Bytes de cada store do IndexedDB. */
export async function idbUsage() {
  const d = await openDB();
  const out = {};
  for (const name of d.objectStoreNames) {
    out[name] = await new Promise((res) => {
      let n = 0;
      const c = d.transaction(name).objectStore(name).openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return res(n); n += sizeOf(cur.value); cur.continue(); };
      c.onerror = () => res(n);
    });
  }
  return out;
}

/** Uso total e cota do navegador para a extensão. */
export async function browserQuota() {
  try { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; } catch { return { usage: 0, quota: 0 }; }
}

const AUTO_KEY = 'nt_storage_auto';
/**
 * Limpeza automática (opções do Armazenamento): caches a cada 30 dias e áudios de reuniões antigos.
 * Roda no máximo uma vez por dia (chamada ao abrir a nova aba).
 */
export async function autoClean(settings, now = Date.now()) {
  const st = (await chrome.storage.local.get(AUTO_KEY))[AUTO_KEY] || {};
  if (now - (st.ranAt || 0) < 86400000) return { skipped: true };
  const out = { caches: 0, audios: 0 };
  if (settings.storageAutoCaches && now - (st.cachesAt || 0) > 30 * 86400000) {
    const keys = keysToClear(Object.keys(await chrome.storage.local.get(null)), 'caches');
    if (keys.length) await chrome.storage.local.remove(keys);
    out.caches = keys.length;
    st.cachesAt = now;
  }
  if (+settings.meetingAudioDays > 0) {
    const { pruneAudio } = await import('./meeting-store.js');
    out.audios = await pruneAudio(+settings.meetingAudioDays, now);
  }
  await chrome.storage.local.set({ [AUTO_KEY]: { ...st, ranAt: now } });
  return out;
}
