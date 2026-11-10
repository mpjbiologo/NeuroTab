// Envio automático para a loja do Edge, com a API da Microsoft simulada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishEdge, API } from '../../scripts/publish-edge.mjs';

const BASE = `${API}/products/prod-1/submissions`;
const json = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers });

/** Fetch falso: cada rota devolve, em ordem, as respostas da lista. Guarda as chamadas. */
function fakeApi(routes) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body });
    const key = `${init.method || 'GET'} ${url}`;
    const queue = routes[key];
    assert.ok(queue?.length, `chamada inesperada: ${key}`);
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  return { fetchFn, calls };
}

const opts = (fetchFn) => ({ productId: 'prod-1', clientId: 'client-1', apiKey: 'key-1', zip: Buffer.from('zip'), notes: 'v0.7.0', fetchFn, interval: 1, log: () => {} });

test('Edge: envia o pacote, espera a validação e manda para certificação', async () => {
  const { fetchFn, calls } = fakeApi({
    [`POST ${BASE}/draft/package`]: [json(202, null, { Location: 'op-up' })],
    [`GET ${BASE}/draft/package/operations/op-up`]: [json(200, { status: 'InProgress' }), json(200, { status: 'Succeeded' })],
    [`POST ${BASE}`]: [json(202, null, { Location: `${BASE}/operations/op-pub` })],
    [`GET ${BASE}/operations/op-pub`]: [json(200, { status: 'Succeeded', message: 'ok' })],
  });
  const r = await publishEdge(opts(fetchFn));
  assert.equal(r.status, 'Succeeded');
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'GET', 'POST', 'GET']);
  assert.equal(calls[0].headers.Authorization, 'ApiKey key-1');
  assert.equal(calls[0].headers['X-ClientID'], 'client-1');
  assert.equal(calls[0].headers['Content-Type'], 'application/zip');
  assert.deepEqual(JSON.parse(calls[3].body), { notes: 'v0.7.0' });
});

test('Edge: pacote reprovado na validação não é enviado para certificação', async () => {
  const { fetchFn, calls } = fakeApi({
    [`POST ${BASE}/draft/package`]: [json(202, null, { Location: 'op-up' })],
    [`GET ${BASE}/draft/package/operations/op-up`]: [json(200, { status: 'Failed', errorCode: 'NoModulesUpdated', errors: [{ message: 'same package' }] })],
  });
  await assert.rejects(publishEdge(opts(fetchFn)), /NoModulesUpdated[\s\S]*Suba a versão/);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});

test('Edge: versão anterior ainda em revisão gera mensagem clara', async () => {
  const { fetchFn } = fakeApi({
    [`POST ${BASE}/draft/package`]: [json(202, null, { Location: 'op-up' })],
    [`GET ${BASE}/draft/package/operations/op-up`]: [json(200, { status: 'Succeeded' })],
    [`POST ${BASE}`]: [json(202, null, { Location: 'op-pub' })],
    [`GET ${BASE}/operations/op-pub`]: [json(200, { status: 'Failed', errorCode: 'InProgressSubmission' })],
  });
  await assert.rejects(publishEdge(opts(fetchFn)), /já existe uma versão em revisão/i);
});

test('Edge: chave vencida explica como gerar outra', async () => {
  const { fetchFn } = fakeApi({ [`POST ${BASE}/draft/package`]: [json(401, { message: 'Unauthorized' })] });
  await assert.rejects(publishEdge(opts(fetchFn)), /HTTP 401[\s\S]*EDGE_API_KEY/);
});

test('Edge: falta de credencial é avisada antes de chamar a API', async () => {
  const { fetchFn, calls } = fakeApi({});
  await assert.rejects(publishEdge({ ...opts(fetchFn), apiKey: '' }), /Falta EDGE_API_KEY/);
  assert.equal(calls.length, 0);
});

test('Edge: conferência de credenciais não envia nada', async () => {
  const { checkEdge } = await import('../../scripts/publish-edge.mjs');
  const url = `${BASE}/operations/00000000-0000-0000-0000-000000000000`;
  let api = fakeApi({ [`GET ${url}`]: [json(404, { message: 'not found' })] });
  assert.equal(await checkEdge({ productId: 'prod-1', clientId: 'c', apiKey: 'k', fetchFn: api.fetchFn, log: () => {} }), 404);
  assert.deepEqual(api.calls.map((c) => c.method), ['GET']);
  api = fakeApi({ [`GET ${url}`]: [json(401, { message: 'Unauthorized' })] });
  await assert.rejects(checkEdge({ productId: 'prod-1', clientId: 'c', apiKey: 'k', fetchFn: api.fetchFn, log: () => {} }), /HTTP 401/);
});
