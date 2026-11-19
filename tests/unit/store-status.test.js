// Situação nas lojas: leitura das respostas de cada loja, mudanças e comentário na issue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeStatus, firefoxStatus, edgeStatus, changes, describe, syncIssue, ISSUE_TITLE } from '../../scripts/store-status.mjs';

const res = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Chrome: publicada e em revisão', async () => {
  const fetchFn = async (u) => (String(u).includes('oauth2') ? res({ access_token: 't' })
    : res({ publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '0.7.4' }] }, submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '0.7.5' }] } }));
  const s = await chromeStatus({ publisherId: 'p', extensionId: 'e', clientId: 'c', clientSecret: 's', refreshToken: 'r', fetchFn });
  assert.deepEqual(s, { published: '0.7.4', review: { version: '0.7.5', state: 'em revisão' } });
});

test('Firefox: última versão em revisão; Edge: versão da página pública', async () => {
  const fetchFn = async (u) => (String(u).includes('/versions/') ? res({ results: [{ version: '0.7.5', file: { status: 'nominated' } }] }) : res({ current_version: { version: '0.7.4' } }));
  assert.deepEqual(await firefoxStatus({ issuer: 'i', secret: 's', fetchFn }), { published: '0.7.4', review: { version: '0.7.5', state: 'em revisão' } });
  const fetchE = async (u) => { assert.match(String(u), /getproductdetailsbycrxid\/mhaainpmhalhhbefceigjmbcdhdeainl/); return res({ version: '0.7.2.3' }); };
  assert.deepEqual(await edgeStatus({ fetchFn: fetchE }), { published: '0.7.2.3', review: null });
});

test('mudanças: publicação, revisão nova e recusa; nada na primeira consulta nem com erro', () => {
  const a = { chrome: { published: '0.7.4', review: { version: '0.7.5', state: 'em revisão' } }, firefox: { published: '0.7.4', review: null }, edge: { published: '0.7.2.3', review: null } };
  const b = { chrome: { published: '0.7.5', review: null }, firefox: { published: '0.7.4', review: { version: '0.7.5', state: 'recusada ou desativada' } }, edge: { error: 'HTTP 500' } };
  assert.deepEqual(changes(a, b), ['✅ **Chrome** publicou a **0.7.5**.', '❌ **Firefox**: 0.7.5 recusada ou desativada.']);
  assert.deepEqual(changes({}, b), []);
  assert.deepEqual(changes(a, a), []);
  assert.match(describe(b, '0.7.5')[2], /não consegui consultar/);
  assert.match(describe(a, '0.7.5')[2], /0\.7\.5: aguardando a loja aceitar o envio/);
});

test('issue: cria na primeira vez, depois só comenta quando muda, mencionando o dono', async () => {
  const calls = [];
  let stored = null;
  const fetchFn = async (u, o = {}) => {
    const m = o.method || 'GET';
    calls.push(`${m} ${String(u).replace('https://api.github.com/repos/o/r', '')}`);
    if (m === 'GET') return res(stored ? [stored] : []);
    const body = JSON.parse(o.body);
    if (m === 'POST' && String(u).endsWith('/issues')) { stored = { number: 7, title: body.title, body: body.body }; return res(stored, 201); }
    if (m === 'PATCH') { stored.body = body.body; return res(stored); }
    return res({ id: 1, body: body.body }, 201);
  };
  const s1 = { chrome: { published: '0.7.4', review: { version: '0.7.5', state: 'em revisão' } }, firefox: { published: '0.7.4', review: null }, edge: { published: '0.7.2.3', review: null } };
  const r1 = await syncIssue({ status: s1, latest: '0.7.5', repo: 'o/r', token: 't', owner: 'dono', fetchFn, log: () => {} });
  assert.equal(stored.title, ISSUE_TITLE);
  assert.deepEqual(r1.changes, []);
  const s2 = { ...s1, chrome: { published: '0.7.5', review: null } };
  const r2 = await syncIssue({ status: s2, latest: '0.7.5', repo: 'o/r', token: 't', owner: 'dono', fetchFn, log: () => {} });
  assert.deepEqual(r2.changes, ['✅ **Chrome** publicou a **0.7.5**.']);
  assert.ok(calls.includes('POST /issues/7/comments'));
  assert.match(stored.body, /\| Chrome \| 0\.7\.5 \| — \|/);
  const n = calls.length;
  await syncIssue({ status: s2, latest: '0.7.5', repo: 'o/r', token: 't', owner: 'dono', fetchFn, log: () => {} });
  assert.ok(!calls.slice(n).some((c) => c.includes('comments')), 'sem mudança, sem comentário');
});
