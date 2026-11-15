// Camadas, posição dentro da tela e tecla Esc (#35).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAYERS, CONTENT, placeInViewport, normalizeStack, createEscapeStack } from '../../src/lib/layers.js';

const vp = { width: 1000, height: 700 };
const pt = (x, y) => ({ left: x, right: x, top: y, bottom: y });

test('as camadas do código batem com os tokens do CSS', () => {
  const css = readFileSync(new URL('../../src/newtab.css', import.meta.url), 'utf8');
  for (const [k, v] of Object.entries(LAYERS)) assert.match(css, new RegExp(`--z-${k}: ${v};`), k);
  const order = Object.values(LAYERS);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'em ordem crescente');
  assert.ok(CONTENT.freeMax < CONTENT.guides && CONTENT.guides < CONTENT.maximizedBackdrop && CONTENT.maximizedBackdrop < CONTENT.maximized);
  // nenhum z-index numérico solto no CSS, fora dos tokens e do fundo (-1)
  const loose = css.split('\n').filter((l) => /z-index:\s*\d/.test(l) && !/^\s*--z-/.test(l));
  assert.deepEqual(loose, []);
});

test('posição: abaixo e à direita quando cabe', () => {
  assert.deepEqual(placeInViewport({ anchor: pt(100, 100), size: { width: 200, height: 150 }, viewport: vp }), { left: 100, top: 106, width: 200, maxHeight: 586, side: 'below' });
});

test('posição: encosta na borda direita e vira para cima perto do fim da tela', () => {
  const r = placeInViewport({ anchor: pt(950, 650), size: { width: 200, height: 300 }, viewport: vp });
  assert.equal(r.left, 1000 - 8 - 200);
  assert.equal(r.side, 'above');
  assert.equal(r.top, 650 - 6 - 300);
  assert.ok(r.top + 300 <= 700 - 8);
});

test('posição: alto demais para os dois lados limita a altura; largo demais encolhe', () => {
  const r = placeInViewport({ anchor: pt(10, 350), size: { width: 1400, height: 900 }, viewport: vp });
  assert.equal(r.width, 1000 - 16);
  assert.equal(r.left, 8);
  assert.ok(r.top >= 8 && r.top + Math.min(900, r.maxHeight) <= 692, JSON.stringify(r));
  const c = placeInViewport({ anchor: { left: 400, right: 500, top: 50, bottom: 80 }, size: { width: 340, height: 200 }, viewport: vp, align: 'center' });
  assert.equal(c.left, 450 - 170);
});

test('renumerar camadas mantém a ordem', () => {
  assert.deepEqual(normalizeStack([['a', 8200], ['b', 150], ['c', 8001]]), [['b', 100], ['c', 101], ['a', 102]]);
});

test('Esc fecha só a superfície de cima', () => {
  const esc = createEscapeStack();
  const open = { panel: true, max: true, voice: true, menu: false };
  const closed = [];
  const reg = (name, layer) => esc.register({ layer, isOpen: () => open[name], close: () => { open[name] = false; closed.push(name); } });
  reg('panel', 'dock'); reg('max', 'maximized'); reg('voice', 'overlay'); const offMenu = reg('menu', 'popover');
  assert.equal(esc.escape(), true);
  assert.deepEqual(closed, ['voice'], 'a tela de voz (overlay) antes de tudo');
  open.menu = true;
  esc.escape();
  assert.deepEqual(closed, ['voice', 'menu']);
  esc.escape(); esc.escape();
  assert.deepEqual(closed, ['voice', 'menu', 'panel', 'max'], 'barra (dock) acima do widget maximizado');
  assert.equal(esc.escape(), false, 'nada aberto');
  offMenu();
  assert.equal(esc.size, 3);
});
