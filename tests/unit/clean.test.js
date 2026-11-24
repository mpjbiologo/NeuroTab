// Modo Clean (#69): opções, relógio, barra do dia, data e atalhos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeClean, DEFAULT_CLEAN, clockParts, dayProgress, dateLabel, cleanLinks, CLEAN_FONTS } from '../../src/lib/clean.js';
import { mergeSettings } from '../../src/lib/store.js';

test('opções conferidas, com padrões', () => {
  assert.deepEqual(sanitizeClean(), DEFAULT_CLEAN);
  const c = sanitizeClean({ on: 'sim', links: 'x', count: 13, cols: 9, font: 'comic', dim: 500, blur: 'strong', h12: true });
  assert.equal(c.on, false);
  assert.equal(c.links, 'icon_text');
  assert.equal(c.count, 8);
  assert.equal(c.cols, 3);
  assert.equal(c.font, 'playfair');
  assert.equal(c.dim, 70);
  assert.equal(c.blur, 'strong');
  assert.equal(c.h12, true);
  assert.equal(sanitizeClean({ count: '0' }).count, 0);
  assert.ok(CLEAN_FONTS.playfair.css.includes('Playfair NT'));
  assert.deepEqual(mergeSettings({}).clean, DEFAULT_CLEAN);
  assert.equal(mergeSettings({ clean: { on: true, links: 'icon' } }).clean.links, 'icon');
});

test('relógio: 24 h, 12 h e segundos', () => {
  const d = new Date(2026, 10, 24, 19, 5, 9);
  assert.deepEqual(clockParts(d), { parts: ['19', '05'], suffix: '' });
  assert.deepEqual(clockParts(d, { h12: true }), { parts: ['7', '05'], suffix: 'PM' });
  assert.deepEqual(clockParts(new Date(2026, 0, 1, 0, 0), { h12: true }), { parts: ['12', '00'], suffix: 'AM' });
  assert.deepEqual(clockParts(d, { seconds: true }).parts, ['19', '05', '09']);
});

test('barra do dia e data', () => {
  assert.equal(dayProgress(new Date(2026, 0, 1, 0, 0, 0)), 0);
  assert.equal(dayProgress(new Date(2026, 0, 1, 12, 0, 0)), 0.5);
  assert.ok(Math.abs(dayProgress(new Date(2026, 0, 1, 19, 31)) - 0.8132) < 0.001);
  assert.equal(dateLabel(new Date(2026, 10, 23), 'pt-BR'), 'SEG · 23 NOV');
  assert.equal(dateLabel(new Date(2026, 10, 23), 'en-US'), 'MON · 23 NOV');
});

test('atalhos do grupo escolhido, na ordem, limitados', () => {
  const data = { groups: [{ id: 'a' }, { id: 'b' }], links: [...Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i, groupId: 'a' })), { id: 'b1', groupId: 'b' }] };
  assert.equal(cleanLinks(data, { group: '', count: 8 }).length, 8);
  assert.equal(cleanLinks(data, { group: '', count: 0 }).length, 10);
  assert.deepEqual(cleanLinks(data, { group: 'b', count: 8 }).map((l) => l.id), ['b1']);
  assert.equal(cleanLinks(data, { group: 'sumiu', count: 8 })[0].id, 'a0', 'grupo apagado → o primeiro');
});
