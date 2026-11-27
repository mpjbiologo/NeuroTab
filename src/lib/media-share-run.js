// NeuroTab — mídias nos seus aparelhos (0.9.3.2, #80): a parte que age (fundo e Biblioteca de mídias).
// Regras e formato ficam em media-share.js. Os bytes de um arquivo no disco vêm pela NeuroTab Ponte
// (op "read", só dentro de Downloads); as imagens da biblioteca vêm do IndexedDB.
import { loadItems } from './brain.js';
import { listCaptures, getCapture } from './image-index.js';
import { saveCapture, MAX_IMAGE_BYTES } from './captures.js';
import { clipConfig } from './clipboard.js';
import { shareConfig } from './clipboard-share.js';
import { transports, me, patchState, shareState } from './clipboard-sync.js';
import { ponteDl } from './media-dl-run.js';
import { ponteAllowed } from './net-ponte.js';
import {
  filesOf, entryKey, lanMediaEntries, mediaPayload, fitFiles, limitFor, mediaShareConfig, cleanMediaPayload, expiredCloudFiles,
  inboxEntries, INBOX_KEY, INBOX_MAX, SHARED_KEY, RECEIVED_DIR, LIMITS, baseName,
} from './media-share.js';

const area = () => chrome.storage.local;
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Lê um arquivo do disco pela Ponte (em pedaços, porque a Ponte só devolve 1 MB por mensagem). */
export async function readDiskFile(path, max = 0) {
  const parts = [];
  const done = await ponteDl('read', { path, max }, (ev) => { if (ev.stage === 'chunk' && ev.data) parts.push([+ev.offset || 0, unb64(ev.data)]); });
  const out = new Uint8Array(+done.size || parts.reduce((n, [, b]) => n + b.length, 0));
  for (const [off, b] of parts) out.set(b, off);
  return out;
}

// ---------- O que está guardado ----------
export async function mediaEntries() {
  const [items, caps] = await Promise.all([loadItems(), listCaptures().catch(() => [])]);
  return { items, caps };
}
async function findEntry(kind, id) {
  if (kind === 'image') { const c = await getCapture(id); return c?.blob ? { kind, id, at: c.capturedAt || 0, capture: c } : null; }
  const it = (await loadItems()).find((x) => x.id === id && x.type === 'media');
  return it ? { kind: 'post', id, at: it.createdAt || 0, item: it } : null;
}
/** Arquivos de uma entrada: { name, mime, size, path? , blob? }. */
function entryFiles(e) {
  if (e.kind === 'image') {
    const c = e.capture;
    const ext = (c.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const name = /\.[a-z0-9]{2,5}$/i.test(c.fileName || '') ? c.fileName : `${c.fileName || 'imagem'}.${ext}`;
    return [{ name, mime: c.blob.type, size: c.blob.size, blob: c.blob }];
  }
  return filesOf(e.item);
}
async function bytesOf(f, max) {
  if (f.blob) return new Uint8Array(await f.blob.arrayBuffer());
  return readDiskFile(f.path, max);
}

export async function sharedMap() { return (await area().get(SHARED_KEY))[SHARED_KEY] || {}; }
async function markShared(key, patch) {
  const all = await sharedMap();
  all[key] = { ...(all[key] || {}), ...patch, at: Date.now() };
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 300);
  await area().set({ [SHARED_KEY]: Object.fromEntries(keep) });
}

// ---------- 🏠 Rede local: o celular vê as 20 mais recentes ----------
/**
 * Mensagens para a Ponte: primeiro os arquivos ({type:'file'}), depois o envelope ({type:'item'}).
 * `sent` evita mandar de novo o que a Ponte já tem nesta conexão.
 */
export async function lanMediaMessages(share, sent = new Set()) {
  const { items, caps } = await mediaEntries();
  const requested = await sharedMap();
  const who = await me(share);
  const out = [];
  for (const e of lanMediaEntries(items, caps, { requested })) {
    const files = entryFiles(e).map((f, i) => ({ ...f, id: `${e.kind}-${e.id}-${i}`.replace(/[^\w-]/g, '_').slice(0, 100) }));
    const p = mediaPayload(e, who, files);
    const sig = `${p.id}:${files.map((f) => f.path || f.size).join('|')}`; // muda quando o vídeo termina de baixar
    if (sent.has(sig)) continue;
    const msgs = [];
    for (const f of files) {
      if (f.blob) { if (f.blob.size <= MAX_IMAGE_BYTES) msgs.push({ type: 'file', payload: { id: f.id, name: f.name, mime: f.mime, data: b64(new Uint8Array(await f.blob.arrayBuffer())) } }); }
      else msgs.push({ type: 'file', payload: { id: f.id, name: f.name, mime: f.mime, path: f.path } });
    }
    msgs.push({ type: 'item', payload: p });
    out.push({ sig, msgs });
  }
  return out;
}

// ---------- 📤 Mandar pela internet (o que a pessoa escolher) ----------
/**
 * Manda uma entrada da biblioteca pelos caminhos ligados. Cada caminho leva o que cabe no seu limite
 * (nuvem: o configurado, 25 MB; ntfy: 15 MB; Telegram: 50 MB); o resto vai como link e resumo.
 * A rede local também passa a mostrar a entrada, mesmo antiga.
 */
