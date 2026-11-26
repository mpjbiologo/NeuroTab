// Teste individual de cada modelo de IA (0.9.2.3, #76).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeModel, probeMany, statusFromError, probeSummary, saveProbes, loadProbes, forgetProbes } from '../../src/lib/ai/model-probe.js';
import { AIError } from '../../src/lib/ai/errors.js';

const fake = (fn) => ({ generate: async (c) => fn(c, 'gen'), embed: async (c) => fn(c, 'embed') });

test('cada falha vira um estado diferente', () => {
  assert.equal(statusFromError(new AIError('auth')), 'auth');
  assert.equal(statusFromError(new AIError('missing')), 'missing');
  assert.equal(statusFromError(new AIError('server')), 'missing');
  assert.equal(statusFromError(new AIError('limit')), 'limit');
  assert.equal(statusFromError(new AIError('offline')), 'offline');
  assert.equal(statusFromError(new AIError('unsupported')), 'unsupported');
  assert.equal(statusFromError(new AIError('invalid')), 'ok', 'respondeu: o acesso existe');
  assert.equal(statusFromError(new AIError('failed')), 'inconclusive', 'não inventa sucesso nem falha');
  assert.equal(statusFromError({ timeout: true }), 'offline');
});

test('chamada mínima: gerar texto curto ou embeddings, com tempo-limite', async () => {
  const calls = [];
  const ad = fake((c, how) => { calls.push([c.model, how]); if (c.model === 'nao-existe') throw new AIError('missing', 'Erro 404: not found', { status: 404 }); return 'OK'; });
  const c = { type: 'gemini', base: 'x', key: 'SEGREDO' };
  assert.equal((await probeModel(c, 'gemini-flash', { adapter: ad })).status, 'ok');
  assert.equal((await probeModel(c, 'text-embedding-004', { adapter: ad, caps: { embed: true, text: false } })).status, 'ok');
  const bad = await probeModel(c, 'nao-existe', { adapter: ad });
  assert.equal(bad.status, 'missing');
  assert.match(bad.detail, /HTTP 404/);
  assert.ok(!JSON.stringify(bad).includes('SEGREDO'), 'a chave não vai para o resultado');
  assert.deepEqual(calls.map((x) => x[1]), ['gen', 'embed', 'gen']);
  const slow = { generate: () => new Promise(() => {}) };
  const r = await probeModel(c, 'lento', { adapter: slow, timeoutMs: 30 });
  assert.equal(r.status, 'offline');
  assert.match(r.detail, /Tempo esgotado/);
  assert.equal((await probeModel({ ...c, type: 'anthropic' }, 'x', { adapter: ad, caps: { embed: true, text: false } })).status, 'unsupported');
});

test('vários ao mesmo tempo, com limite, e para no "limite excedido"', async () => {
  let now = 0; let max = 0;
  const run = async (m) => { now++; max = Math.max(max, now); await new Promise((r) => setTimeout(r, 5)); now--; return { status: m === 'm3' ? 'limit' : 'ok', at: 1 }; };
  const seen = [];
  const out = await probeMany(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'], run, { concurrency: 2, onResult: (m) => seen.push(m) });
  assert.equal(max, 2, 'no máximo 2 de cada vez');
  assert.equal(out.m3.status, 'limit');
  const untested = Object.values(out).filter((r) => r.status === 'untested');
  assert.ok(untested.length >= 2 && untested.every((r) => /limite/.test(r.detail)), JSON.stringify(out));
  assert.equal(seen.length, 7, 'todos aparecem no resultado');
  let stop = false;
  const out2 = await probeMany(['a', 'b', 'c', 'd'], async (m) => { if (m === 'a') stop = true; return { status: 'ok' }; }, { concurrency: 1, isCancelled: () => stop });
  assert.equal(out2.b.status, 'untested');
  assert.match(out2.b.detail, /cancelado/);
});

test('resumo e resultados guardados sem "não testados"', async () => {
  const res = { a: { status: 'ok', at: 5 }, b: { status: 'auth', at: 9 }, c: { status: 'untested' } };
  assert.deepEqual(probeSummary(res, ['a', 'b', 'c', 'd']), { ok: 1, bad: 1, untested: 2, last: 9 });
  await saveProbes('gemini', res);
  assert.deepEqual(Object.keys(await loadProbes('gemini')), ['a', 'b']);
  await forgetProbes('gemini');
  assert.deepEqual(await loadProbes('gemini'), {});
});
