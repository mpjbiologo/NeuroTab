// NeuroTab — catálogo de modelos do recomendador (0.8.1): a cópia que vem na extensão e a versão mais nova
// publicada no repositório (api.github.com, que a extensão já pode acessar), no máximo uma vez por semana.
import { sanitizeCatalog } from './advisor.js';

const KEY = 'nt_catalog';
const URL_GH = 'https://api.github.com/repos/mpjbiologo/NeuroTab/contents/src/data/ollama-models.json?ref=main';
const WEEK = 7 * 24 * 3600e3;

async function bundled() {
  const r = await fetch(chrome.runtime.getURL('src/data/ollama-models.json'));
  return sanitizeCatalog(await r.json());
}

/** O catálogo em uso (o mais novo entre o embutido e o baixado). */
export async function loadCatalog() {
  const base = await bundled();
  const saved = (await chrome.storage.local.get(KEY))[KEY];
  try {
    const c = saved?.data ? sanitizeCatalog(saved.data) : null;
    return c && c.version > base.version ? { ...c, from: 'github', checkedAt: saved.at } : { ...base, from: 'extension', checkedAt: saved?.at || 0 };
  } catch {
    return { ...base, from: 'extension', checkedAt: saved?.at || 0 };
  }
}

/** Procura uma versão nova no GitHub (force: ignora o intervalo de uma semana). Devolve { updated, catalog, error }. */
export async function updateCatalog({ force = false, fetchFn = fetch } = {}) {
  const saved = (await chrome.storage.local.get(KEY))[KEY] || {};
  if (!force && saved.at && Date.now() - saved.at < WEEK) return { updated: false, catalog: await loadCatalog() };
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 10000);
    const r = await fetchFn(URL_GH, { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
    const data = sanitizeCatalog(await r.json());
    const cur = await loadCatalog();
    await chrome.storage.local.set({ [KEY]: { at: Date.now(), data: data.version >= (saved.data?.version || 0) ? data : saved.data } });
    return { updated: data.version > cur.version, catalog: await loadCatalog() };
  } catch (e) {
    await chrome.storage.local.set({ [KEY]: { ...saved, at: Date.now() } });
    return { updated: false, catalog: await loadCatalog(), error: e.message };
  }
}
