// NeuroTab — baixa o vídeo de um item "Mídia" (0.7.11), rodando no service worker.
// 1) Pelo navegador (chrome.downloads), quando a página entrega um .mp4 com áudio: X (FixTweet), TikTok e parte do Instagram.
// 2) Pela NeuroTab Ponte com o yt-dlp (e o ffmpeg para juntar áudio e vídeo), quando o navegador não consegue.
// O andamento fica em chrome.storage.session (nt_media_dl) para a janela do item mostrar.
import { loadData } from './store.js';
import { loadItems, updateItem } from './brain.js';
import { tweetParts } from './media-links.js';
import { NATIVE_HOST } from './clipboard-share.js';
import { ponteAllowed } from './net-ponte.js';
import { sanitizeMediaDl, canDownload, canDownloadAudio, canDownloadPhotos, isYouTubeUrl, dlTarget, pickFxVideo, pickFxPhotos, imageExt, findVideoInPage, findPhotosInPage, netscapeCookies, cookieDomainsFor, DL_ERRORS, DL_STATE_KEY } from './media-download.js';
import { dlSiteOf, extOf } from './media-sites.js';
import { dlKey } from './media-download.js';

export { DL_STATE_KEY };
import { withHiddenTab } from './media-save.js';

const running = new Map(); // id do item → função que cancela

async function setState(id, st) {
  const all = (await chrome.storage.session.get(DL_STATE_KEY).catch(() => ({})))[DL_STATE_KEY] || {};
  if (st) all[id] = { ...st, at: Date.now() };
  else delete all[id];
  await chrome.storage.session.set({ [DL_STATE_KEY]: all }).catch(() => {});
}

class DlError extends Error {
  constructor(code, message) { super(message || DL_ERRORS[code] || code); this.code = code; }
}

const hasPerm = (q) => chrome.permissions.contains(q).catch(() => false);

// ---------- 1) navegador ----------
/** Roda `fn` numa aba com o post: a indicada, uma já aberta ou (com permissão) uma escondida. */
async function inPostTab(it, tabId, fn) {
  if (tabId != null) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url && sameHost(tab.url, it.url)) return fn(tabId);
  }
  const open = (await chrome.tabs.query({}).catch(() => [])).find((x) => x.url && samePage(x.url, it.url));
  if (open) return fn(open.id);
  if (await hasPerm({ origins: [new URL(it.url).origin + '/*'] })) return withHiddenTab(it.url, fn);
  return null;
}

async function findDirect(it, cfg, tabId) {
  const s = dlSiteOf(it.url);
  if (s.direct === 'video') return it.url; // link direto para o arquivo
  const plat = s.site;
  if (plat === 'x') {
    const p = tweetParts(it.url);
    if (p && (await hasPerm({ origins: ['https://api.fxtwitter.com/*'] }))) {
      const r = await fetch(`https://api.fxtwitter.com/${p.user}/status/${p.id}`).catch(() => null);
      if (r?.ok) return pickFxVideo(await r.json(), cfg.quality);
    }
    return '';
  }
  const run = async (tid) => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tid }, world: 'MAIN', func: findVideoInPage, args: [cfg.quality] });
    return r?.result?.url || '';
  };
  return (await inPostTab(it, tabId, run)) || '';
}

/** Fotos do post: X pelo FixTweet; Instagram e TikTok lendo a página (aberta ou escondida). */
async function findPhotos(it, tabId) {
  const s = dlSiteOf(it.url);
  if (s.direct === 'image') return [it.url];
  if (s.site === 'x') {
    const p = tweetParts(it.url);
    if (p && (await hasPerm({ origins: ['https://api.fxtwitter.com/*'] }))) {
      const r = await fetch(`https://api.fxtwitter.com/${p.user}/status/${p.id}`).catch(() => null);
      if (r?.ok) return pickFxPhotos(await r.json());
    }
    return [];
  }
  const run = async (tid) => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tid }, world: 'MAIN', func: findPhotosInPage, args: [20] });
    return r?.result?.urls || [];
  };
  return (await inPostTab(it, tabId, run)) || [];
}

const asciiName = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim() || 'video';
const sameHost = (a, b) => { try { return new URL(a).hostname === new URL(b).hostname; } catch { return false; } };
const samePage = (a, b) => { try { const x = new URL(a); const y = new URL(b); return x.hostname === y.hostname && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, ''); } catch { return false; } };

