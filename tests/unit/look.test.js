// Editor visual da aparência (#58): validação, tokens gerados, contraste e arquivos de tema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOOK, PALETTES, sanitizeLook, isDefaultLook, lookVars, contrast, readableOn, mix, lookWarnings,
  themeFile, parseThemeFile, sanitizeTheme,
} from '../../src/lib/look.js';
import { THEMES } from '../../src/lib/theme.js';
import { mergeSettings } from '../../src/lib/store.js';

test('valores inválidos nunca chegam à página: voltam ao do tema', () => {
  const L = sanitizeLook({ accent: 'red', bg: '#12345', surface: '#ABCDEF', text: 'url(x)', border: '#fff', opacity: 3, radius: 99, shadow: 'neon', density: 'x', widgetStyle: 'glass;}', extra: 1 });
  assert.deepEqual(L, { ...DEFAULT_LOOK, surface: '#abcdef', opacity: 20, radius: 28 });
  assert.equal('extra' in L, false);
  assert.deepEqual(sanitizeLook(null), DEFAULT_LOOK);
  assert.deepEqual(sanitizeLook('lixo'), DEFAULT_LOOK);
  assert.equal(sanitizeLook({ opacity: '' }).opacity, null);
  assert.equal(sanitizeLook({ radius: '12' }).radius, 12);
  assert.ok(isDefaultLook({}));
  assert.ok(!isDefaultLook({ density: 'compact' }));
});

test('tokens: só o que mudou é sobreposto ao tema', () => {
  assert.deepEqual(lookVars(DEFAULT_LOOK), {});
  const v = lookVars({ accent: '#38bdf8', radius: 10, shadow: 'none', density: 'compact', opacity: 50 });
  assert.equal(v['--accent'], '#38bdf8');
  assert.equal(v['--on-accent'], '#111318', 'texto escuro sobre azul claro');
  assert.equal(v['--radius-md'], '10px');
  assert.equal(v['--radius-sm'], '7px');
  assert.equal(v['--radius-lg'], '14px');
  assert.equal(v['--shadow-card'], 'none');
  assert.equal(v['--dens'], '0.7');
  assert.match(v['--surface'], /var\(--surface-solid\) 50%/);
  assert.equal(v['--bg'], undefined);
  // nada de valor solto que injete CSS
  for (const val of Object.values(lookVars({ ...PALETTES.oceano.look }))) assert.doesNotMatch(val, /[;{}]/);
});

test('contraste WCAG e texto legível sobre uma cor', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.equal(readableOn('#ffd400'), '#111318');
  assert.equal(readableOn('#1e1b4b'), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

test('avisos quando o resultado fica ilegível', () => {
  const ok = { text: '#f5f5f5', surface: '#1f1f1f', bg: '#151515', accent: '#38bdf8', onAccent: '#111318' };
  assert.deepEqual(lookWarnings(ok), []);
  const bad = lookWarnings({ ...ok, text: '#2a2a2a', accent: '#161616', onAccent: '#1a1a1a' });
  assert.equal(bad.length, 4);
  assert.ok(bad[0].includes('texto'));
});

test('as paletas prontas são legíveis', () => {
  for (const [id, p] of Object.entries(PALETTES)) {
    const L = sanitizeLook(p.look);
    assert.ok(THEMES[p.base], `${id}: base existe`);
    assert.deepEqual(lookWarnings({ text: L.text, surface: L.surface, bg: L.bg, accent: L.accent, onAccent: readableOn(L.accent) }), [], id);
  }
});

test('arquivo de tema: exporta, importa e recusa o que não serve', () => {
  const f = themeFile({ name: 'Praia', base: 'calorosa', look: { accent: '#ff8800', opacity: 60 } });
  assert.equal(f.format, 'neurotab-theme');
  const t = parseThemeFile(JSON.stringify(f), THEMES);
  assert.equal(t.name, 'Praia');
  assert.equal(t.base, 'calorosa');
  assert.equal(t.look.accent, '#ff8800');
  assert.equal(t.look.opacity, 60);
  assert.throws(() => parseThemeFile('{oi', THEMES), /JSON inválido/);
  assert.throws(() => parseThemeFile(JSON.stringify({ format: 'outra-coisa' }), THEMES), /não é um tema/);
  assert.throws(() => parseThemeFile(JSON.stringify({ ...f, v: 9 }), THEMES), /mais nova/);
  assert.throws(() => parseThemeFile('x'.repeat(30000), THEMES), /grande demais/);
  // base desconhecida cai no primeiro tema; cor maliciosa some
  const t2 = parseThemeFile(JSON.stringify({ ...f, base: 'hacker', look: { accent: 'red;}body{display:none' } }), THEMES);
  assert.equal(t2.base, 'futurista');
  assert.equal(t2.look.accent, '');
  assert.equal(sanitizeTheme({ name: '   ' }, THEMES), null);
});

test('configurações: aparência, temas salvos e barra ficam válidos ao carregar', () => {
  const s = mergeSettings({ look: { accent: '#ABCDEF', widgetStyle: '??' }, customThemes: [{ id: 'a1', name: 'Meu', base: 'sobria', look: {} }, { name: '' }, 'x'], dockMode: 'sumir' });
  assert.equal(s.look.accent, '#abcdef');
  assert.equal(s.look.widgetStyle, 'glass');
  assert.deepEqual(s.customThemes.map((t) => t.id), ['a1']);
  assert.equal(s.dockMode, 'always');
  assert.equal(mergeSettings({}).dockHideDelay, 0.6);
});
