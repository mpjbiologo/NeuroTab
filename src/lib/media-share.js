// NeuroTab — mídias nos seus aparelhos (0.9.3.2, #80): regras e formato, sem efeitos.
//
// O que viaja é o mesmo envelope da área de transferência (v1), com kind 'media':
//   { v:1, id, at, from, kind:'media', text, media:{ title, url, platform, summary, category, author },
//     files:[{ id, name, mime, size, drive?, ntfy?, enc? }] }
// `text` leva título e link: aparelhos com a versão antiga mostram como texto, nada quebra.
//
// Regras escolhidas: na rede local o celular vê as 20 mídias mais recentes sozinho (como a área de
// transferência); pela internet (nuvem, ntfy, Telegram) vai só o que a pessoa manda com 📤.
// Grande demais para o caminho: vai só o link e o resumo.
import { dlSiteOf } from './media-sites.js';

export const LAN_MEDIA = 20;
export const MB = 1024 * 1024;
export const LIMITS = { ntfy: 15 * MB, telegram: 50 * MB }; // limites dos serviços
export const MEDIA_SHARE_DEFAULT = { cloudMaxMB: 25, cloudDays: 7 };
export const CLOUD_MEDIA_PREFIX = 'nt-media-';
export const INBOX_KEY = 'nt_media_inbox'; // o que chegou do celular (só neste computador)
export const SHARED_KEY = 'nt_media_shared'; // o que foi mandado com 📤 (chave da entrada → { at, via })
export const INBOX_MAX = 200;
export const RECEIVED_DIR = 'NeuroTab/Do celular';

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', weba: 'audio/webm',
  pdf: 'application/pdf',
};
export const baseName = (p) => String(p || '').split(/[\\/]/).pop() || 'arquivo';
export const mimeOf = (name) => EXT_MIME[String(name).toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1]] || 'application/octet-stream';

/** Configuração das mídias dentro do compartilhamento (com os padrões). */
export function mediaShareConfig(share = {}) {
  const m = share.media || {};
  const n = (v, lo, hi, d) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? Math.round(+v) : d);
  return { cloudMaxMB: n(m.cloudMaxMB, 1, 200, MEDIA_SHARE_DEFAULT.cloudMaxMB), cloudDays: n(m.cloudDays, 1, 90, MEDIA_SHARE_DEFAULT.cloudDays) };
}

/** Limite de tamanho por caminho, em bytes. */
export function limitFor(transport, share) {
  if (transport === 'cloud') return mediaShareConfig(share).cloudMaxMB * MB;
  return LIMITS[transport] ?? Infinity;
}

/** Arquivos já no computador de um item Mídia (vídeo, áudio, fotos), com caminho absoluto. */
export function filesOf(it) {
  const m = it?.media || {};
  const out = [];
  const add = (path, size = 0) => { if (typeof path === 'string' && path) out.push({ path, name: baseName(path), mime: mimeOf(path), size: +size || 0 }); };
  if (m.download?.file) add(m.download.file, m.download.size);
  if (m.audio?.file) add(m.audio.file, m.audio.size);
  for (const f of m.photos?.files || []) add(f);
  return out;
}

/** Chave estável de uma entrada da biblioteca: 'post:<id>' ou 'image:<id>'. */
export const entryKey = (e) => `${e.kind}:${e.id}`;

/**
 * Entradas para a rede local: as `limit` mais recentes entre posts/vídeos salvos e imagens da biblioteca,
 * mais as que a pessoa mandou com 📤 (mesmo se forem antigas). Do mais antigo para o mais novo.
 */
export function lanMediaEntries(items, captures, { limit = LAN_MEDIA, requested = {} } = {}) {
  const all = [
    ...items.filter((it) => it.type === 'media' && !it.deletedAt).map((it) => ({ kind: 'post', id: it.id, at: it.createdAt || 0, item: it })),
    ...captures.filter((c) => c?.blob).map((c) => ({ kind: 'image', id: c.id, at: c.capturedAt || 0, capture: c })),
  ].sort((a, b) => b.at - a.at);
  const chosen = all.slice(0, limit);
  for (const e of all.slice(limit)) if (requested[entryKey(e)]) chosen.push(e);
  return chosen.sort((a, b) => a.at - b.at);
}

