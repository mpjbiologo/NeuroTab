// Central de IA (0.8.0, #63 e #7): migração, roteamento por tarefa, Reserva com permissão, adaptadores e erros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAi, migrateAi, exportAi, importAi, newServerId, modelCaps, removeServer } from '../../src/lib/ai/config.js';
import { resolve, crossesToCloud, pickLabel } from '../../src/lib/ai/router.js';
import { whereOf, guessCaps } from '../../src/lib/ai/catalog.js';
import { TASKS, registerTask } from '../../src/lib/ai/tasks.js';
import { AIError, codeFromStatus } from '../../src/lib/ai/errors.js';
import { complete, isConfigured, isLocalAI, aiConfig, listServerModels } from '../../src/lib/ai.js';
import { embedConfig } from '../../src/lib/semantic.js';

const srv = (id, type, extra = {}) => ({ id, type, base: extra.base, models: extra.models || [], on: extra.on, embedModel: extra.embedModel, visionModel: extra.visionModel });
const central = (over = {}) => sanitizeAi({
  servers: [
    srv('ollama', 'ollama', { base: 'http://localhost:11434/v1', models: ['llama3.2', 'gemma3:4b', 'nomic-embed-text'] }),
    srv('gemini', 'gemini', { models: ['gemini-flash-latest'] }),
    srv('ollama-2', 'ollama', { base: 'http://192.168.0.10:11434/v1', models: ['qwen2.5:7b'] }),
    srv('anthropic', 'anthropic', { models: ['claude-haiku-5-5'] }),
  ],
  primary: { server: 'ollama', model: 'llama3.2' },
  keys: { gemini: 'G', anthropic: 'A' },
  ...over,
});

test('migração: a configuração antiga vira servidores, Padrão e regras, sem perder chaves', () => {
  const ai = sanitizeAi({
    provider: 'ollama', models: { ollama: 'llama3.2', gemini: 'gemini-2.5-flash' }, baseUrls: { ollama: 'http://localhost:11434/v1' },
    keys: { gemini: 'G', openai: 'O' }, embedModels: { gemini: 'text-embedding-004' }, visionModel: 'gemma3', autoEnrich: false, imagesAllowed: true,
  }, { provider: 'gemini' });
  assert.deepEqual(ai.servers.map((s) => s.id).sort(), ['gemini', 'ollama', 'openai']);
  assert.deepEqual(ai.primary, { server: 'ollama', model: 'llama3.2' });
  assert.deepEqual(ai.tasks.images, { server: 'gemini', model: 'gemma3' }, 'IA para imagens da aba Mídia vira regra da tarefa');
  assert.equal(ai.servers.find((s) => s.id === 'gemini').embedModel, 'text-embedding-004');
  assert.deepEqual(ai.keys, { gemini: 'G', openai: 'O' });
  assert.equal(ai.autoEnrich, false);
  assert.equal(ai.imagesAllowed, true);
  // sem IA de imagens própria: o modelo de imagens fica no servidor do Padrão
  const b = migrateAi({ provider: 'ollama', models: { ollama: 'llama3.2' }, visionModel: 'llava' });
  assert.equal(b.servers[0].visionModel, 'llava');
  // instalação nova: nada configurado
  const c = sanitizeAi(undefined);
  assert.deepEqual(c.servers, []);
  assert.equal(c.primary.server, '');
  // idempotente
  assert.deepEqual(sanitizeAi(ai), ai);
});

test('espelho antigo: versão antiga (ou backup antigo) troca o provedor → vira o Padrão; sem servidores não ressuscita', () => {
  const ai = central();
  assert.equal(ai.provider, 'ollama');
  const fromOld = sanitizeAi({ ...ai, provider: 'gemini', models: { ...ai.models, gemini: 'gemini-2.5-pro' } });
  assert.deepEqual(fromOld.primary, { server: 'gemini', model: 'gemini-2.5-pro' });
  assert.equal(fromOld.servers.length, ai.servers.length);
  let empty = ai;
  for (const s of ai.servers) empty = sanitizeAi(removeServer(empty, s.id));
  assert.equal(empty.servers.length, 0);
  assert.deepEqual(empty.keys, {});
  assert.equal(empty.primary.server, '');
  assert.deepEqual(sanitizeAi(empty).servers, []);
});

