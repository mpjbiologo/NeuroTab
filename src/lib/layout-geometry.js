// NeuroTab — geometria do painel de widgets, sem depender da tela (testável).
// Retângulos: { l, t, r, b } em pixels (esquerda, topo, direita, base).

/** Colunas da grade conforme a largura disponível: 12 (largo), 6 (médio) ou 1 (estreito). */
export function gridColsFor(width) {
  return width >= 1000 ? 12 : width >= 620 ? 6 : 1;
}

/** Largura (em colunas) de um widget de largura `w` (em 12 avos) numa grade de `cols` colunas. */
export function spanFor(w, cols) {
  if (cols === 12) return w;
  if (cols === 6) return w >= 7 ? 6 : 3;
  return 1;
}

/** O retângulo encosta (ou chega a menos de `gap` px) em algum obstáculo? */
export function overlapsAny(rect, obstacles, gap = 12) {
  return obstacles.some((o) => rect.l < o.r + gap && rect.r > o.l - gap && rect.t < o.b + gap && rect.b > o.t - gap);
}

/**
 * Primeiro espaço livre de cima para baixo, da esquerda para a direita.
 * Devolve { x, y } ou null se não couber até `maxY`.
 */
export function firstFreeSpot({ width, height, W, obstacles, gap = 12, stepY = 20, stepX = Math.max(20, W / 48), maxY = 6000 }) {
  for (let y = 0; y < maxY; y += stepY) {
    for (let x = 0; x + width <= W + 1; x += stepX) {
      if (!overlapsAny({ l: x, t: y, r: x + width, b: y + height }, obstacles, gap)) return { x, y };
    }
  }
  return null;
}

/**
 * Posição livre mais próxima da desejada, priorizando deslocamentos pequenos
 * (um pouco mais de peso no vertical). Devolve { x, y, w, h } ou null.
 */
export function nearestFreePosition({ W, desired, obstacles, gap = 12 }) {
  const width = Math.min(W, desired.w);
  const height = desired.h;
  const clampX = (x) => Math.max(0, Math.min(W - width, x));
  const xs = new Set([0, Math.max(0, W - width), clampX(desired.x)]);
  const ys = new Set([0, Math.max(0, desired.y)]);
  for (const o of obstacles) {
    xs.add(clampX(o.l - width - gap));
    xs.add(clampX(o.r + gap));
    ys.add(Math.max(0, o.t - height - gap));
    ys.add(Math.max(0, o.b + gap));
  }
  const cost = (p) => Math.abs(p.x - desired.x) + Math.abs(p.y - desired.y) * 1.15;
  const candidates = [];
  for (const x of xs) for (const y of ys) candidates.push({ x, y });
  candidates.sort((a, b) => cost(a) - cost(b));
  const valid = (p) => !overlapsAny({ l: p.x, t: p.y, r: p.x + width, b: p.y + height }, obstacles, gap);
  const found = candidates.find(valid);
  if (found) return { ...found, w: width, h: height };

  // Plano B em grade: útil quando as posições existentes ocupam quase toda a largura.
  const bottom = Math.max(desired.y + 1600, ...obstacles.map((o) => o.b + height + 32));
  for (let y = 0; y <= bottom; y += 24) {
    for (let x = 0; x + width <= W + 1; x += 24) {
      if (valid({ x, y })) return { x, y, w: width, h: height };
    }
  }
  return null;
}

/**
 * Encaixe nas guias: entre as bordas candidatas (`cands`) e as linhas-alvo (`targets`),
 * a menor distância até `th` px. Devolve { d, at } (deslocamento e linha) ou null.
 */
export function snapAxis(cands, targets, th = 8) {
  let best = null;
  for (const c of cands) for (const t of targets) {
    const d = t - c;
    if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
  }
  return best;
}
