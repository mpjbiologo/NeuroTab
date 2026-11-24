// NeuroTab — Recorte de tela (0.9.0, #37): contas puras do recorte e da captura rolada.

/**
 * Retângulo escolhido na tela (px CSS) → pixels da captura. A captura tem `imgW`×`imgH` e a janela
 * `vw`×`vh` px CSS (zoom e telas de alta resolução mudam a proporção). Seleção fora da tela é cortada.
 * (A mesma função é copiada em src/snip-content.js; o teste confere que as duas são iguais.)
 */
export function toPixels(rect, { imgW, imgH, vw, vh }) {
  const kx = imgW / vw;
  const ky = imgH / vh;
  const x0 = Math.max(0, Math.min(vw, Math.min(rect.x, rect.x + rect.w)));
  const y0 = Math.max(0, Math.min(vh, Math.min(rect.y, rect.y + rect.h)));
  const x1 = Math.max(0, Math.min(vw, Math.max(rect.x, rect.x + rect.w)));
  const y1 = Math.max(0, Math.min(vh, Math.max(rect.y, rect.y + rect.h)));
  const sx = Math.round(x0 * kx);
  const sy = Math.round(y0 * ky);
  return { sx, sy, sw: Math.max(0, Math.round(x1 * kx) - sx), sh: Math.max(0, Math.round(y1 * ky) - sy) };
}

export const MAX_SCREENS = 20;
export const MAX_HEIGHT_PX = 16384; // limite seguro de altura de uma imagem no navegador

/**
 * Plano da captura rolada: posições de rolagem (px CSS) para cobrir a página, no máximo `MAX_SCREENS` telas.
 * Cada tela sobrepõe a anterior em `overlap` px (barras fixas escondidas depois da primeira foto).
 */
export function scrollPlan(pageH, viewH, { overlap = 0, max = MAX_SCREENS } = {}) {
  const total = Math.min(pageH, viewH * max);
  const step = Math.max(1, viewH - overlap);
  const ys = [];
  for (let y = 0; y < total; y += step) {
    const last = Math.max(0, total - viewH);
    ys.push(Math.min(y, last));
    if (y >= last) break;
  }
  return { ys: [...new Set(ys)], height: total, cut: pageH > total };
}

/** Escala para a imagem final não passar do limite de altura. */
export const stitchScale = (heightCss, ky) => Math.min(1, MAX_HEIGHT_PX / Math.max(1, heightCss * ky));
