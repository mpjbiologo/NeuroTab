// Envio automático para a Chrome Web Store, com a API do Google simulada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { publishChrome, serviceAccountAssertion, API, TOKEN_URL } from '../../scripts/publish-chrome.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { type: 'service_account', client_email: 'ci@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: TOKEN_URL };
const NAME = 'publishers/pub-1/items/ext-1';
const json = (status, body) => new Response(JSON.stringify(body), { status });

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
const token = () => ({ [`POST ${TOKEN_URL}`]: [json(200, { access_token: 'tok', expires_in: 3600 })] });
const opts = (fetchFn, extra = {}) => ({ publisherId: 'pub-1', extensionId: 'ext-1', serviceAccount: JSON.stringify(SA), zip: Buffer.from('zip'), fetchFn, interval: 1, log: () => {}, ...extra });

test('Chrome: JWT da conta de serviço é assinado e tem o escopo da loja', () => {
  const jwt = serviceAccountAssertion(SA, 1000);
  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.iss, SA.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/chromewebstore');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('Chrome: obtém o token, envia o pacote, espera o processamento e manda para revisão', async () => {
  const { fetchFn, calls } = fakeApi({
    ...token(),
    [`POST ${API}/upload/v2/${NAME}:upload`]: [json(200, { uploadState: 'IN_PROGRESS' })],
    [`GET ${API}/v2/${NAME}:fetchStatus`]: [json(200, { lastAsyncUploadState: 'IN_PROGRESS' }), json(200, { lastAsyncUploadState: 'SUCCEEDED' })],
    [`POST ${API}/v2/${NAME}:publish`]: [json(200, { state: 'PENDING_REVIEW' })],
  });
  const r = await publishChrome(opts(fetchFn));
  assert.equal(r.state, 'PENDING_REVIEW');
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(calls[1].headers.Authorization, 'Bearer tok');
  assert.equal(calls[1].headers['Content-Type'], 'application/zip');
  assert.deepEqual(JSON.parse(calls.at(-1).body), { publishType: 'DEFAULT_PUBLISH' });
});

test('Chrome: também aceita OAuth com refresh token', async () => {
  const { fetchFn, calls } = fakeApi({
    ...token(),
    [`POST ${API}/upload/v2/${NAME}:upload`]: [json(200, { uploadState: 'SUCCEEDED', crxVersion: '0.7.0' })],
    [`POST ${API}/v2/${NAME}:publish`]: [json(200, { state: 'PENDING_REVIEW' })],
  });
  await publishChrome(opts(fetchFn, { serviceAccount: undefined, clientId: 'c', clientSecret: 's', refreshToken: 'r' }));
  assert.equal(new URLSearchParams(calls[0].body).get('grant_type'), 'refresh_token');
});

test('Chrome: pacote recusado não é mandado para revisão', async () => {
  const { fetchFn, calls } = fakeApi({ ...token(), [`POST ${API}/upload/v2/${NAME}:upload`]: [json(200, { uploadState: 'FAILED' })] });
  await assert.rejects(publishChrome(opts(fetchFn)), /estado FAILED/);
  assert.ok(!calls.some((c) => c.url.endsWith(':publish')));
});

test('Chrome: versão repetida e conta sem acesso geram mensagens claras', async () => {
  let api = fakeApi({ ...token(), [`POST ${API}/upload/v2/${NAME}:upload`]: [json(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The new version must be greater than the published version 0.6.1.' } })] });
  await assert.rejects(publishChrome(opts(api.fetchFn)), /Suba a versão/);
  api = fakeApi({ ...token(), [`POST ${API}/upload/v2/${NAME}:upload`]: [json(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } })] });
  await assert.rejects(publishChrome(opts(api.fetchFn)), /Service accounts/);
});

test('Chrome: JSON da chave inválido ou ausente é avisado antes de chamar a API', async () => {
  const { fetchFn, calls } = fakeApi({});
  await assert.rejects(publishChrome(opts(fetchFn, { serviceAccount: '{oops' })), /não é um JSON válido/);
  await assert.rejects(publishChrome(opts(fetchFn, { serviceAccount: undefined })), /Falta a credencial/);
  await assert.rejects(publishChrome(opts(fetchFn, { extensionId: '' })), /Falta CWS_EXTENSION_ID/);
  assert.equal(calls.length, 0);
});
