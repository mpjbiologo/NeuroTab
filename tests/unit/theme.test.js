// Sistema de design (#51): contraste dos três temas, tokens completos e ícones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { check, themes } from '../../scripts/theme-contrast.mjs';
import { THEMES, DEFAULT_THEME, themeOf } from '../../src/lib/theme.js';
import { leadingIcon } from '../../src/lib/icons.js';
import { ICONS, EMOJI_ICON } from '../../src/lib/icon-data.js';

const css = readFileSync(new URL('../../src/theme.css', import.meta.url), 'utf8');

test('os três temas passam no contraste mínimo (WCAG AA)', () => {
  const bad = check(css).filter((r) => !r.ok);
  assert.deepEqual(bad, [], bad.map((r) => `${r.theme}: ${r.fg} sobre ${r.back} = ${r.ratio}`).join('; '));
});

test('cada tema define todos os tokens do padrão', () => {
  const t = themes(css);
  assert.deepEqual(Object.keys(t).sort(), Object.keys(THEMES).sort());
  const base = Object.keys(t[DEFAULT_THEME]).sort();
  for (const [name, tokens] of Object.entries(t)) assert.deepEqual(Object.keys(tokens).sort(), base, `tema ${name}`);
  assert.equal(themeOf({ theme: 'calorosa' }), 'calorosa');
  assert.equal(themeOf({ theme: 'inexistente' }), DEFAULT_THEME);
});

test('telas usam tokens, não cores soltas', () => {
  // Exceções: prévia de cor do atalho (#555/#666), mapa (fundo/rótulo claros), QR (precisa de branco), escuro de fotos.
  const allow = { 'src/newtab.css': ['#666', '#555', '#222', '#1d1d1d', '#fff', '#dfe3e8', '#333', '#111'], 'src/options.css': ['#fff'], 'src/popup.css': [] };
  for (const [file, ok] of Object.entries(allow)) {
    const s = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const loose = [...new Set(s.match(/#[0-9a-fA-F]{3,6}\b/g) || [])].filter((c) => !ok.includes(c.toLowerCase()));
    assert.deepEqual(loose, [], `${file}: cores fora dos tokens`);
  }
});

test('ícones: emoji do começo vira ícone; texto comum não', () => {
  assert.deepEqual(leadingIcon('⭐ Salvar local'), { name: 'star', rest: 'Salvar local' });
  assert.deepEqual(leadingIcon('🗑'), { name: 'trash-2', rest: '' });
  assert.deepEqual(leadingIcon('☑️ Tarefa'), { name: 'square-check', rest: 'Tarefa' });
  assert.equal(leadingIcon('Salvar'), null);
  assert.equal(leadingIcon('2 ⭐'), null, 'só no começo');
  for (const [emoji, name] of Object.entries(EMOJI_ICON)) assert.ok(ICONS[name], `${emoji} → ${name} existe`);
});

test('o site usa a mesma cópia do tema, das fontes e dos ícones (node scripts/sync-site.mjs)', async () => {
  const { FILES } = await import('../../scripts/sync-site.mjs').catch(() => ({ FILES: ['theme.css', 'lib/icons.js', 'lib/icon-data.js'] }));
  for (const f of FILES) {
    const a = readFileSync(new URL(`../../src/${f}`, import.meta.url));
    const b = readFileSync(new URL(`../../docs/assets/${f.replace('lib/', '')}`, import.meta.url));
    assert.ok(a.equals(b), `docs/assets/${f.replace('lib/', '')} desatualizado: rode node scripts/sync-site.mjs`);
  }
});
