// Atalhos de teclado editáveis e várias páginas de widgets (#75).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboFromEvent, matches, keyOf, normalizeCombo, effectiveHotkeys, sanitizeHotkeys, conflictsFor, hotkeyLabel } from '../../src/lib/hotkeys.js';
import { sanitizePages, sanitizePagesNav, addPage, switchPage, removePage, moveWidgetToPage, movePage, renamePage, startPage, findPage, hasPages, pageIndex, MAX_PAGES } from '../../src/lib/pages.js';
import { mergeSettings } from '../../src/lib/store.js';

const ev = (o) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '', code: '', ...o });

test('atalhos: combinação pela tecla física (Mac e ABNT2)', () => {
  assert.equal(comboFromEvent(ev({ altKey: true, key: 'Ω', code: 'KeyZ' })), 'Alt+Z', 'Alt+Z no Mac');
  assert.equal(comboFromEvent(ev({ ctrlKey: true, shiftKey: true, key: 'K', code: 'KeyK' })), 'Ctrl+Shift+K');
  assert.equal(comboFromEvent(ev({ metaKey: true, key: 'k', code: 'KeyK' })), 'Ctrl+K', 'Cmd conta como Ctrl');
  assert.equal(comboFromEvent(ev({ altKey: true, key: '1', code: 'Digit1' })), 'Alt+1');
  assert.equal(comboFromEvent(ev({ key: 'Alt', code: 'AltLeft', altKey: true })), '', 'só o modificador');
  assert.equal(comboFromEvent(ev({ key: 'F5', code: 'F5' })), 'F5');
  assert.equal(keyOf(ev({ key: '[', code: 'BracketRight' })), '[', 'ABNT2: vale o que está escrito na tecla');
  assert.equal(keyOf(ev({ key: '“', code: 'BracketLeft' })), '[', 'Mac com Alt: cai na posição física');
  assert.ok(matches(ev({ altKey: true, key: 'Ω', code: 'KeyZ' }), 'Alt+Z'));
  assert.ok(!matches(ev({ altKey: true, shiftKey: true, key: 'Z', code: 'KeyZ' }), 'Alt+Z'), 'Shift a mais não casa');
  assert.ok(matches(ev({ key: '/', code: 'IntlRo' }), '/'), '"/" do ABNT2');
  assert.ok(matches(ev({ ctrlKey: true, key: '.', code: 'Period' }), 'Ctrl+.'));
  assert.equal(normalizeCombo('shift+ctrl+k'.replace(/\b\w/g, (c) => c.toUpperCase())), 'Ctrl+Shift+K');
  assert.equal(normalizeCombo('Win+K'), '');
});

test('atalhos: padrão, troca, desligar e conflitos', () => {
  const eff = effectiveHotkeys({});
  assert.equal(eff.clean, 'Alt+Z');
  assert.equal(eff.pageN, 'Alt');
  const custom = sanitizeHotkeys({ clean: 'Alt+Shift+Z', voice: '', pageN: 'Ctrl+Alt', bogus: 'Alt+X', chat: 'Super+C' });
  assert.deepEqual(custom, { clean: 'Alt+Shift+Z', voice: '', pageN: 'Ctrl+Alt' });
  const e2 = effectiveHotkeys(custom);
  assert.deepEqual([e2.clean, e2.voice, e2.pageN, e2.chat], ['Alt+Shift+Z', '', 'Ctrl+Alt', 'Alt+C']);
  assert.equal(hotkeyLabel(custom, 'pageN'), 'Ctrl+Alt+1…9');
  assert.equal(hotkeyLabel(custom, 'voice'), '');
  const kinds = (id, c, cu = {}) => conflictsFor(id, c, cu).map((x) => x.kind);
  assert.deepEqual(kinds('clean', 'Alt+Z'), ['app'], 'NVIDIA');
  assert.deepEqual(kinds('clean', 'Alt+C'), ['action'], 'já é do modo conversa');
  assert.deepEqual(kinds('clean', 'Ctrl+T'), ['browser']);
  assert.deepEqual(kinds('clean', 'Alt+3'), ['action'], 'colide com página 3');
  assert.deepEqual(kinds('clean', 'Q'), ['typing']);
  assert.deepEqual(kinds('clean', 'Alt+Shift+Z'), []);
  assert.deepEqual(mergeSettings({ hotkeys: { clean: 'alt+x' } }).hotkeys, {}, 'formato inválido é ignorado');
  assert.deepEqual(mergeSettings({ hotkeys: { clean: 'Alt+X' } }).hotkeys, { clean: 'Alt+X' });
});

