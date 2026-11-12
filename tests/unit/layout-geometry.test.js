// Geometria do painel: colunas, sobreposição, espaço livre e encaixe nas guias.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridColsFor, spanFor, overlapsAny, firstFreeSpot, nearestFreePosition, snapAxis } from '../../src/lib/layout-geometry.js';

const R = (l, t, w, h) => ({ l, t, r: l + w, b: t + h });

test('colunas da grade pela largura e largura de cada widget', () => {
  assert.equal(gridColsFor(1366), 12);
  assert.equal(gridColsFor(1000), 12);
  assert.equal(gridColsFor(999), 6);
  assert.equal(gridColsFor(620), 6);
  assert.equal(gridColsFor(400), 1);
  assert.equal(spanFor(4, 12), 4);
  assert.equal(spanFor(4, 6), 3);
  assert.equal(spanFor(8, 6), 6);
  assert.equal(spanFor(12, 1), 1);
});

test('sobreposição respeita a folga entre widgets', () => {
  const obs = [R(0, 0, 100, 100)];
  assert.equal(overlapsAny(R(50, 50, 10, 10), obs), true);
  assert.equal(overlapsAny(R(105, 0, 50, 50), obs), true, 'a 5 px ainda conta (folga 12)');
  assert.equal(overlapsAny(R(112, 0, 50, 50), obs), false);
  assert.equal(overlapsAny(R(105, 0, 50, 50), obs, 0), false, 'sem folga');
  assert.equal(overlapsAny(R(0, 0, 10, 10), []), false);
});

test('primeiro espaço livre: ao lado se couber, senão embaixo', () => {
  const W = 1000;
  assert.deepEqual(firstFreeSpot({ width: 400, height: 200, W, obstacles: [] }), { x: 0, y: 0 });
  const side = firstFreeSpot({ width: 400, height: 200, W, obstacles: [R(0, 0, 500, 300)] });
  assert.ok(side.y === 0 && side.x >= 512, JSON.stringify(side));
  const below = firstFreeSpot({ width: 600, height: 200, W, obstacles: [R(0, 0, 500, 300)] });
  assert.ok(below.y >= 312, JSON.stringify(below));
  assert.equal(firstFreeSpot({ width: 100, height: 100, W: 200, obstacles: [R(0, 0, 200, 1000)], maxY: 500 }), null);
});

test('posição livre mais próxima: desloca pouco e nunca sobrepõe', () => {
  const W = 1200;
  const obstacles = [R(0, 0, 400, 300), R(420, 0, 400, 300)];
  const p = nearestFreePosition({ W, desired: { x: 380, y: 20, w: 300, h: 200 }, obstacles });
  assert.ok(p, 'achou posição');
  assert.equal(overlapsAny({ l: p.x, t: p.y, r: p.x + p.w, b: p.y + p.h }, obstacles), false);
  assert.deepEqual([p.w, p.h], [300, 200]);
  // sem obstáculos, fica onde pediu
  assert.deepEqual(nearestFreePosition({ W, desired: { x: 50, y: 60, w: 300, h: 200 }, obstacles: [] }), { x: 50, y: 60, w: 300, h: 200 });
  // mais largo que a área: encolhe para caber
  assert.equal(nearestFreePosition({ W: 500, desired: { x: 0, y: 0, w: 900, h: 100 }, obstacles: [] }).w, 500);
});

test('encaixe nas guias: menor distância dentro do limite', () => {
  assert.deepEqual(snapAxis([100, 300], [104, 296]), { d: 4, at: 104 });
  assert.deepEqual(snapAxis([100], [97, 105]), { d: -3, at: 97 });
  assert.equal(snapAxis([100], [120]), null);
  assert.deepEqual(snapAxis([100], [120], 30), { d: 20, at: 120 });
});
