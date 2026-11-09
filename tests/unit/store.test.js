import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, normalizeWidgets, mergeSettings, toBackup, parseBackup, collectSecrets, applySecrets, normalizeUrl, hostOf, defaultData } from '../../src/lib/store.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

test('normalize: dados inválidos viram dados padrão', () => {
  for (const bad of [null, undefined, {}, { groups: [] }, { groups: 'x' }]) {
    const d = normalize(bad);
    assert.ok(d.groups.length >= 1);
    assert.ok(Array.isArray(d.links));
    assert.equal(d.settings.dockPosition, 'left');
  }
});

test('normalizeWidgets: tamanho antigo (s/m/l) vira largura e respeita limites', () => {
  assert.deepEqual(normalizeWidgets([{ id: 'a', size: 's' }, { id: 'b', size: 'l' }, { id: 'c', w: 99 }, { id: 'd', w: 1 }]).map((w) => w.w), [4, 12, 12, 3]);
  assert.equal(normalizeWidgets([{ id: 'a', size: 'm' }])[0].size, undefined);
});

test('mergeSettings: clima antigo (v0.3) vira lista de lugares', () => {
  const s = mergeSettings({ weather: { name: 'Itaúna', lat: -20.07, lon: -44.57 } });
  assert.equal(s.places.length, 1);
  assert.equal(s.places[0].name, 'Itaúna');
  assert.equal(s.ai.provider, 'gemini');
});

test('toBackup: chaves e token NUNCA vão no backup comum', () => {
  const d = defaultData();
  d.settings.ai.keys = { gemini: 'AIzaSECRET123456789012345', openai: 'sk-secret' };
  d.settings.brapiToken = 'tok';
  const b = toBackup(d, null, []);
  const text = JSON.stringify(b);
  assert.ok(!text.includes('AIzaSECRET'));
  assert.ok(!text.includes('sk-secret'));
  assert.ok(!text.includes('"tok"'));
  assert.equal(b.secrets, undefined);
  assert.equal(d.settings.ai.keys.gemini, 'AIzaSECRET123456789012345', 'não altera o original');
  assert.ok(b.schema >= 2);
});

test('collectSecrets/applySecrets: substituir e só preencher vazios', () => {
  const sec = collectSecrets({ ai: { keys: { gemini: 'G', openai: '' } }, brapiToken: 'B' });
  assert.deepEqual(sec, { aiKeys: { gemini: 'G' }, brapiToken: 'B' });
  const s1 = { ai: { keys: { gemini: 'OLD' } }, brapiToken: '' };
  assert.equal(applySecrets(s1, sec, false), 1);
  assert.equal(s1.ai.keys.gemini, 'OLD');
  assert.equal(s1.brapiToken, 'B');
  const s2 = { ai: { keys: { gemini: 'OLD' } } };
  applySecrets(s2, sec, true);
  assert.equal(s2.ai.keys.gemini, 'G');
});

test('parseBackup: NeuroTab, Speed Dial (.spd) e arquivo desconhecido', () => {
  const nt = parseBackup(fixture('demo-backup.json'));
  assert.equal(nt.data.groups.length, 6);
  assert.ok(nt.brain.every((i) => Array.isArray(i.tags)));
  const spd = parseBackup(fixture('sample.spd'));
  assert.equal(spd.data.groups.length, 2);
  assert.equal(spd.data.links.length, 3);
  assert.throws(() => parseBackup({ foo: 1 }), /não reconhecido/);
});

test('parseBackup: backup de versão mais nova é recusado com mensagem clara', () => {
  const b = fixture('demo-backup.json');
  b.schema = 999;
  assert.throws(() => parseBackup(b), /versão mais nova/);
});

test('normalizeUrl e hostOf', () => {
  assert.equal(normalizeUrl('youtube.com'), 'https://youtube.com');
  assert.equal(hostOf('https://www.google.com/x'), 'google.com');
  assert.equal(hostOf('não é url'), 'não é url');
});