async function browserDownload(it, url, cfg, { kind = 'video', key = it.id, ext = 'mp4', suffix = '' } = {}) {
  const { dir, name } = dlTarget(it, cfg, kind);
  const go = (d, n) => chrome.downloads.download({ url, filename: `${d}/${n}${suffix}.${ext}`, conflictAction: 'uniquify', saveAs: cfg.saveAs && kind !== 'image' });
  // alguns sistemas recusam acentos no nome do arquivo ("Invalid filename"): tenta de novo sem eles
  const downloadId = await go(dir, name).catch((e) => (/invalid filename/i.test(e?.message) ? go(asciiName(dir), asciiName(name)) : Promise.reject(e)));
  running.set(key, () => chrome.downloads.cancel(downloadId).catch(() => {}));
  // espera terminar, mostrando o andamento (as consultas também mantêm o service worker acordado)
  for (;;) {
    const [d] = await chrome.downloads.search({ id: downloadId });
    if (!d) throw new DlError('failed', 'O download sumiu.');
    if (d.state === 'complete') return { via: 'browser', downloadId, file: d.filename, size: d.fileSize || d.bytesReceived };
    if (d.state === 'interrupted') throw new DlError(d.error === 'USER_CANCELED' ? 'canceled' : 'failed', d.error === 'USER_CANCELED' ? '' : `O navegador não conseguiu baixar (${d.error}).`);
    const pct = d.totalBytes > 0 ? Math.round((d.bytesReceived / d.totalBytes) * 1000) / 10 : 0;
    await setState(key, { state: 'running', via: 'browser', stage: 'download', pct, size: d.totalBytes > 0 ? d.totalBytes : 0 });
    await new Promise((r) => setTimeout(r, 700));
  }
}

// ---------- 2) NeuroTab Ponte ----------
async function siteCookies(it) {
  if (!chrome.cookies || !(await hasPerm({ permissions: ['cookies'] }))) return '';
  const all = [];
  for (const domain of cookieDomainsFor(it.url)) all.push(...(await chrome.cookies.getAll({ domain }).catch(() => [])));
  return netscapeCookies(all);
}

/** Conversa com a Ponte: { type:'dl', op, payload } → eventos até "done" ou erro. */
export function ponteDl(op, payload, onEvent) {
  return new Promise((resolve, reject) => {
    let got = false;
    let end = false;
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    const finish = (fn, v) => { if (end) return; end = true; try { port.disconnect(); } catch { /* já fechou */ } fn(v); };
    port.onMessage.addListener((m) => {
      if (m?.type !== 'dl') return finish(reject, new DlError('old'));
      got = true;
      const p = m.payload || {};
      if (op === 'tools') return finish(resolve, p);
      if (p.stage === 'error') return finish(reject, new DlError(p.code || 'failed', DL_ERRORS[p.code] ? '' : p.error || m.message));
      if (p.stage === 'done') return finish(resolve, p);
      onEvent?.(p);
    });
    port.onDisconnect.addListener(() => {
      const msg = chrome.runtime.lastError?.message || '';
      if (/not found|no such native|not registered|specified native messaging host/i.test(msg)) finish(reject, new DlError('missing'));
      else finish(reject, new DlError(got ? 'failed' : 'old', got ? 'A conexão com a NeuroTab Ponte caiu.' : ''));
    });
    port.postMessage({ type: 'dl', op, ...(payload ? { payload } : {}) });
    onEvent?.({ stage: 'start', cancel: () => finish(reject, new DlError('canceled')) });
  });
}

async function ponteDownload(it, cfg, { audio = false, key = it.id } = {}) {
  if (!chrome.runtime.connectNative || !(await ponteAllowed())) throw new DlError('permission');
  const { dir, name } = dlTarget(it, cfg, audio ? 'audio' : 'video');
  const cookies = cfg.cookies ? await siteCookies(it) : '';
  const r = await ponteDl('get', { url: it.url, dir, name, quality: cfg.quality, cookies, ...(audio ? { audio: true, format: cfg.audioFormat } : {}) }, (ev) => {
    if (ev.stage === 'start') { running.set(key, ev.cancel); return; }
    setState(key, { state: 'running', via: 'ponte', stage: ev.stage, pct: ev.pct || 0, sizeText: ev.size || '' });
  });
  return { via: 'ponte', file: r.file };
}

/** Onde cada tipo fica registrado no item. */
const FIELD = { video: 'download', audio: 'audio', photos: 'photos' };

// ---------- fluxo ----------
/**
 * Baixa o vídeo do item. via: 'ponte' força a Ponte. Devolve { ok, download } ou { error, code, need }.
 * need = 'ponte': o navegador não achou um .mp4 direto e falta a permissão da Ponte (a janela do item pede).
 */
