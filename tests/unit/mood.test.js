// "Como foi hoje?" (#58): um registro por dia, histórico, médias e exportação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, setEntry, deleteEntry, series, summary, toCSV, monthGrid, cleanEntry, dayKey, NOTE_MAX } from '../../src/lib/mood.js';
import { CATEGORIES } from '../../src/lib/sync.js';

test('um registro por dia, mesclando humor, energia e frase', () => {
  let s = setEntry(null, '2026-11-20', { mood: 4 }, 10);
  s = setEntry(s, '2026-11-20', { energy: 2, note: '  Dia corrido  ' }, 20);
  assert.deepEqual(s.days['2026-11-20'], { mood: 4, energy: 2, note: 'Dia corrido', at: 20 });
  s = setEntry(s, '2026-11-20', { mood: null, energy: null, note: '' });
  assert.equal(s.days['2026-11-20'], undefined, 'tudo vazio apaga o dia');
  assert.throws(() => setEntry(s, '20/11/2026', { mood: 3 }), /Dia inválido/);
});

test('valores fora da escala e frases longas são limpos', () => {
  assert.deepEqual(cleanEntry({ mood: 9, energy: 0, note: 'x'.repeat(400) }).note.length, NOTE_MAX);
  assert.equal(cleanEntry({ mood: 9, energy: 2.5, note: '' }), null);
  const s = sanitize({ days: { '2026-11-01': { mood: 3 }, 'lixo': { mood: 3 }, '2026-11-02': {} } });
  assert.deepEqual(Object.keys(s.days), ['2026-11-01']);
  assert.deepEqual(deleteEntry(s, '2026-11-01').days, {});
});

test('histórico: série de dias, médias e calendário', () => {
  let s = null;
  s = setEntry(s, '2026-11-19', { mood: 2, energy: 4 });
  s = setEntry(s, '2026-11-21', { mood: 5 });
  const list = series(s, 3, new Date(2026, 10, 21));
  assert.deepEqual(list.map((d) => d.day), ['2026-11-19', '2026-11-20', '2026-11-21']);
  assert.equal(list[1].mood, null);
  assert.deepEqual(summary(list), { days: 2, mood: 3.5, energy: 4 });
  const g = monthGrid(2026, 10); // novembro de 2026 começa num domingo
  assert.equal(g[0], '2026-11-01');
  assert.equal(g.length % 7, 0);
  assert.equal(g.filter(Boolean).length, 30);
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('exportação em planilha, com aspas quando precisa', () => {
  let s = setEntry(null, '2026-11-21', { mood: 4, energy: 3, note: 'Bom, "produtivo"' });
  s = setEntry(s, '2026-11-20', { energy: 1 });
  assert.equal(toCSV(s), 'data,humor,energia,frase\n2026-11-20,,1,\n2026-11-21,4,3,"Bom, ""produtivo"""\n');
});

test('privado: os registros não entram na sincronização', () => {
  assert.equal(CATEGORIES.includes('mood'), false);
});
