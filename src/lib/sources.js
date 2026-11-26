// NeuroTab — Fontes e documentos (0.9.3, #9).
//
// Uma fonte é um item do cérebro: as páginas salvas (`page`), as mídias salvas (`media`) e as fontes
// cadastradas (`source`, livro, PDF, artigo, arquivo…). Os metadados ficam em `item.src` (ver
// docs/dev/FONTES.md). Assim fontes entram sozinhas na busca, na busca por significado, na lixeira,
// na sincronização e no backup. Trechos e notas se ligam a uma fonte pelo link de origem (mesma URL
// padronizada) ou por `sourceId`.
//
// Este módulo não conhece a interface: funções puras sobre listas de itens + o que grava (via brain.js).
import { canonicalize, platformOf } from './media-links.js';
import { fold, terms, displayTitle, addItem, updateItem, loadItems, trashItems } from './brain.js';

export const SOURCE_TYPES = ['source', 'page', 'media'];

export const SOURCE_KINDS = {
  link: { label: 'Link', icon: '🔗' },
  article: { label: 'Artigo', icon: '📰' },
  paper: { label: 'Artigo científico', icon: '🔬' },
  book: { label: 'Livro', icon: '📖' },
  video: { label: 'Vídeo', icon: '🎬' },
  post: { label: 'Post', icon: '💬' },
  audio: { label: 'Áudio ou podcast', icon: '🎧' },
  pdf: { label: 'PDF', icon: '📄' },
  doc: { label: 'Documento', icon: '📃' },
  file: { label: 'Arquivo', icon: '📎' },
};

/** Texto lido de um arquivo local guarda no máximo isto (o arquivo em si nunca é copiado). */
export const MAX_TEXT = 60000;
const MAX_FIELD = 300;

const str = (v, n = MAX_FIELD) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Data publicada: aceita "2024", "2024-05" ou "2024-05-17". Outra coisa vira vazio. */
export function cleanDate(v) {
  const s = str(v, 10);
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : '';
}

/** Metadados limpos e com tamanho limitado (o que vem de formulário, de arquivo ou de backup). */
export function cleanSrc(src = {}) {
  const out = {
    kind: SOURCE_KINDS[src.kind] ? src.kind : 'link',
    author: str(src.author),
    published: cleanDate(src.published),
    publisher: str(src.publisher),
    project: str(src.project, 80),
    ident: str(src.ident, 120), // DOI, ISBN, número do processo…
  };
  const f = src.file;
  if (f && typeof f === 'object' && str(f.name)) {
    out.file = {
      name: str(f.name, 200),
      size: Math.max(0, Math.round(+f.size || 0)),
      mime: str(f.mime, 100),
      modified: Math.max(0, Math.round(+f.modified || 0)),
      pages: Math.max(0, Math.round(+f.pages || 0)) || undefined,
      textChars: Math.max(0, Math.round(+f.textChars || 0)) || undefined,
    };
  }
  return out;
}

export const isSource = (it) => !!it && SOURCE_TYPES.includes(it.type) && !it.deletedAt;