export async function downloadMedia(id, { tabId = null, via = null, what = 'video' } = {}) {
  if (!FIELD[what]) what = 'video';
  const it = (await loadItems()).find((x) => x.id === id);
  if (!it) return { error: 'Item não encontrado.', code: 'failed' };
  if (isYouTubeUrl(it.url)) return { error: DL_ERRORS.youtube, code: 'youtube' };
  const site = dlSiteOf(it.url || '');
  if (site.code === 'drm') return { error: DL_ERRORS.drm, code: 'drm' };
  const can = what === 'audio' ? canDownloadAudio(it) : what === 'photos' ? canDownloadPhotos(it) : canDownload(it);
  if (!can) return { error: DL_ERRORS.site, code: 'site' };
  const key = dlKey(id, what);
  if (running.has(key)) return { error: 'Já está baixando.', code: 'busy' };
  const cfg = sanitizeMediaDl((await loadData()).settings.mediaDl);
  if (what !== 'video') return otherDownload(it, cfg, { what, key, tabId, via, site });
  running.set(id, () => {});
  await setState(id, { state: 'running', via: '', stage: 'find', pct: 0 });
  try {
    let done = null;
    let browserWhy = '';
    if (via !== 'ponte' && cfg.engine !== 'ponte') {
      if (!(await hasPerm({ permissions: ['downloads'] }))) browserWhy = 'Sem a permissão de downloads do navegador.';
      else {
        const url = await findDirect(it, cfg, tabId).catch((e) => { browserWhy = e.message; return ''; });
        if (url) {
          try { done = await browserDownload(it, url, cfg); } catch (e) { if (e.code === 'canceled') throw e; browserWhy = e.message; }
        } else browserWhy ||= 'A página não entrega o vídeo inteiro (vídeo e áudio vêm separados).';
      }
    }
    if (!done) {
      if (cfg.engine === 'browser') throw new DlError('failed', browserWhy + ' Para estes vídeos, use a NeuroTab Ponte (Configurações → Mídia → Baixar vídeos).');
      if (!(await ponteAllowed())) {
        await setState(id, null);
        return { need: 'ponte', error: browserWhy, code: 'permission' };
      }
      done = await ponteDownload(it, cfg);
    }
    const download = { ...done, at: Date.now() };
    const fresh = (await loadItems()).find((x) => x.id === id) || it;
    await updateItem(id, { media: { ...fresh.media, download } });
    await setState(id, { state: 'done', via: done.via, pct: 100 });
    return { ok: true, download };
  } catch (e) {
    const code = e.code || 'failed';
    await setState(id, { state: 'error', code, error: e.message });
    return { error: e.message, code };
  } finally {
    running.delete(id);
  }
}

/** Só o áudio (navegador para arquivo de áudio direto; senão a Ponte) e as fotos do post (navegador). */
async function otherDownload(it, cfg, { what, key, tabId, via, site }) {
  running.set(key, () => {});
  await setState(key, { state: 'running', via: '', stage: 'find', pct: 0 });
  try {
    let done;
    if (what === 'photos') {
      if (!(await hasPerm({ permissions: ['downloads'] }))) throw new DlError('failed', 'Sem a permissão de downloads do navegador.');
      const urls = await findPhotos(it, tabId);
      if (!urls.length) throw new DlError('photos');
      const files = [];
      let first = null;
      for (let i = 0; i < urls.length; i++) {
        await setState(key, { state: 'running', via: 'browser', stage: 'download', pct: Math.round((i / urls.length) * 100) });
        const r = await browserDownload(it, urls[i], cfg, { kind: 'image', key, ext: imageExt(urls[i]), suffix: urls.length > 1 ? ` ${String(i + 1).padStart(2, '0')}` : '' });
        files.push(r.file);
        first ??= r.downloadId;
      }
      done = { via: 'browser', files, count: files.length, downloadId: first };
    } else if (site.direct === 'audio' && via !== 'ponte' && (await hasPerm({ permissions: ['downloads'] }))) {
      done = await browserDownload(it, it.url, cfg, { kind: 'audio', key, ext: extOf(it.url) || 'mp3' });
    } else {
      if (!(await ponteAllowed())) { await setState(key, null); return { need: 'ponte', error: 'Só o áudio é separado pela NeuroTab Ponte (yt-dlp).', code: 'permission' }; }
      done = await ponteDownload(it, cfg, { audio: true, key });
    }
    const rec = { ...done, at: Date.now() };
    const fresh = (await loadItems()).find((x) => x.id === it.id) || it;
    await updateItem(it.id, { media: { ...fresh.media, [FIELD[what]]: rec } });
    await setState(key, { state: 'done', via: done.via, pct: 100 });
    return { ok: true, download: rec };
  } catch (e) {
    const code = e.code || 'failed';
    await setState(key, { state: 'error', code, error: e.message });
    return { error: e.message, code };
  } finally {
    running.delete(key);
  }
}

export function cancelDownload(id) {
  const fn = running.get(id);
  if (fn) fn();
  return !!fn;
}

/** "Mostrar na pasta" / "Abrir": pelo navegador (chrome.downloads) ou pela Ponte (arquivos dela). */
export async function revealDownload(id, { open = false, what = 'video' } = {}) {
  const it = (await loadItems()).find((x) => x.id === id);
  const d = it?.media?.[FIELD[what] || 'download'];
  if (!d) return { error: 'Ainda não foi baixado.' };
  if (d.via === 'browser' && d.downloadId != null && chrome.downloads) {
    const [x] = await chrome.downloads.search({ id: d.downloadId }).catch(() => []);
    if (!x || !x.exists) return { error: 'O arquivo não está mais na pasta.' };
    chrome.downloads.show(d.downloadId);
    return { ok: true };
  }
  if (d.via === 'ponte') {
    try { await ponteDl('reveal', { path: d.file, open }); return { ok: true }; } catch (e) { return { error: e.message }; }
  }
  return { error: 'Não dá para abrir este arquivo daqui.' };
}