export async function shareMedia(kind, id, { fetchFn = fetch, lan = null } = {}) {
  const share = shareConfig(await clipConfig());
  if (!share.enabled) throw new Error('Ligue o compartilhamento na Área de transferência (botão 📤) para mandar ao celular.');
  if (share.direction === 'receive') throw new Error('Este computador está só recebendo. Mude em Área de transferência → 📤.');
  const e = await findEntry(kind, id);
  if (!e) throw new Error('Esta mídia não existe mais.');
  const who = await me(share);
  const ts = await transports(share, { fetchFn, who });
  const files = entryFiles(e);
  const canRead = files.every((f) => f.blob) || (await ponteAllowed());
  const cache = new Map();
  const getBytes = async (f, max) => { const k = f.path || f.name; if (!cache.has(k)) cache.set(k, await bytesOf(f, max)); return cache.get(k); };
  const via = [];
  const errors = [];
  const skippedAll = new Set();
  for (const [name, t] of Object.entries(ts)) {
    try {
      const max = limitFor(name, share);
      const { fit, skipped } = canRead ? fitFiles(files, max) : { fit: [], skipped: files };
      skipped.forEach((f) => skippedAll.add(f.name));
      if (name === 'telegram') {
        const withBytes = [];
        for (const f of fit) withBytes.push({ ...f, bytes: await getBytes(f, max) });
        await t.sendFiles(mediaPayload(e, who, [], { skipped }), withBytes);
      } else {
        const sent = [];
        for (const [i, f] of fit.entries()) {
          const r = await t.putFile(await getBytes(f, max));
          if (r.sentId) { const s = (await shareState()).ntfy || {}; await patchState('ntfy', { sent: [r.sentId, ...(s.sent || [])].slice(0, 100) }); }
          sent.push({ id: `${i}`, name: f.name, mime: f.mime, size: f.size, ...r });
        }
        const p = mediaPayload(e, who, sent, { skipped });
        p.id = `${p.id}-${Date.now().toString(36)}`; // cada envio é novo (o celular mostra de novo no topo)
        p.at = Date.now();
        const r = await t.send(p);
        if (name === 'ntfy' && r?.id) { const s = (await shareState()).ntfy || {}; await patchState('ntfy', { sent: [r.id, ...(s.sent || [])].slice(0, 100) }); }
      }
      via.push(name);
      await patchState(name, { error: '', lastOk: Date.now() });
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      await patchState(name, { error: err.message });
    }
  }
  if (share.lan.on && lan) via.push('lan');
  await markShared(entryKey(e), { via });
  if (share.lan.on && lan) await lan().catch(() => {});
  if (!via.length) throw new Error(errors[0] || 'Ligue um caminho (nuvem, ntfy, Telegram ou rede local) na Área de transferência → 📤.');
  return { via, errors, skipped: [...skippedAll], noPonte: !canRead };
}

// ---------- 📥 Do celular ----------
export async function inbox() { return (await area().get(INBOX_KEY))[INBOX_KEY] || []; }
async function saveInbox(list) { await area().set({ [INBOX_KEY]: list.slice(0, INBOX_MAX) }); }
export async function patchInbox(id, patch) {
  const list = await inbox();
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) { list[i] = { ...list[i], ...patch }; await saveInbox(list); }
  return list[i];
}
export async function removeInbox(id) { await saveInbox((await inbox()).filter((x) => x.id !== id)); }

/** Pega os bytes de um arquivo que chegou (disco pela Ponte, nuvem ou ntfy). */
export async function inboxBytes(entry, { fetchFn = fetch } = {}) {
  if (entry.path) return readDiskFile(entry.path, 500 * 1024 * 1024);
  const share = shareConfig(await clipConfig());
  const ts = await transports(share, { fetchFn, who: await me(share) });
  const t = entry.drive ? ts.cloud : entry.ntfy ? ts.ntfy : null;
  if (!t) throw new Error(entry.drive ? 'Ligue a nuvem na Área de transferência → 📤 para baixar.' : 'Ligue o ntfy na Área de transferência → 📤 para baixar.');
  return t.getFile(entry);
}

/** Uma mídia chegou de outro aparelho: entra na caixa "Do celular"; imagens também na biblioteca. */
export async function receiveMedia(raw, via, { path = '', fetchFn = fetch } = {}) {
  const p = cleanMediaPayload(raw);
  if (!p) return null;
  const list = await inbox();
  const fresh = inboxEntries(p, via, { path }).filter((x) => !list.some((y) => y.id === x.id));
  if (!fresh.length) return null;
  await saveInbox([...fresh, ...list]);
  for (const x of fresh) {
    if (!/^image\//.test(x.mime) || (x.size && x.size > MAX_IMAGE_BYTES)) continue;
    try {
      const bytes = await inboxBytes(x, { fetchFn });
      const rec = await saveCapture({ blob: new Blob([bytes], { type: x.mime }), fileName: x.name.replace(/\.[a-z0-9]{2,5}$/i, ''), pageTitle: `${x.from} · ${RECEIVED_DIR}`, source: 'phone' });
      await patchInbox(x.id, { captureId: rec?.id || '', imported: Date.now() });
    } catch (e) { await patchInbox(x.id, { error: e.message }); }
  }
  try { chrome.runtime.sendMessage({ type: 'media:inbox' }).catch(() => {}); } catch { /* sem páginas abertas */ }
  return { media: fresh.length };
}

/** Apaga da nuvem as mídias que passaram do prazo (7 dias por padrão). Roda no máximo uma vez por hora. */
export async function cleanupCloudMedia({ fetchFn = fetch, now = Date.now() } = {}) {
  const share = shareConfig(await clipConfig());
  if (!share.enabled || !share.cloud.on) return 0;
  const st = (await shareState()).cloud || {};
  if (now - (st.mediaCleanAt || 0) < 3600e3) return 0;
  const ts = await transports(share, { fetchFn, who: await me(share) });
  if (!ts.cloud) return 0;
  const n = await ts.cloud.cleanup(expiredCloudFiles(await ts.cloud.list(), mediaShareConfig(share).cloudDays, now));
  await patchState('cloud', { mediaCleanAt: now });
  return n;
}

export { LIMITS, baseName };