test('onde os dados vão: computador, rede de casa ou internet', () => {
  assert.equal(whereOf('ollama', 'http://localhost:11434/v1'), 'local');
  assert.equal(whereOf('custom', 'http://127.0.0.1:1234/v1'), 'local');
  assert.equal(whereOf('ollama', 'http://192.168.0.10:11434/v1'), 'lan');
  assert.equal(whereOf('custom', 'http://nas.local:8080/v1'), 'lan');
  assert.equal(whereOf('custom', 'https://api.groq.com/openai/v1'), 'cloud');
  assert.equal(whereOf('gemini', ''), 'cloud');
  assert.equal(guessCaps('ollama', 'nomic-embed-text').embed, true);
  assert.equal(guessCaps('ollama', 'gemma3:4b').vision, true);
  assert.equal(guessCaps('ollama', 'llama3.2').vision, null);
});

test('ordem: troca desta vez → regra da tarefa → Padrão; herança e problemas explicados', () => {
  const ai = central({ tasks: { media: { server: 'gemini', model: 'gemini-flash-latest' }, chat: { server: 'ollama-2', model: 'qwen2.5:7b' } } });
  assert.equal(resolve(ai, 'organize').use.server, 'ollama', 'sem regra: herda o Padrão');
  assert.equal(resolve(ai, 'organize').use.source, 'primary');
  assert.equal(resolve(ai, 'media').use.server, 'gemini');
  assert.equal(resolve(ai, 'media').use.source, 'task');
  const o = resolve(ai, 'media', { override: { server: 'anthropic', model: 'claude-haiku-5-5' } }).use;
  assert.equal(o.server, 'anthropic');
  assert.equal(o.source, 'override');
  assert.equal(resolve(ai, 'chat').use.where, 'lan');
  // servidor da regra desligado → cai no Padrão, com o motivo
  const off = sanitizeAi({ ...ai, servers: ai.servers.map((s) => (s.id === 'gemini' ? { ...s, on: false } : s)) });
  const r = resolve(off, 'media');
  assert.equal(r.use.server, 'ollama');
  assert.equal(r.problems[0].why, 'off');
  // sem chave
  const nokey = sanitizeAi({ ...ai, keys: {} });
  assert.equal(resolve(nokey, 'media').problems[0].why, 'nokey');
  assert.equal(pickLabel(resolve(ai, 'organize').use), 'Ollama · llama3.2');
});

test('capacidades: imagens e embeddings', () => {
  const ai = central();
  // Ollama com modelo de texto: procura sozinho um modelo com visão (autoVision)
  const img = resolve(ai, 'images').use;
  assert.equal(img.server, 'ollama');
  assert.equal(img.autoVision, true);
  // regra explícita com modelo marcado como "não lê imagens": pulada
  const ai2 = sanitizeAi({ ...ai, servers: ai.servers.map((s) => (s.id === 'ollama-2' ? { ...s, models: [{ id: 'qwen2.5:7b', caps: { vision: false } }] } : s)), tasks: { images: { server: 'ollama-2', model: 'qwen2.5:7b' } } });
  const r = resolve(ai2, 'images');
  assert.equal(r.problems[0].why, 'novision');
  assert.equal(r.use.server, 'ollama');
  assert.equal(modelCaps(ai2.servers.find((s) => s.id === 'ollama-2'), 'qwen2.5:7b').vision, false);
  // busca por significado herda o modelo de embeddings do servidor do Padrão
  assert.equal(resolve(ai, 'search').use.model, 'nomic-embed-text');
  // Anthropic não tem embeddings
  const an = sanitizeAi({ ...ai, primary: { server: 'anthropic', model: 'claude-haiku-5-5' } });
  assert.equal(resolve(an, 'search').use, null);
  assert.equal(resolve(an, 'search').problems[0].why, 'noembed');
  // modelo de embeddings não serve para conversa
  const emb = sanitizeAi({ ...ai, tasks: { chat: { server: 'ollama', model: 'nomic-embed-text' } } });
  assert.equal(resolve(emb, 'chat').problems[0].why, 'notext');
});

test('Reserva: válida para a tarefa, nunca igual ao escolhido, nunca na busca', () => {
  const ai = central({ reserve: { server: 'gemini', model: 'gemini-flash-latest' } });
  const r = resolve(ai, 'chat');
  assert.equal(r.reserve.server, 'gemini');
  assert.ok(crossesToCloud(r.use, r.reserve));
  assert.equal(resolve(ai, 'search').reserve, null, 'vetores de modelos diferentes não se misturam');
  const same = central({ primary: { server: 'gemini', model: 'gemini-flash-latest' }, reserve: { server: 'gemini', model: 'gemini-flash-latest' } });
  assert.equal(resolve(same, 'chat').reserve, null);
  assert.ok(!crossesToCloud({ where: 'cloud' }, { where: 'cloud' }));
  assert.ok(!crossesToCloud({ where: 'local' }, { where: 'lan' }));
});

