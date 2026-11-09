import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptJSON, decryptJSON } from '../../src/lib/crypto.js';
import { redact, maskKey, secretsFromHeaders } from '../../src/lib/secrets.js';

const SECRET = { aiKeys: { gemini: 'AIzaSyD-exemplo-de-chave-123456', openai: 'sk-proj-abcdefghijklmnop' }, brapiToken: 'tok' };

test('criptografia: ida e volta com a senha certa', async () => {
  const box = await encryptJSON(SECRET, 'senha-forte');
  assert.ok(!JSON.stringify(box).includes('AIzaSyD'), 'nada em texto puro');
  assert.deepEqual(await decryptJSON(box, 'senha-forte'), SECRET);
});

test('criptografia: senha errada e dados adulterados falham', async () => {
  const box = await encryptJSON(SECRET, 'senha-forte');
  await assert.rejects(decryptJSON(box, 'errada'), /Senha incorreta/);
  const bytes = Buffer.from(box.data, 'base64');
  bytes[5] ^= 0xff;
  await assert.rejects(decryptJSON({ ...box, data: bytes.toString('base64') }, 'senha-forte'), /Senha incorreta/);
});

test('criptografia: sal e IV novos a cada vez', async () => {
  const a = await encryptJSON(SECRET, 'x');
  const b = await encryptJSON(SECRET, 'x');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
});

test('redact: oculta chaves conhecidas e as informadas', () => {
  const msg = 'Incorrect API key provided: sk-proj-abcdefghijklmnop. Also AIzaSyD-exemplo-de-chave-123456 and Bearer abcdefghijklmnopqrst and ?key=XYZ123456';
  const out = redact(msg);
  assert.ok(!out.includes('sk-proj-abcdefghijklmnop'));
  assert.ok(!out.includes('AIzaSyD'));
  assert.ok(!out.includes('abcdefghijklmnopqrst'));
  assert.ok(!out.includes('XYZ123456'));
  assert.equal(redact('chave minha-chave-custom no texto', ['minha-chave-custom']), 'chave [chave oculta] no texto');
  assert.equal(redact('sem segredo'), 'sem segredo');
});

test('maskKey e secretsFromHeaders', () => {
  assert.equal(maskKey('sk-proj-abcdefghijklmnop'), 'sk-pr…mnop');
  assert.equal(maskKey(''), '');
  assert.deepEqual(secretsFromHeaders({ Authorization: 'Bearer abc123', 'x-goog-api-key': 'AIzaX', 'Content-Type': 'json' }), ['abc123', 'AIzaX']);
});