/** Envelope de uma entrada (sem os arquivos, que dependem do caminho). */
export function mediaPayload(entry, me, files = [], { skipped = [] } = {}) {
  let media;
  if (entry.kind === 'image') {
    const c = entry.capture || {};
    media = { title: c.fileName || c.pageTitle || 'Imagem', url: /^https?:/.test(c.pageUrl || '') ? c.pageUrl : '', platform: 'image', summary: '', category: '', author: '' };
  } else {
    const it = entry.item || {};
    const m = it.media || {};
    media = {
      title: String(it.title || it.pageTitle || m.caption || 'Mídia').slice(0, 300),
      url: /^https?:/.test(it.url || '') ? it.url : '',
      platform: m.platform || dlSiteOf(it.url || '').site || 'web',
      summary: String(it.summary || '').slice(0, 2000),
      category: String(m.category || '').slice(0, 60),
      author: String(m.author || '').slice(0, 120),
    };
  }
  const note = skipped.length ? `\n(${skipped.length === 1 ? 'arquivo grande demais para este caminho' : 'arquivos grandes demais para este caminho'}: abra pelo link)` : '';
  return {
    v: 1, id: `m-${entry.kind}-${entry.id}`, at: entry.at || Date.now(), from: { id: me.id, name: me.name || 'Computador' }, kind: 'media',
    text: [`📎 ${media.title}`, media.url].filter(Boolean).join('\n') + note,
    media,
    files: files.map((f) => ({ id: String(f.id), name: f.name, mime: f.mime, size: f.size || 0, ...(f.drive ? { drive: f.drive } : {}), ...(f.ntfy ? { ntfy: f.ntfy } : {}), ...(f.enc ? { enc: true } : {}) })),
  };
}

/** Separa os arquivos que cabem no limite do caminho (em ordem) dos que não cabem. */
export function fitFiles(files, max) {
  const fit = [];
  const skipped = [];
  let total = 0;
  for (const f of files) {
    if (f.size && f.size <= max && total + f.size <= max * 2) { fit.push(f); total += f.size; } else skipped.push(f);
  }
  return { fit, skipped };
}

/** Valida um envelope de mídia recebido (nunca confia no formato). */
export function cleanMediaPayload(p) {
  if (!p || typeof p !== 'object' || p.kind !== 'media') return null;
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const m = p.media && typeof p.media === 'object' ? p.media : {};
  const files = (Array.isArray(p.files) ? p.files : []).slice(0, 20).map((f) => ({
    id: s(f?.id, 100), name: s(f?.name, 200) || 'arquivo', mime: s(f?.mime, 100) || 'application/octet-stream', size: Math.max(0, +f?.size || 0),
    drive: /^[\w-]{10,200}$/.test(f?.drive || '') ? f.drive : '', ntfy: /^https:\/\/[^\s]{5,500}$/.test(f?.ntfy || '') ? f.ntfy : '', enc: !!f?.enc,
  })).filter((f) => f.id);
  return {
    id: s(String(p.id || crypto.randomUUID()), 80), at: +p.at || Date.now(), kind: 'media',
    from: { id: s(String(p.from?.id || ''), 80), name: s(String(p.from?.name || ''), 60) },
    text: s(p.text, 5000),
    media: { title: s(m.title, 300) || 'Mídia', url: /^https?:\/\//.test(m.url || '') ? s(m.url, 2000) : '', platform: s(m.platform, 30), summary: s(m.summary, 2000), category: s(m.category, 60), author: s(m.author, 120) },
    files,
  };
}

/** Arquivos da nuvem que já passaram do prazo (para apagar). */
export function expiredCloudFiles(list, days, now = Date.now()) {
  return list.filter((f) => String(f.name || '').startsWith(CLOUD_MEDIA_PREFIX) && f.modifiedTime && now - Date.parse(f.modifiedTime) > days * 86400e3);
}

/** Entrada da caixa "Do celular" a partir de um envelope recebido. */
export function inboxEntries(p, via, { path = '' } = {}) {
  return p.files.map((f, i) => ({
    id: `${p.id}:${f.id || i}`, at: p.at, via, from: p.from.name || via, title: p.media.title, url: p.media.url,
    name: f.name, mime: f.mime, size: f.size, path: i === 0 ? path : '', drive: f.drive || '', ntfy: f.ntfy || '', enc: !!f.enc, savedAt: path ? Date.now() : 0,
  }));
}
