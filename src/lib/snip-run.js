// NeuroTab — Recorte de tela no fundo (0.9.0, #37): foto da aba (activeTab, sem permissão nova), camada de
// seleção na página e, para a página inteira, várias fotos roladas e juntadas.
import { saveCapture } from './captures.js';
import { scrollPlan, stitchScale } from './snip.js';
import { t } from './i18n.js';

const BLOCKED = /^(chrome|edge|about|brave|opera|vivaldi|chrome-extension|moz-extension|view-source|devtools):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons|addons\.mozilla\.org)/i;
export const SNIP_HINT = 'O navegador não deixa extensões recortarem esta página. Use Win+Shift+S (Windows) ou Cmd+Shift+4 (Mac) e cole com Ctrl+V na Captura rápida da NeuroTab.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const labels = () => ({ tip: t('Arraste para escolher a área · Enter confirma · Esc cancela'), save: '💾 ' + t('Salvar na biblioteca'), copy: '📋 ' + t('Copiar'), note: '📝 ' + t('Salvar e anotar'), cancel: t('Cancelar'), capturing: t('Capturando a página') });

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, func: (l) => { window.__ntSnipLabels = l; }, args: [labels()] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/snip-content.js'] });
}
async function run(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.result;
}

/** Limite do navegador: ~2 fotos por segundo. */
let lastShot = 0;
async function shot(windowId) {
  const wait = 600 - (Date.now() - lastShot);
  if (wait > 0) await sleep(wait);
  lastShot = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

const blobOf = async (dataUrl) => (await fetch(dataUrl)).blob();

async function keep(tab, blob, fileName) {
  return saveCapture({ blob, type: 'image/png', url: '', pageUrl: tab.url || '', pageTitle: tab.title || '', fileName, source: 'region' });
}

/**
 * Recorta uma área (full=false) ou captura a página inteira (full=true).
 * openReview: abre a janelinha "Salvar e anotar" para a imagem salva. Devolve { ok, action, id }.
 */
export async function startSnip(tab, { full = false, openReview = null } = {}) {
  if (!tab?.id || BLOCKED.test(tab.url || '')) throw new Error(t(SNIP_HINT));
  if (full) return fullPage(tab, { openReview });
  let url;
  try { url = await shot(tab.windowId); } catch { throw new Error(t(SNIP_HINT)); }
  try { await inject(tab.id); } catch { throw new Error(t(SNIP_HINT)); }
  const r = await run(tab.id, (u) => window.__ntSnip(u), [url]);
  if (!r || r.action === 'cancel') return { ok: true, action: 'cancel' };
  if (r.action === 'copy' && r.copied) return { ok: true, action: 'copy' };
  const rec = await keep(tab, await blobOf(r.dataUrl), 'recorte');
  if (r.action === 'note' && openReview) await openReview({ kind: 'image', captureId: rec.id, url: tab.url || '', pageTitle: tab.title || '' });
  return { ok: true, action: r.action, id: rec.id, copyFailed: r.action === 'copy' };
}

async function fullPage(tab, { openReview }) {
  try { await inject(tab.id); } catch { throw new Error(t(SNIP_HINT)); }
  const m = await run(tab.id, () => window.__ntSnipFull.measure());
  const plan = scrollPlan(m.pageH, m.viewH);
  const shots = [];
  let cancelled = false;
  try {
    for (let i = 0; i < plan.ys.length; i++) {
      if (await run(tab.id, (a, b) => window.__ntSnipFull.progress(a, b), [i + 1, plan.ys.length])) { cancelled = true; break; }
      const y = await run(tab.id, (yy) => window.__ntSnipFull.scrollTo(yy), [plan.ys[i]]);
      await run(tab.id, () => window.__ntSnipFull.showBox(false));
      const url = await shot(tab.windowId);
      await run(tab.id, () => window.__ntSnipFull.showBox(true));
      shots.push({ y, url });
      if (i === 0) await run(tab.id, () => window.__ntSnipFull.hideFixed());
    }
  } finally {
    const c = await run(tab.id, (y0) => window.__ntSnipFull.restore(y0), [m.y0]).catch(() => false);
    cancelled = cancelled || c;
  }
  if (cancelled || !shots.length) return { ok: true, action: 'cancel' };
  const blob = await stitch(shots, plan.height, m.viewW);
  const rec = await keep(tab, blob, 'pagina-inteira');
  if (openReview) await openReview({ kind: 'image', captureId: rec.id, url: tab.url || '', pageTitle: tab.title || '' });
  return { ok: true, action: 'full', id: rec.id, screens: shots.length, cut: plan.cut };
}

/** Junta as fotos numa imagem só (posição de cada uma pela rolagem real). */
export async function stitch(shots, heightCss, viewW) {
  const bmps = await Promise.all(shots.map(async (s) => ({ y: s.y, b: await createImageBitmap(await blobOf(s.url)) })));
  const k = bmps[0].b.width / viewW; // pixels da foto por px CSS
  const scale = stitchScale(heightCss, k);
  const W = Math.round(bmps[0].b.width * scale);
  const H = Math.round(heightCss * k * scale);
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d');
  for (const { y, b } of bmps) g.drawImage(b, 0, Math.round(y * k * scale), W, Math.round(b.height * scale));
  return c.convertToBlob({ type: 'image/png' });
}