// ---------- chamadas (fetch simulado) ----------
function fakeFetch(handler) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, o = {}) => {
    const url = String(u);
    calls.push({ url, body: o.body ? JSON.parse(o.body) : null, headers: o.headers || {} });
    const r = await handler(url, o);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status || 200 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
const ok = (text) => ({ json: { choices: [{ message: { content: text } }] } });
const gem = (text) => ({ json: { candidates: [{ content: { parts: [{ text }] } }] } });

test('complete: usa o servidor da tarefa e avisa qual foi', async () => {
  const f = fakeFetch((u) => (u.includes('generateContent') ? gem('do gemini') : ok('do ollama')));
  try {
    const settings = { ai: central({ tasks: { media: { server: 'gemini', model: 'gemini-flash-latest' } } }) };
    let used = null;
    assert.equal(await complete(settings, { task: 'media', messages: [{ role: 'user', content: 'oi' }], onUse: (p) => { used = p; } }), 'do gemini');
    assert.equal(used.server, 'gemini');
    assert.equal(await complete(settings, { task: 'organize', messages: [{ role: 'user', content: 'oi' }] }), 'do ollama');
    assert.equal(f.calls[1].url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(f.calls[1].body.model, 'llama3.2');
    assert.ok(isConfigured(settings, 'media'));
    assert.ok(isLocalAI(settings, 'organize'));
    assert.ok(!isLocalAI(settings, 'media'));
    assert.equal(aiConfig(settings, 'media').name, 'Gemini');
  } finally { f.restore(); }
});

test('complete: Reserva só com falha de conexão/limite; local → internet pede permissão', async () => {
  const f = fakeFetch((u) => (u.includes('localhost') ? new TypeError('Failed to fetch') : u.includes('generateContent') ? gem('da reserva') : ok('?')));
  try {
    const settings = { ai: central({ reserve: { server: 'gemini', model: 'gemini-flash-latest' } }) };
    const msg = { messages: [{ role: 'user', content: 'oi' }] };
    await assert.rejects(complete(settings, msg), (e) => e.code === 'consent' && e.to.server === 'gemini' && /internet/.test(e.message));
    assert.equal(f.calls.filter((c) => c.url.includes('generateContent')).length, 0, 'nada foi para a internet sem permissão');
    let used;
    assert.equal(await complete(settings, { ...msg, allowCloudReserve: true, onUse: (p) => { used = p; } }), 'da reserva');
    assert.equal(used.server, 'gemini');
    // Reserva também local (rede de casa): sem perguntar
    const lan = { ai: central({ reserve: { server: 'ollama-2', model: 'qwen2.5:7b' } }) };
    f.restore();
    const g = fakeFetch((u) => (u.includes('localhost') ? { status: 503, json: { error: 'busy' } } : ok('da rede')));
    try { assert.equal(await complete(lan, msg), 'da rede'); } finally { g.restore(); }
  } finally { f.restore(); }
  // chave recusada não troca de servidor
  const h = fakeFetch(() => ({ status: 401, json: { error: { message: 'invalid key G' } } }));
  try {
    const settings = { ai: central({ primary: { server: 'gemini', model: 'gemini-flash-latest' }, reserve: { server: 'anthropic', model: 'claude-haiku-5-5' } }) };
    await assert.rejects(complete(settings, { messages: [{ role: 'user', content: 'oi' }] }), (e) => e.code === 'auth' && /Chave de API recusada/.test(e.message));
    assert.equal(h.calls.length, 1);
  } finally { h.restore(); }
});

test('complete: sem IA, erro de configuração com o motivo', async () => {
  await assert.rejects(complete({ ai: sanitizeAi(undefined) }, { messages: [{ role: 'user', content: 'oi' }] }), (e) => e instanceof AIError && e.code === 'config');
  const off = { ai: central({ servers: [srv('ollama', 'ollama', { base: 'http://localhost:11434/v1', on: false })], keys: {} }) };
  await assert.rejects(complete(off, { messages: [{ role: 'user', content: 'oi' }] }), (e) => e.code === 'config' && /desligado/.test(e.message));
});

test('erros padronizados pelo status', () => {
  assert.equal(codeFromStatus(401), 'auth');
  assert.equal(codeFromStatus(429), 'limit');
  assert.equal(codeFromStatus(404), 'missing');
  assert.equal(codeFromStatus(400, 'model "x" not found, try pulling it first'), 'missing');
  assert.equal(codeFromStatus(502), 'server');
  assert.equal(codeFromStatus(400, 'this model does not support image input'), 'unsupported');
  assert.equal(codeFromStatus(400, 'bad'), 'failed');
});

test('listar modelos: capacidades informadas pelo servidor', async () => {
  const f = fakeFetch((u, o) => {
    if (u.includes('openrouter')) return { json: { data: [{ id: 'a/vision', architecture: { input_modalities: ['text', 'image'] } }, { id: 'b/text', architecture: { input_modalities: ['text'] } }] } };
    if (u.endsWith('/v1/models')) return { json: { data: [{ id: 'gemma3:4b' }, { id: 'llama3.2' }, { id: 'nomic-embed-text' }] } };
    if (u.endsWith('/api/show')) {
      const m = JSON.parse(o.body).model;
      return { json: { capabilities: m === 'gemma3:4b' ? ['completion', 'vision'] : m === 'nomic-embed-text' ? ['embedding'] : ['completion', 'tools'] } };
    }
    if (u.includes('openrouter')) return { json: { data: [{ id: 'a/vision', architecture: { input_modalities: ['text', 'image'] } }, { id: 'b/text', architecture: { input_modalities: ['text'] } }] } };
    if (u.includes('v1beta/models')) return { json: { models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] }] } };
    return { status: 404 };
  });
  try {
    const ol = await listServerModels({ type: 'ollama', base: 'http://localhost:11434/v1' });
    assert.deepEqual(ol.map((m) => [m.id, m.caps.vision, m.caps.embed]), [['gemma3:4b', true, false], ['llama3.2', false, false], ['nomic-embed-text', false, true]]);
    const or = await listServerModels({ type: 'openrouter', base: 'https://openrouter.ai/api/v1' }, 'K');
    assert.deepEqual(or.map((m) => [m.id, m.caps.vision]), [['a/vision', true], ['b/text', false]]);
    const gm = await listServerModels({ type: 'gemini', base: 'https://generativelanguage.googleapis.com' }, 'K');
    assert.deepEqual(gm.map((m) => [m.id, m.caps.embed]), [['gemini-flash-latest', false], ['gemini-embedding-001', true]]);
  } finally { f.restore(); }
});

