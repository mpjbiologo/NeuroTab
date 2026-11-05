// NeuroTab — fotos para slides: do computador (IndexedDB) e galerias online (Bing, NASA).
const DB = 'neurotab';
const STORE = 'photos';

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

export async function listLocal() {
  const d = await db();
  return new Promise((res) => {
    const out = [];
    const c = d.transaction(STORE).objectStore(STORE).openCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return res(out.sort((a, b) => a.addedAt - b.addedAt));
      const { id, name, addedAt, w, h } = cur.value;
      out.push({ id, name, addedAt, w, h });
      cur.continue();
    };
    c.onerror = () => res([]);
  });
}

export async function getLocalBlob(id) {
  const d = await db();
  return new Promise((res) => {
    const r = d.transaction(STORE).objectStore(STORE).get(id);
    r.onsuccess = () => res(r.result?.blob || null);
    r.onerror = () => res(null);
  });
}

export const deleteLocal = (id) => tx('readwrite', (s) => s.delete(id));
export const clearLocal = () => tx('readwrite', (s) => s.clear());

/** Reduz para no máx. 2560 px e grava em JPEG. onProgress(feitas, total) */
export async function addFiles(files, onProgress) {
  const imgs = [...files].filter((f) => /^image\//.test(f.type));
  let done = 0;
  for (const f of imgs) {
    try {
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
      const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
      const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: f.name, addedAt: Date.now(), w: c.width, h: c.height, blob };
      await tx('readwrite', (s) => s.put(rec));
    } catch (e) {
      console.warn('Foto ignorada:', f.name, e);
    }
    onProgress?.(++done, imgs.length);
  }
  return done;
}

// ---------- Galerias online ----------
const CACHE = 'nt_cache_gallery';

async function cached(key, ttl, fn) {
  const all = (await chrome.storage.local.get(CACHE))[CACHE] || {};
  if (all[key] && Date.now() - all[key].at < ttl) return all[key].list;
  try {
    const list = await fn();
    if (list.length) await chrome.storage.local.set({ [CACHE]: { ...all, [key]: { at: Date.now(), list } } });
    return list;
  } catch (e) {
    console.warn(e);
    return all[key]?.list || [];
  }
}

export function bingPhotos() {
  return cached('bing', 6 * 3600e3, async () => {
    const r = await (await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=pt-BR')).json();
    return (r.images || []).map((i) => ({
      url: 'https://www.bing.com' + i.url.replace(/_\d+x\d+\.jpg/, '_UHD.jpg'),
      title: i.title || '',
      credit: i.copyright || 'Bing',
      link: i.copyrightlink || 'https://www.bing.com',
    }));
  });
}

export function nasaPhotos() {
  return cached('nasa', 12 * 3600e3, async () => {
    const r = await (await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=12&thumbs=true')).json();
    return (Array.isArray(r) ? r : [])
      .filter((i) => i.media_type === 'image' && i.url)
      .map((i) => ({ url: i.hdurl || i.url, title: i.title, credit: `NASA APOD${i.copyright ? ' · ' + i.copyright.trim() : ''}`, link: `https://apod.nasa.gov/apod/ap${i.date.slice(2).replace(/-/g, '')}.html` }));
  });
}

/** Lista unificada: { kind: 'local'|'web', id?, url?, title, credit, link } */
export async function photoList(source = 'local') {
  const out = [];
  if (source === 'local' || source === 'all') out.push(...(await listLocal()).map((p) => ({ kind: 'local', id: p.id, title: p.name.replace(/\.[^.]+$/, ''), credit: 'Suas fotos' })));
  if (source === 'bing' || source === 'all') out.push(...(await bingPhotos()).map((p) => ({ kind: 'web', ...p })));
  if (source === 'nasa' || source === 'all') out.push(...(await nasaPhotos()).map((p) => ({ kind: 'web', ...p })));
  return out;
}

const urlCache = new Map();
export async function photoUrl(p) {
  if (p.kind === 'web') return p.url;
  if (urlCache.has(p.id)) return urlCache.get(p.id);
  const b = await getLocalBlob(p.id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urlCache.set(p.id, u);
  return u;
}

export function preload(url) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(true);
    i.onerror = () => res(false);
    i.src = url;
  });
}

export const SOURCES = { local: '🖼 Minhas fotos', bing: '🌍 Foto do dia (Bing)', nasa: '🔭 Astronomia (NASA)', all: '🔀 Todas' };
