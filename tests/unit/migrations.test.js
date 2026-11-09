import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runMigrations, applyMigrations, normalizeItems, CURRENT_SCHEMA, META_KEY, MIGRATION_BACKUP_KEY, MIGRATIONS } from '../../src/lib/migrations.js';

const legacy = () => JSON.parse(readFileSync(new URL('../fixtures/legacy-v0.3-storage.json', import.meta.url), 'utf8'));

function fakeStore(init = {}) {
  const mem = structuredClone(init);
  return {
    mem,
    writes: 0,
    async get(keys) { return Object.fromEntries(keys.filter((k) => k in mem).map((k) => [k, structuredClone(mem[k])])); },
    async set(obj) { this.writes++; Object.assign(mem, structuredClone(obj)); },
  };
}

test('instalação nova: só marca a versão atual', async () => {
  const st = fakeStore();
  const r = await runMigrations(st);
  assert.equal(r.applied.length, 0);
  assert.equal(st.mem[META_KEY].schema, CURRENT_SCHEMA);
});

test('dados da v0.3: migra itens, clima e widgets sem perder nada', async () => {
  const st = fakeStore(legacy());
  const before = legacy();
  const r = await runMigrations(st, 1700000000000);
  assert.deepEqual(r.applied, MIGRATIONS.map((m) => m.to));
  assert.equal(st.mem[META_KEY].schema, CURRENT_SCHEMA);
  // itens: todos com tags/tipo/datas; conteúdo preservado; item inválido descartado
  const brain = st.mem.nt_brain;
  assert.equal(brain.length, before.nt_brain.filter((i) => i && (i.text || i.title || i.url)).length);
  for (const it of brain) {
    assert.ok(Array.isArray(it.tags));
    assert.ok(['note', 'task', 'idea', 'page', 'clip'].includes(it.type));
    assert.ok(it.createdAt > 0);
  }
  assert.ok(brain.some((i) => i.text === 'Comprar café'));
  assert.equal(new Set(brain.map((i) => i.id)).size, brain.length, 'ids únicos');
  // configurações
  const s = st.mem.nt_data.settings;
  assert.equal(s.places[0].name, 'Belo Horizonte');
  assert.equal(s.weather, undefined);
  assert.ok(s.widgets.every((w) => w.w && !w.size));
  // cópia de segurança do estado anterior
  assert.deepEqual(st.mem[MIGRATION_BACKUP_KEY].data.nt_brain, before.nt_brain);
});

test('idempotente: rodar de novo não muda nada', async () => {
  const st = fakeStore(legacy());
  await runMigrations(st);
  const snapshot = JSON.stringify(st.mem.nt_brain) + JSON.stringify(st.mem.nt_data);
  const writes = st.writes;
  const r = await runMigrations(st);
  assert.equal(r.applied.length, 0);
  assert.equal(st.writes, writes, 'nenhuma gravação extra');
  assert.equal(JSON.stringify(st.mem.nt_brain) + JSON.stringify(st.mem.nt_data), snapshot);
  // aplicar o passo duas vezes sobre o resultado também não muda
  const twice = applyMigrations(structuredClone({ nt_brain: st.mem.nt_brain, nt_data: st.mem.nt_data }), 1).state;
  assert.equal(JSON.stringify(twice.nt_brain), JSON.stringify(st.mem.nt_brain));
});

test('falha num passo: nada é gravado além do erro', async () => {
  const st = fakeStore(legacy());
  const original = MIGRATIONS[0].up;
  MIGRATIONS[0].up = () => { throw new Error('quebrou'); };
  try {
    const r = await runMigrations(st);
    assert.equal(r.error, 'quebrou');
    assert.deepEqual(st.mem.nt_brain, legacy().nt_brain, 'dados intactos');
    assert.equal(st.mem[META_KEY].schema, 1);
    assert.match(st.mem[META_KEY].lastError.message, /quebrou/);
  } finally {
    MIGRATIONS[0].up = original;
  }
});

test('dados de uma versão mais nova não são tocados', async () => {
  const st = fakeStore({ ...legacy(), [META_KEY]: { schema: 999 } });
  const r = await runMigrations(st);
  assert.equal(r.skipped, 'newer');
  assert.equal(st.writes, 0);
});

test('normalizeItems: dados corrompidos', () => {
  const out = normalizeItems([null, 42, 'texto', {}, { text: 'ok', tags: 'x', type: 'esquisito', createdAt: 'abc' }, { id: 7, title: 'só título' }, { id: 7, text: 'id repetido' }], 1000);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0].tags, []);
  assert.equal(out[0].type, 'note');
  assert.equal(out[0].createdAt, 1000);
  assert.equal(typeof out[1].id, 'string');
  assert.notEqual(out[1].id, out[2].id);
  assert.deepEqual(normalizeItems('lixo'), []);
});
