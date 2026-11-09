import { test } from 'node:test';
import assert from 'node:assert/strict';
import en from '../../src/i18n/en.js';
import es from '../../src/i18n/es.js';
import { tIn } from '../../src/lib/i18n.js';

const placeholders = (s) => (s.match(/\{\d\}/g) || []).sort().join();

for (const [name, dict] of [['en', en], ['es', es]]) {
  test(`dicionário ${name}: traduções não vazias e marcadores {0} coerentes`, () => {
    for (const [k, v] of Object.entries(dict.exact)) assert.ok(typeof v === 'string' && v.length, `vazio: ${k}`);
    for (const [src, dst] of dict.patterns) assert.equal(placeholders(src), placeholders(dst), `marcadores diferentes: ${src}`);
  });
}

test('tIn traduz para um idioma específico', () => {
  assert.equal(tIn('en', 'Senha incorreta.'), 'Wrong password.');
  assert.equal(tIn('es', 'Para hoje: Algo.'), 'Para hoy: Algo.');
  assert.equal(tIn('pt', 'Anotado.'), 'Anotado.');
});

test('inglês e espanhol cobrem as mesmas frases (diferença pequena)', () => {
  const a = new Set(Object.keys(en.exact));
  const b = new Set(Object.keys(es.exact));
  const onlyEn = [...a].filter((k) => !b.has(k));
  const onlyEs = [...b].filter((k) => !a.has(k));
  assert.ok(onlyEn.length + onlyEs.length < 40, `faltando em es: ${onlyEn.slice(0, 10).join(' | ')} · faltando em en: ${onlyEs.slice(0, 10).join(' | ')}`);
});