test('páginas: criar, trocar, mover widget, reordenar e apagar', () => {
  const s = mergeSettings({ widgets: [{ id: 'notes', w: 6 }, { id: 'clock', w: 4 }] });
  assert.ok(!hasPages(s));
  assert.equal(switchPage(s, 'next'), false, 'uma página só');
  const p2 = addPage(s, { name: 'Trabalho', icon: '💼' });
  assert.ok(hasPages(s));
  assert.deepEqual(s.pages.map((p) => p.name), ['Início', 'Trabalho']);
  assert.equal(s.page, s.pages[0].id, 'continua na primeira');
  assert.ok(switchPage(s, p2.id));
  assert.deepEqual(s.widgets, [], 'página nova vazia');
  s.widgets.push({ id: 'agenda', w: 6 });
  assert.ok(switchPage(s, 'prev'));
  assert.deepEqual(s.widgets.map((w) => w.id), ['notes', 'clock']);
  assert.deepEqual(s.pages[1].widgets.map((w) => w.id), ['agenda'], 'a página guardou os widgets ao sair');
  s.widgets[0].fx = 10;
  assert.ok(moveWidgetToPage(s, 0, p2.id));
  assert.deepEqual(s.widgets.map((w) => w.id), ['clock']);
  assert.deepEqual(s.pages[1].widgets.map((w) => w.id), ['agenda', 'notes']);
  assert.equal(s.pages[1].widgets[1].fx, undefined, 'posição do modo livre não vai junto');
  renamePage(s, p2.id, { name: 'Estudos', icon: '📚' });
  assert.equal(s.pages[1].name, 'Estudos');
  movePage(s, p2.id, -1);
  assert.equal(s.pages[0].id, p2.id);
  assert.equal(pageIndex(s), 1, 'a aberta continua a mesma');
  // apagar a página aberta, levando os widgets para a primeira
  assert.ok(removePage(s, s.page, { keepWidgets: true }));
  assert.ok(!hasPages(s), 'sobrou uma: volta a ser página única');
  assert.deepEqual(s.widgets.map((w) => w.id), ['agenda', 'notes', 'clock']);
});

test('páginas: limites, conferência, abrir na primeira e voz', () => {
  const s = mergeSettings({});
  for (let i = 0; i < 12; i++) addPage(s, { name: 'P' + i });
  assert.equal(s.pages.length, MAX_PAGES);
  assert.equal(addPage(s), null);
  assert.deepEqual(sanitizePages([{ id: 'a' }], 'a'), { pages: [], page: '' }, 'uma página só = sem páginas');
  const sp = sanitizePages([{ id: 'a', name: '' }, { id: 'a' }, { id: 'b', mode: 'free', widgets: [{ id: 'x' }, null] }], 'zz');
  assert.deepEqual([sp.pages.length, sp.page, sp.pages[0].name, sp.pages[1].widgets.length], [2, 'a', 'Página 1', 1]);
  assert.deepEqual(sanitizePagesNav({ style: 'xx', start: 'first', swipe: false }), { style: 'dots', start: 'first', swipe: false, clockAll: true });
  const t = mergeSettings({});
  addPage(t, { name: 'Trabalho' });
  switchPage(t, 1);
  t.pagesNav.start = 'first';
  assert.ok(startPage(t));
  assert.equal(pageIndex(t), 0);
  assert.equal(findPage(t, 'ir para a página trabalho'), 1);
  assert.equal(findPage(t, 'página 2'), 1);
  assert.equal(findPage(t, 'primeira página'), 0);
  assert.equal(findPage(t, 'página xyz'), -1);
  const m = mergeSettings({ pages: t.pages, page: t.page });
  assert.equal(m.pages.length, 2, 'sobrevive à conferência das configurações');
});
