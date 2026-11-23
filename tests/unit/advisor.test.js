// "Qual é a melhor IA para o meu computador?" (0.8.1, #61): catálogo, contas de memória, perfis de hardware e Ollama.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeCatalog, recommend, budget, placement, needGB, finalHw, fromSys, gpuVendorOf, PURPOSES } from '../../src/lib/ai/advisor.js';
import { pullProgress, readNdjson, speedVerdict, gpuShare, ollamaRoot } from '../../src/lib/ollama.js';
import { addOllamaModel, sanitizeAi } from '../../src/lib/ai/config.js';

const catalog = sanitizeCatalog(JSON.parse(readFileSync(new URL('../../src/data/ollama-models.json', import.meta.url))));

test('catálogo embutido é válido e cobre todas as finalidades', () => {
  assert.ok(catalog.version >= 1 && catalog.models.length >= 15);
  for (const p of Object.keys(PURPOSES)) assert.ok(catalog.models.some((m) => m.uses.includes(p)), p);
  assert.ok(catalog.models.every((m) => m.sizeGB > 0 && m.ptbr >= 1 && m.ptbr <= 3 && m.quality >= 1 && m.quality <= 5));
  assert.ok(catalog.models.filter((m) => m.uses.includes('search')).every((m) => m.embed));
});

test('catálogo inválido é rejeitado; modelos ruins são descartados', () => {
  assert.throws(() => sanitizeCatalog(null));
  assert.throws(() => sanitizeCatalog({ version: 1, models: 'x' }));
  assert.throws(() => sanitizeCatalog({ version: 1, models: [{ id: 'x', sizeGB: 1, params: 1, uses: ['nada'] }] }));
  const c = sanitizeCatalog({ version: 2, updated: '2026-12-01', models: [{ id: 'ok:1b', sizeGB: 1, params: 1, uses: ['chat'], ptbr: 2, quality: 3 }, { id: '', sizeGB: 1 }, { id: 'neg', sizeGB: -1, uses: ['chat'] }, { id: '<script>', sizeGB: 1, uses: ['chat'] }] });
  assert.deepEqual(c.models.map((m) => m.id), ['ok:1b']);
});

test('perfis de hardware', () => {
  const r8 = recommend(catalog, { ramGB: 8, threads: 8, os: 'windows' });
  assert.ok(['bom', 'limitado'].includes(r8.grade));
  assert.ok(r8.purposes.chat.best);
  assert.ok(r8.purposes.chat.best.need <= 8);

  const rtx = recommend(catalog, { ramGB: 32, threads: 16, os: 'windows', gpuVendor: 'nvidia', gpuName: 'NVIDIA GeForce RTX 3060', vramGB: 12, diskFreeGB: 200 });
  assert.equal(rtx.grade, 'otimo');
  assert.equal(rtx.purposes.chat.best.where, 'gpu');

  const mac = recommend(catalog, { ramGB: 16, threads: 8, os: 'mac', arch: 'arm64', ...finalHw({}, { os: 'mac', arch: 'arm64', ramGB: 16 }).hw });
  assert.ok(mac.budget.unified);
  assert.ok(['otimo', 'bom'].includes(mac.grade));

  const r4 = recommend(catalog, { ramGB: 4, threads: 4 });
  assert.equal(r4.grade, 'ruim');
  assert.ok(r4.cloud);
});

test('campos vazios não viram zero (disco desconhecido não bloqueia)', () => {
  const { hw } = finalHw({ ramGB: { value: 8, src: 'estimate' } }, { ramGB: 16 });
  assert.equal(hw.diskFreeGB, null);
  const r = recommend(catalog, hw);
  assert.ok(r.purposes.chat.best, 'com 16 GB e disco desconhecido algum modelo tem de caber');
  const m = catalog.models.find((x) => x.id === 'qwen3.5:4b');
  assert.equal(placement(m, budget({ ramGB: 16 }), { ramGB: 16, diskFreeGB: 3 }).where, 'nodisk');
  assert.notEqual(placement(m, budget({ ramGB: 16 }), { ramGB: 16, diskFreeGB: null }).where, 'nodisk');
});

