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

// ---------------------------------------------------------------------
// Layout automático (0.9.2.2): linhas completas e simétricas.
// ---------------------------------------------------------------------
const MAX_PER_ROW = 4;

/** Larguras simétricas de uma linha de 12 colunas a partir das preferências (em 12 avos). */
function rowSpans12(prefs) {
  const n = prefs.length;
  if (n === 1) return [12];
  if (n === 2) {
    const r = prefs[0] / prefs[1];
    return r >= 1.6 ? [8, 4] : r <= 1 / 1.6 ? [4, 8] : [6, 6];
  }
  if (n === 3) {
    const big = prefs.indexOf(Math.max(...prefs));
    const rest = prefs.filter((_, i) => i !== big);
    if (prefs[big] >= 2 * Math.max(...rest)) return prefs.map((_, i) => (i === big ? 6 : 3));
    return [4, 4, 4];
  }
  return prefs.map(() => 12 / n);
}

/**
 * Divide os widgets em linhas que ocupam a largura toda, com larguras simétricas
 * (12 · 6+6 · 8+4 · 4+4+4 · 3+3+3+3). Mantém a ordem; evita sobrar um widget sozinho na última linha.
 * `items`: [{ w }] (largura preferida em 12 avos). Devolve [[{ idx, span }]] com `span` em colunas de `cols`.
 */
export function autoRows(items, cols = 12) {
  if (cols <= 1) return items.map((_, idx) => [{ idx, span: 1 }]);
  const unit = cols === 12 ? 12 : 6;
  const pref = (w) => {
    const v = Math.max(3, Math.min(12, Math.round(w || 6)));
    return unit === 12 ? v : v >= 7 ? 6 : 3;
  };
  const max = unit === 12 ? MAX_PER_ROW : 2;
  const rows = [];
  let row = [];
  let sum = 0;
  items.forEach((it, idx) => {
    const p = pref(it.w);
    if (row.length && (sum + p > unit || row.length >= max)) { rows.push(row); row = []; sum = 0; }
    row.push({ idx, p });
    sum += p;
  });
  if (row.length) rows.push(row);
  // Última linha com um só (estreito) e a anterior cheia de pequenos: passa um para baixo.
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  if (prev && last.length === 1 && last[0].p <= unit / 2 && prev.length >= 3) last.unshift(prev.pop());
  return rows.map((r) => {
    const spans = unit === 12 ? rowSpans12(r.map((x) => x.p)) : r.length === 1 ? [6] : [3, 3];
    return r.map((x, i) => ({ idx: x.idx, span: spans[i] }));
  });
}

/**
 * Retângulos do modo livre para as linhas de `autoRows`: colunas iguais, a mesma altura
 * em toda a linha (a maior, entre `minH` e `maxH`), começando em `top`.
 * `heights[idx]`: altura atual de cada widget. Devolve [{ idx, x, y, w, h }].
 */
export function arrangeRects({ rows, W, cols = 12, gap = 16, heights = [], top = 0, minH = 200, maxH = 520 }) {
  const colW = (W - gap * (cols - 1)) / cols;
  const out = [];
  let y = top;
  for (const row of rows) {
    const h = Math.round(Math.max(minH, Math.min(maxH, Math.max(...row.map((c) => heights[c.idx] || 320)))));
    let col = 0;
    for (const c of row) {
      out.push({ idx: c.idx, x: Math.round(col * (colW + gap)), y, w: Math.round(c.span * colW + (c.span - 1) * gap), h });
      col += c.span;
    }
    y += h + gap;
  }
  return out;
}