test('busca por significado: servidor e modelo da tarefa; etiqueta do índice compatível com a antiga', () => {
  const s = { ai: central() };
  const c = embedConfig(s);
  assert.equal(c.supported, true);
  assert.equal(c.embedModel, 'nomic-embed-text');
  assert.equal(c.tag, 'ollama:nomic-embed-text', 'igual à etiqueta da 0.7 (provedor:modelo): o índice não precisa ser refeito');
  const r = embedConfig({ ai: central({ tasks: { search: { server: 'gemini', model: 'gemini-embedding-001' } } }) });
  assert.equal(r.tag, 'gemini:gemini-embedding-001');
  assert.equal(embedConfig({ ai: central({ primary: { server: 'anthropic', model: 'claude-haiku-5-5' } }) }).supported, false);
});

test('exportar sem chaves e importar mantendo as chaves deste navegador', () => {
  const ai = central({ tasks: { media: { server: 'gemini', model: 'gemini-flash-latest' } } });
  const out = exportAi(ai);
  assert.equal(JSON.stringify(out).includes('"G"'), false, 'sem chaves');
  assert.equal(out.keys, undefined);
  const other = sanitizeAi({ servers: [srv('gemini', 'gemini')], keys: { gemini: 'LOCAL' } });
  const merged = importAi(other, JSON.parse(JSON.stringify(out)));
  assert.equal(merged.servers.length, 4);
  assert.equal(merged.keys.gemini, 'LOCAL');
  assert.deepEqual(merged.tasks.media, { server: 'gemini', model: 'gemini-flash-latest' });
  assert.throws(() => importAi(other, { foo: 1 }), /não é uma configuração/);
  assert.equal(newServerId(ai, 'ollama'), 'ollama-3');
  assert.equal(newServerId(ai, 'openai'), 'openai');
});

test('tarefas novas se registram sem mexer na central', () => {
  assert.ok(registerTask('meeting', { icon: '📋', label: 'Reuniões', where: 'Modo reunião' }));
  assert.ok(!registerTask('chat', {}), 'não sobrescreve');
  assert.equal(TASKS.meeting.needs, 'text');
  assert.equal(resolve(central(), 'meeting').use.server, 'ollama');
  delete TASKS.meeting;
});
