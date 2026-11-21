// Aparência dos atalhos (#59): estilo, presets, ícones próprios e validação de arquivos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TILES, TILE_PRESETS, sanitizeTiles, presetOf, iconOf, cleanIcon, shapeOf, letterOf, checkIconFile, tileInk, tileColor, ICON_MAX_BYTES,
} from '../../src/lib/tiles.js';
import { normalize, mergeSettings } from '../../src/lib/store.js';

test('estilo dos blocos: valores inválidos voltam ao padrão', () => {
  assert.deepEqual(sanitizeTiles(undefined), DEFAULT_TILES);
  assert.deepEqual(sanitizeTiles({ shape: 'triangulo', size: 'xl', gap: -4, fill: 'x', fillColor: 'blue', opacity: 500, border: 0, shadow: 'sim' }),
    { ...DEFAULT_TILES, gap: 0, opacity: 100, border: false, shadow: true });
  assert.equal(sanitizeTiles({ fillColor: '#ABCDEF' }).fillColor, '#abcdef');
  assert.deepEqual(mergeSettings({}).tiles, DEFAULT_TILES);
});

test('presets: o atual é reconhecido', () => {
  assert.equal(presetOf(DEFAULT_TILES, 4), 'classico');
  assert.equal(presetOf(TILE_PRESETS.bolha.tiles, 12), 'bolha');
  assert.equal(presetOf({ ...DEFAULT_TILES, gap: 3 }, 4), '');
  for (const [id, p] of Object.entries(TILE_PRESETS)) assert.deepEqual(sanitizeTiles(p.tiles), p.tiles, id);
});

test('ícone próprio: só formatos seguros', () => {
  assert.deepEqual(iconOf({}), { kind: 'auto' });
  assert.deepEqual(iconOf({ icon: { kind: 'emoji', value: ' 🎬 ' } }), { kind: 'emoji', value: '🎬' });
  assert.deepEqual(iconOf({ icon: { kind: 'emoji', value: 'texto longo demais' } }), { kind: 'auto' });
  assert.deepEqual(iconOf({ icon: { kind: 'letter', value: 'gmail' } }), { kind: 'letter', value: 'GM' });
  assert.deepEqual(iconOf({ icon: { kind: 'image', src: 'data:image/png;base64,AAAA' } }), { kind: 'image', src: 'data:image/png;base64,AAAA' });
  assert.deepEqual(iconOf({ icon: { kind: 'image', src: 'https://mal.example/x.png' } }), { kind: 'auto' }, 'nada de endereço externo');
  assert.deepEqual(iconOf({ icon: { kind: 'image', src: 'data:image/svg+xml;base64,AAAA' } }), { kind: 'auto' }, 'SVG só depois de virar PNG');
  assert.equal(cleanIcon({ kind: 'emoji', value: '' }), undefined);
});

test('formato por atalho e letra de reserva', () => {
  assert.equal(shapeOf({ shape: 'circle' }, DEFAULT_TILES), 'circle');
  assert.equal(shapeOf({ shape: 'estrela' }, { shape: 'pill' }), 'pill');
  assert.equal(letterOf({ title: '  ótimo site' }), 'Ó');
  assert.equal(letterOf({ title: '', url: 'https://www.github.com/x' }), 'G');
  assert.equal(letterOf({ title: '🎬 Filmes' }), 'F');
});

test('arquivo de ícone: tipo e tamanho conferidos antes de ler', () => {
  assert.equal(checkIconFile({ type: 'image/png', size: 1000 }), '');
  assert.equal(checkIconFile({ type: 'image/svg+xml', size: 1000 }), '');
  assert.match(checkIconFile({ type: 'application/pdf', size: 1000 }), /Formato/);
  assert.match(checkIconFile({ type: 'image/png', size: ICON_MAX_BYTES + 1 }), /grande/);
  assert.match(checkIconFile({ type: 'image/png', size: 0 }), /vazio/);
  assert.match(checkIconFile(null), /Nenhum/);
});

test('cor e texto do bloco acompanham o estilo', () => {
  const l = { color: '#ffd400' };
  assert.equal(tileInk(l, DEFAULT_TILES), '#1d1d1d');
  assert.equal(tileInk({ color: '#1e1b4b' }, DEFAULT_TILES), '#ffffff');
  assert.equal(tileInk(l, { fill: 'none' }), 'var(--text)');
  assert.equal(tileInk(l, { opacity: 30 }), 'var(--text)');
  assert.equal(tileColor(l, { fill: 'single', fillColor: '#123456' }), '#123456');
  assert.equal(tileColor(l, DEFAULT_TILES), '#ffd400');
});

test('atalhos guardam ícone e formato próprios; lixo é descartado', () => {
  const d = normalize({ groups: [{ id: 'g', name: 'G' }], links: [
    { id: 'a', groupId: 'g', url: 'https://a.com', icon: { kind: 'emoji', value: '⭐' }, shape: 'circle' },
    { id: 'b', groupId: 'g', url: 'https://b.com', icon: { kind: 'image', src: 'javascript:alert(1)' }, shape: 'hexagono' },
  ] });
  assert.deepEqual(d.links[0].icon, { kind: 'emoji', value: '⭐' });
  assert.equal(d.links[0].shape, 'circle');
  assert.equal('icon' in d.links[1], false);
  assert.equal('shape' in d.links[1], false);
});