test('RAM desconhecida supõe 8 GB e avisa; Intel integrada conta como processador', () => {
  assert.ok(budget({}).assumptions.includes('ram'));
  const b = budget({ ramGB: 16, gpuVendor: 'intel', vramGB: 2 });
  assert.equal(b.gpuBudget, 0);
  assert.ok(b.assumptions.includes('igpu'));
});

test('memória necessária: embeddings pequenos, modelos de conversa com folga', () => {
  assert.ok(needGB({ sizeGB: 0.62, embed: true }) < 1.5);
  assert.ok(needGB({ sizeGB: 3.4 }) > 3.4 + 0.5);
});

test('finalHw: vale o que a pessoa escreveu, com aviso de divergência; "não sei" esvazia', () => {
  const det = { ramGB: { value: 8, src: 'estimate' }, vramGB: { value: 6, src: 'ponte' } };
  const r = finalHw(det, { ramGB: 16, vramGB: 'unknown' });
  assert.equal(r.hw.ramGB, 16);
  assert.equal(r.src.ramGB, 'manual');
  assert.equal(r.hw.vramGB, null);
  assert.equal(r.src.vramGB, 'unknown');
  assert.deepEqual(r.divergences.map((d) => d.field), ['ramGB']);
  assert.equal(finalHw({ ramGB: { value: 16, src: 'ponte' } }, { ramGB: 16 }).divergences.length, 0);
});

test('fromSys converte a leitura da Ponte (bytes) e escolhe a maior placa', () => {
  const GB = 1024 ** 3;
  const out = fromSys({ sources: ['ponte'], os: 'windows', mem: { total: 16 * GB }, cpu: { cores: 12, model: 'Ryzen 5' },
    gpus: [{ name: 'Intel UHD', memTotal: 1 * GB }, { name: 'NVIDIA GeForce RTX 4060', memTotal: 8 * GB }], disks: [{ mount: 'D:\\', free: 900 * GB }, { mount: 'C:\\', free: 120 * GB }] });
  assert.equal(out.ramGB.value, 16);
  assert.equal(out.threads.value, 12);
  assert.equal(out.gpuVendor.value, 'nvidia');
  assert.equal(out.vramGB.value, 8);
  assert.equal(out.diskFreeGB.value, 120);
  assert.equal(fromSys({ sources: ['ponte'], os: 'darwin' }).os.value, 'mac');
  assert.equal(gpuVendorOf('AMD Radeon RX 6700 XT'), 'amd');
});

test('Ollama: progresso do pull, NDJSON, veredito de velocidade e GPU', async () => {
  assert.deepEqual(pullProgress({ status: 'pulling abc', total: 200, completed: 50 }), { status: 'pulling abc', pct: 25, error: '' });
  assert.equal(pullProgress({ status: 'success' }).pct, null);
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { c.enqueue(enc.encode('{"status":"a"}\n{"sta')); c.enqueue(enc.encode('tus":"b"}\n{"status":"success"}')); c.close(); } });
  const seen = [];
  await readNdjson(body, (o) => seen.push(o.status));
  assert.deepEqual(seen, ['a', 'b', 'success']);
  assert.equal(speedVerdict(30).icon, '🟢');
  assert.equal(speedVerdict(2).icon, '🔴');
  assert.equal(gpuShare({ name: 'x', size: 100, size_vram: 100 }).gpuPct, 100);
  assert.equal(ollamaRoot('http://localhost:11434/v1/'), 'http://localhost:11434');
});

test('addOllamaModel cria o servidor, usa como Padrão ou por tarefa', () => {
  const empty = sanitizeAi({});
  const a = sanitizeAi(addOllamaModel(empty, 'http://localhost:11434', 'qwen3.5:4b', { caps: { vision: true }, use: 'primary' }));
  const s = a.servers.find((x) => x.type === 'ollama');
  assert.ok(s && s.models.some((m) => m.id === 'qwen3.5:4b'));
  assert.deepEqual(a.primary, { server: s.id, model: 'qwen3.5:4b' });
  const b = sanitizeAi(addOllamaModel(a, 'http://localhost:11434/v1', 'embeddinggemma', { caps: { embed: true }, use: ['search'] }));
  assert.equal(b.servers.filter((x) => x.type === 'ollama').length, 1, 'não duplica o servidor');
  assert.deepEqual(b.tasks.search, { server: s.id, model: 'embeddinggemma' });
  assert.equal(b.primary.model, 'qwen3.5:4b');
});
