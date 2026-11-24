// Central do botão direito (#55/#56/#12/#37): ações por contexto, favoritas, ocultas, ordem, dados extraídos e recorte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, menuPlan, actionsFor, sanitizeMenu, orderedActions, extractData, DOC_PATTERNS, DEFAULT_MENU, aiPrompt } from '../../src/lib/menu-actions.js';
import { toPixels, scrollPlan, stitchScale, MAX_HEIGHT_PX } from '../../src/lib/snip.js';
import { mergeSettings } from '../../src/lib/store.js';

const ids = (list) => list.map((a) => a.id);

test('cada contexto mostra só o que serve', () => {
  const sel = ids(actionsFor({}, 'selection'));
  for (const id of ['sel-note', 'sel-task', 'sel-remind', 'sel-join', 'ai-summary', 'ai-explain', 'ai-translate', 'sel-extract', 'sel-search', 'sel-route', 'snip']) assert.ok(sel.includes(id), id);
  assert.ok(!sel.includes('img-save') && !sel.includes('page-save'));
  assert.deepEqual(ids(actionsFor({}, 'image')), ['img-save', 'img-analyze', 'img-ocr', 'img-note', 'snip']);
  const link = ids(actionsFor({}, 'link'));
  assert.ok(link.includes('link-doc') && link.includes('add') && !link.includes('sel-note'));
  const page = ids(actionsFor({}, 'page'));
  for (const id of ['page-save', 'page-media', 'page-summary', 'page-note', 'media-dl', 'snip', 'snip-full', 'add']) assert.ok(page.includes(id), id);
  assert.equal(new Set(ACTIONS.map((a) => a.id)).size, ACTIONS.length, 'ids únicos');
});

test('plano do menu: favoritas no topo, IA e "Mais" em submenus, grupos de atalhos', () => {
  const plan = menuPlan({}, [{ id: 'g1', icon: '⭐', name: 'Favoritos' }]);
  assert.equal(plan[0].id, 'nt-root');
  const root = plan.filter((x) => x.parentId === 'nt-root').map((x) => x.id);
  for (const f of DEFAULT_MENU.fav) assert.ok(root.includes('nt-' + f), f);
  assert.ok(root.includes('nt-ai') && root.includes('nt-more'));
  assert.ok(plan.find((x) => x.id === 'nt-ai-summary').parentId === 'nt-ai');
  assert.ok(plan.find((x) => x.id === 'nt-sel-remind').parentId === 'nt-more');
  assert.deepEqual(plan.find((x) => x.id === 'nt-g-g1'), { id: 'nt-g-g1', parentId: 'nt-add', title: '⭐ Favoritos', contexts: ['page', 'link'] });
  assert.deepEqual(plan.find((x) => x.id === 'nt-link-doc').targetUrlPatterns, DOC_PATTERNS);
  assert.ok(plan.find((x) => x.id === 'nt-media-dl').dl);
  // a raiz aparece em todo contexto que tem alguma ação
  assert.deepEqual(new Set(plan[0].contexts), new Set(['selection', 'page', 'link', 'image', 'video']));
  assert.ok(DOC_PATTERNS.includes('*://*/*.pdf'));
});

test('favoritar, ocultar e reordenar', () => {
  const m = { fav: ['sel-remind'], hidden: ['sel-search', 'ai-explain'], order: ['sel-remind', 'sel-note'] };
  assert.deepEqual(ids(orderedActions(m)).slice(0, 2), ['sel-remind', 'sel-note']);
  assert.equal(ids(orderedActions(m)).length, ACTIONS.length, 'ações novas entram no fim');
  const sel = ids(actionsFor(m, 'selection'));
  assert.ok(!sel.includes('sel-search') && !sel.includes('ai-explain'));
  assert.equal(sel[0], 'sel-remind');
  const plan = menuPlan(m);
  assert.equal(plan.find((x) => x.id === 'nt-sel-remind').parentId, 'nt-root');
  assert.equal(plan.find((x) => x.id === 'nt-sel-note').parentId, 'nt-more', 'deixou de ser favorita');
  assert.equal(plan.find((x) => x.id === 'nt-sel-search'), undefined);
  // tudo de IA oculto: sem submenu vazio
  const noAi = menuPlan({ hidden: ACTIONS.filter((a) => a.group === 'ai').map((a) => a.id) });
  assert.equal(noAi.find((x) => x.id === 'nt-ai'), undefined);
  assert.deepEqual(sanitizeMenu({ fav: ['nada', 'snip', 'snip'], hidden: 'x' }), { order: [], hidden: [], fav: ['snip'] });
  assert.deepEqual(mergeSettings({}).menu, DEFAULT_MENU);
});

