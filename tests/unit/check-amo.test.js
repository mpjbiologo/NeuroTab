// Conferência das credenciais da loja do Firefox (AMO), com a API simulada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { amoToken, checkAmo, API, GUID } from '../../scripts/check-amo.mjs';

const json = (status, body) => new Response(JSON.stringify(body), { status });

test('AMO: token JWT HS256 com validade de 5 minutos', () => {
  const t = amoToken('user:123:45', 'segredo', 1000);
  const [h, b, s] = t.split('.');
  const claims = JSON.parse(Buffer.from(b, 'base64url'));
  assert.equal(claims.iss, 'user:123:45');
  assert.equal(claims.exp - claims.iat, 300);
  assert.ok(claims.jti);
  assert.equal(s, createHmac('sha256', 'segredo').update(`${h}.${b}`).digest('base64url'));
  assert.notEqual(amoToken('a', 'b').split('.')[1], amoToken('a', 'b').split('.')[1], 'jti muda a cada token');
});

test('AMO: chave aceita mostra o endereço e a versão da NeuroTab', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (url === `${API}/accounts/profile/`) return json(200, { username: 'mpjbiologo' });
    if (url === `${API}/addons/addon/${encodeURIComponent(GUID)}/`) return json(200, { url: 'https://addons.mozilla.org/pt-BR/firefox/addon/neurotab/', status: 'public', current_version: { version: '0.6.1' } });
    throw new Error('inesperado ' + url);
  };
  const lines = [];
  const r = await checkAmo({ issuer: 'i', secret: 's', fetchFn, log: (m) => lines.push(m) });
  assert.equal(r.addon.current_version.version, '0.6.1');
  assert.ok(calls.every((c) => c.auth.startsWith('JWT ')));
  assert.match(lines.join('\n'), /mpjbiologo[\s\S]*addon\/neurotab[\s\S]*0\.6\.1/);
});

test('AMO: chave recusada explica onde gerar outra', async () => {
  const fetchFn = async () => json(401, { detail: 'Incorrect authentication credentials.' });
  await assert.rejects(checkAmo({ issuer: 'i', secret: 's', fetchFn, log: () => {} }), /HTTP 401[\s\S]*api\/key/);
  await assert.rejects(checkAmo({ issuer: '', secret: 's', fetchFn, log: () => {} }), /Falta AMO_JWT_ISSUER/);
});
