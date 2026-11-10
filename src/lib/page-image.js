// NeuroTab — pegar uma imagem de dentro da página quando o download direto não funciona.
//
// Casos que o download direto (sem login, sem cookies) não resolve:
//   • imagens atrás de login (ChatGPT, Google Fotos, Drive, webmail, intranets…)
//   • endereços blob: (imagem gerada dentro da página) e http:
//   • sites que bloqueiam "hotlink" (só entregam a imagem para quem vem da própria página)
//   • servidores que mandam a imagem como application/octet-stream
//
// Ordem das tentativas, todas na aba onde a pessoa clicou (a permissão vem do próprio clique, activeTab):
//   1) baixar de dentro da página, com o login dela (o login não sai do navegador)
//   2) copiar os pixels da imagem já carregada (canvas)
//   3) recortar a imagem de uma captura da parte visível da aba (qualidade de tela)
import { MAX_IMAGE_BYTES, saveCapture } from './captures.js';

export { sniffImageType } from './captures.js';

/**
 * Converte o retângulo da imagem (pixels CSS da janela) para pixels da captura de tela.
 * Usa a proporção real entre a captura e a janela (mais confiável que devicePixelRatio).
 * Devolve null se a imagem não estiver visível.
 */
export function cropRect(rect, viewport, shot) {
  const sx = shot.width / viewport.width;
  const sy = shot.height / viewport.height;
  const x0 = Math.max(0, Math.round(rect.x * sx));
  const y0 = Math.max(0, Math.round(rect.y * sy));
  const x1 = Math.min(shot.width, Math.round((rect.x + rect.width) * sx));
  const y1 = Math.min(shot.height, Math.round((rect.y + rect.height) * sy));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Roda DENTRO da página (chrome.scripting.executeScript). Precisa ser autocontida.
 * Devolve { dataUrl, type, via } quando consegue; senão, a posição da imagem na tela para o recorte.
 */
export async function pageGrab(src, maxBytes) {
  const toDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const all = [...document.images];
  const el = all.find((i) => i.currentSrc === src) || all.find((i) => i.src === src) || null;

  // 1) Baixar daqui de dentro, como a própria página faria (com o login dela).
  try {
    const res = await fetch(src, { credentials: 'include' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > maxBytes) return { tooBig: true };
      if (blob.size) return { via: 'fetch', dataUrl: await toDataUrl(blob), type: blob.type || res.headers.get('content-type') || '' };
    }
  } catch { /* bloqueado pelo site (CORS) ou fora do ar: tenta o próximo jeito */ }

  // 2) Copiar os pixels da imagem já carregada (não funciona se a imagem vier de outro site sem permissão).
  if (el?.complete && el.naturalWidth) {
    try {
      const c = document.createElement('canvas');
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      c.getContext('2d').drawImage(el, 0, 0);
      let dataUrl = c.toDataURL('image/png');
      let type = 'image/png';
      if (dataUrl.length * 0.75 > maxBytes) { dataUrl = c.toDataURL('image/jpeg', 0.9); type = 'image/jpeg'; }
      if (dataUrl.length * 0.75 <= maxBytes) return { via: 'canvas', dataUrl, type };
    } catch { /* canvas "contaminado" por imagem de outro site */ }
  }

  // 3) Informar onde a imagem está na tela, para recortar de uma captura da aba.
  if (el && window === window.top) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = el.getBoundingClientRect();
    return { rect: { x: r.left, y: r.top, width: r.width, height: r.height }, viewport: { width: innerWidth, height: innerHeight } };
  }
  return { notFound: !el, inFrame: window !== window.top };
}

const FAIL_TIP = 'Dica: clique com o botão direito na imagem → Copiar imagem e cole com Ctrl+V na Captura rápida.';

/** Recorta um retângulo de uma imagem (dataURL da captura de tela) e devolve um PNG. */
async function cropScreenshot(shotDataUrl, rect, viewport) {
  const bmp = await createImageBitmap(await (await fetch(shotDataUrl)).blob());
  const box = cropRect(rect, viewport, bmp);
  if (!box) throw new Error('A imagem não está visível na tela.');
  const canvas = new OffscreenCanvas(box.width, box.height);
  canvas.getContext('2d').drawImage(bmp, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Tenta pegar a imagem na aba e salvar na biblioteca.
 * `deps` existe para os testes (no navegador usa as APIs de verdade).
 */
export async function grabAndSave(src, meta, { tabId, frameId = 0, windowId } = {}, deps = {}) {
  const scripting = deps.scripting || chrome.scripting;
  const tabs = deps.tabs || chrome.tabs;
  const crop = deps.cropScreenshot || cropScreenshot;
  const save = deps.saveCapture || saveCapture;
  if (tabId == null) throw new Error('Não foi possível acessar a aba da imagem. ' + FAIL_TIP);

  let result;
  try {
    const [first] = await scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: pageGrab, args: [src, MAX_IMAGE_BYTES] });
    result = first?.result || {};
  } catch {
    throw new Error('Este site não deixa extensões lerem a página. ' + FAIL_TIP);
  }
  if (result.tooBig) throw new Error('Imagem maior que 12 MB. Escolha uma versão menor.');

  const isHttp = /^https?:/i.test(src);
  const fileName = (() => { try { return decodeURIComponent(new URL(src).pathname.split('/').pop() || '') || 'imagem'; } catch { return 'imagem'; } })();
  if (result.dataUrl) {
    const blob = await (await fetch(result.dataUrl)).blob();
    return save({ ...meta, blob, type: result.type || '', url: isHttp ? src : '', fileName: isHttp ? fileName : 'imagem' });
  }
  if (result.rect) {
    const shot = await tabs.captureVisibleTab(windowId ?? null, { format: 'png' });
    const blob = await crop(shot, result.rect, result.viewport);
    return save({ ...meta, blob, type: 'image/png', url: isHttp ? src : '', fileName: 'imagem-recortada.png', source: 'screenshot' });
  }
  throw new Error((result.inFrame ? 'A imagem está dentro de um quadro (iframe) e não pôde ser lida. ' : 'Não foi possível pegar esta imagem. ') + FAIL_TIP);
}