test('extrair dados do trecho, sem IA', () => {
  const x = extractData('Ligue para (37) 99833-6210 ou +55 31 3333-4444, mande para ana@ex.com.br até 25/12/2026 às 14h30. Preço: R$ 1.299,90. Site: https://ex.com/a.');
  assert.deepEqual(x.emails, ['ana@ex.com.br']);
  assert.equal(x.phones.length, 2);
  assert.deepEqual(x.dates, ['25/12/2026']);
  assert.deepEqual(x.times, ['14h30']);
  assert.deepEqual(x.prices, ['R$ 1.299,90']);
  assert.deepEqual(x.urls, ['https://ex.com/a']);
  assert.deepEqual(extractData('nada aqui').emails, []);
  assert.match(aiPrompt('translate', 'pt-BR', 'Inglês'), /Traduza o texto abaixo para Inglês/);
});

test('recorte: retângulo da tela → pixels da foto (zoom e telas de alta resolução)', () => {
  const r = { x: 100, y: 50, w: 200, h: 100 };
  assert.deepEqual(toPixels(r, { imgW: 800, imgH: 600, vw: 800, vh: 600 }), { sx: 100, sy: 50, sw: 200, sh: 100 });
  assert.deepEqual(toPixels(r, { imgW: 1000, imgH: 750, vw: 800, vh: 600 }), { sx: 125, sy: 63, sw: 250, sh: 125 }, '125%');
  assert.deepEqual(toPixels(r, { imgW: 1600, imgH: 1200, vw: 800, vh: 600 }), { sx: 200, sy: 100, sw: 400, sh: 200 }, '200%');
  assert.deepEqual(toPixels({ x: 300, y: 200, w: -200, h: -100 }, { imgW: 800, imgH: 600, vw: 800, vh: 600 }), { sx: 100, sy: 100, sw: 200, sh: 100 }, 'arrastando para trás');
  assert.deepEqual(toPixels({ x: 700, y: 550, w: 300, h: 300 }, { imgW: 800, imgH: 600, vw: 800, vh: 600 }), { sx: 700, sy: 550, sw: 100, sh: 50 }, 'saindo da tela');
  const src = readFileSync(new URL('../../src/snip-content.js', import.meta.url), 'utf8');
  const body = (fn) => fn.toString().replace(/\s+/g, ' ').trim();
  const inContent = src.slice(src.indexOf('function toPixels'), src.indexOf('\n  }\n', src.indexOf('function toPixels')) + 4);
  assert.equal(body(inContent), body(toPixels.toString().replace(/^export /, '')), 'a cópia na página é igual à testada');
});

test('captura rolada: posições, limite de telas e de altura', () => {
  assert.deepEqual(scrollPlan(2500, 1000), { ys: [0, 1000, 1500], height: 2500, cut: false });
  assert.deepEqual(scrollPlan(800, 1000), { ys: [0], height: 800, cut: false });
  const long = scrollPlan(100000, 1000);
  assert.equal(long.ys.length, 20);
  assert.equal(long.height, 20000);
  assert.ok(long.cut);
  assert.equal(stitchScale(1000, 2), 1);
  assert.ok(stitchScale(20000, 2) * 20000 * 2 <= MAX_HEIGHT_PX);
});