/** Tipo derivado das páginas e mídias salvas, quando não há `src.kind`. */
function guessKind(it) {
  if (it.type === 'media') {
    const p = it.media?.platform || platformOf(it.url || '');
    if (p === 'youtube') return 'video';
    if (p && p !== 'web') return 'post';
    return it.media?.contentType === 'video' ? 'video' : 'article';
  }
  if (it.type === 'page') {
    const u = (it.url || '').toLowerCase();
    if (/\.pdf($|[?#])/.test(u)) return 'pdf';
    if (/doi\.org\/|arxiv\.org|scielo|pubmed|ncbi\.nlm|sciencedirect|springer|wiley|nature\.com/.test(u)) return 'paper';
    return 'link';
  }
  return 'link';
}

/** Metadados de qualquer fonte, completando com o que as páginas e mídias já guardam. */
export function sourceMeta(it) {
  const s = it.src ? cleanSrc(it.src) : cleanSrc({});
  if (!it.src?.kind) s.kind = guessKind(it);
  if (!s.author && it.media?.author) s.author = str(it.media.author);
  if (!s.published && it.media?.published) s.published = cleanDate(String(it.media.published).slice(0, 10));
  s.capturedAt = it.createdAt || 0;
  s.origin = it.url || '';
  return s;
}

/** Chave da fonte: a URL padronizada (sem rastreio) ou, sem link, o próprio id. */
export function sourceKey(it) {
  return it.url ? canonicalize(it.url) : `id:${it.id}`;
}

/** Itens (trechos, notas, imagens…) ligados a uma fonte: mesma URL padronizada ou `sourceId`. */
export function linkedItems(source, items) {
  const key = source.url ? canonicalize(source.url) : '';
  return items.filter((it) => it.id !== source.id && !it.deletedAt && !SOURCE_TYPES.includes(it.type)
    && (it.sourceId === source.id || (key && it.url && canonicalize(it.url) === key)));
}

/** Projetos já usados (para sugerir), do mais usado para o menos usado. */
export function projectsOf(items) {
  const n = new Map();
  for (const it of items) {
    if (!isSource(it)) continue;
    const p = str(it.src?.project, 80);
    if (p) n.set(p, (n.get(p) || 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
}

/** Texto extra das fontes para a busca e a busca por significado. */
export function sourceSearchText(it) {
  if (!isSource(it)) return '';
  const s = sourceMeta(it);
  return [SOURCE_KINDS[s.kind]?.label, s.author, s.publisher, s.project, s.ident, s.published, s.file?.name].filter(Boolean).join(' ');
}

/**
 * Lista de fontes com filtros, sem IA: `kind`, `project` ('' = todos, '-' = sem projeto) e `q`.
 * Sem busca: fixadas primeiro, depois as mais recentes. Com busca: pela relevância (título,
 * autor, projeto, identificador e texto).
 */
export function listSources(items, { kind = '', project = '', q = '' } = {}) {
  let arr = items.filter(isSource);
  if (kind) arr = arr.filter((it) => sourceMeta(it).kind === kind);
  if (project === '-') arr = arr.filter((it) => !str(it.src?.project));
  else if (project) arr = arr.filter((it) => str(it.src?.project) === project);
  const ts = terms(q);
  if (!ts.length) return arr.sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
  return arr.map((it) => {
    const title = fold(displayTitle(it));
    const meta = fold(sourceSearchText(it));
    const hay = fold([it.text, it.summary, it.url, it.media?.caption].join(' '));
    let score = 0;
    for (const t of ts) {
      if (title.includes(t)) score += 4;
      if (meta.includes(t)) score += 3;
      score += Math.min(hay.split(t).length - 1, 5);
    }
    return { it, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.it);
}

/** Links citados em trechos e notas que ainda não têm fonte cadastrada (sugestões). */
export function uncitedLinks(items, limit = 20) {
  const have = new Set(items.filter(isSource).filter((it) => it.url).map((it) => canonicalize(it.url)));
  const seen = new Map();
  for (const it of items) {
    if (it.deletedAt || SOURCE_TYPES.includes(it.type) || !it.url || !/^https?:/i.test(it.url)) continue;
    const key = canonicalize(it.url);
    if (have.has(key)) continue;
    const cur = seen.get(key) || { url: it.url, title: it.pageTitle || '', count: 0, at: 0 };
    cur.count++;
    cur.at = Math.max(cur.at, it.createdAt || 0);
    if (!cur.title && it.pageTitle) cur.title = it.pageTitle;
    seen.set(key, cur);
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || b.at - a.at).slice(0, limit);
}

/** Já existe fonte com este link? (para não cadastrar duas vezes) */
export function findSourceByUrl(items, url) {
  if (!url) return null;
  const key = canonicalize(url);
  return items.find((it) => isSource(it) && it.url && canonicalize(it.url) === key) || null;
}

/** Dados para criar uma fonte: { title, url, text, tags, src }. */
export function makeSourceInput(p = {}) {
  const src = cleanSrc(p.src || {});
  return {
    type: 'source',
    title: str(p.title, 300),
    url: str(p.url, 2000),
    text: typeof p.text === 'string' ? p.text.slice(0, MAX_TEXT) : '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    src,
    source: p.origin || 'manual',
  };
}

// ---------- Gravar (via brain.js) ----------
/** Cria uma fonte. Com link repetido, devolve a que já existe ({ existing }). */
export async function createSource(p) {
  const items = await loadItems();
  const dup = findSourceByUrl(items, p.url);
  if (dup) return { existing: dup };
  return { item: await addItem(makeSourceInput(p)) };
}

/** Atualiza; os metadados são mesclados (o que não veio no pedido é mantido). */
export async function updateSource(id, patch = {}) {
  const items = await loadItems();
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  const next = { ...patch };
  if (patch.src) next.src = cleanSrc({ ...(it.src || {}), ...patch.src, file: 'file' in patch.src ? patch.src.file : it.src?.file });
  if (typeof next.text === 'string') next.text = next.text.slice(0, MAX_TEXT);
  return updateItem(id, next);
}

/** Manda para a lixeira (30 dias). Os itens ligados continuam no cérebro. */
export async function removeSource(id) {
  return trashItems([id]);
}

// ---------- Arquivos locais ----------
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|html?|xml|srt|vtt|log|rtf)$/i;

/** Tipo de fonte a partir do nome/tipo do arquivo. */
export function kindForFile(name = '', mime = '') {
  const n = name.toLowerCase();
  if (mime === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/^audio\//.test(mime) || /\.(mp3|m4a|wav|ogg|opus|flac|aac)$/.test(n)) return 'audio';
  if (/^video\//.test(mime) || /\.(mp4|mkv|webm|mov|avi)$/.test(n)) return 'video';
  if (/\.(epub|mobi)$/.test(n)) return 'book';
  if (TEXT_EXT.test(n) || /\.(docx?|odt|pptx?|xlsx?)$/.test(n) || /^text\//.test(mime)) return 'doc';
  return 'file';
}

/** O texto deste arquivo pode ser lido direto (sem bibliotecas)? */
export const isPlainText = (name = '', mime = '') => TEXT_EXT.test(name) || /^text\//.test(mime) || mime === 'application/json';

/** Limpa HTML/RTF simples para texto. */
export function plainFromFile(name, text) {
  let t = String(text || '');
  if (/\.html?$/i.test(name)) t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (/\.rtf$/i.test(name)) t = t.replace(/\\par[d]?/g, '\n').replace(/\{\\[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, '');
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
}

/** Tamanho legível. */
export function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
