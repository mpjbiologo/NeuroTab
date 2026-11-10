#!/usr/bin/env node
// Envia um pacote novo para a Chrome Web Store e manda para revisão (API v2).
//
// Autenticação (uma das duas):
//   • Conta de serviço (recomendado, não vence): CWS_SERVICE_ACCOUNT = conteúdo do arquivo JSON da chave
//   • OAuth: CWS_CLIENT_ID + CWS_CLIENT_SECRET + CWS_REFRESH_TOKEN
// Sempre: CWS_PUBLISHER_ID e CWS_EXTENSION_ID.
//
// Uso:  node scripts/publish-chrome.mjs dist/neurotab.zip
//
// Passos: 1) obtém o token  2) sobe o zip  3) espera o processamento  4) manda para revisão.
// Depois disso o Google revisa e, aprovada, a loja atualiza todo mundo sozinha.
import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const API = 'https://chromewebstore.googleapis.com';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (x) => Buffer.from(x).toString('base64url');

const HINTS = {
  401: 'Credencial inválida. Confira o segredo CWS_SERVICE_ACCOUNT (o JSON inteiro da chave) ou gere uma chave nova.',
  403: 'Sem permissão. Adicione o e-mail da conta de serviço no Developer Dashboard (Account → Service accounts) e confira se a Chrome Web Store API está ativada no projeto do Google Cloud.',
  404: 'Item não encontrado. Confira CWS_PUBLISHER_ID e CWS_EXTENSION_ID.',
};

async function readBody(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return { message: text.slice(0, 500) }; }
}

function explain(where, status, body) {
  const e = body?.error || body || {};
  const msg = e.error_description || e.message || (typeof e === 'string' ? e : '');
  let hint = HINTS[status] || '';
  if (/version/i.test(msg) && /(greater|higher|larger|increase)/i.test(msg)) hint = 'A versão do manifest.json precisa ser maior que a publicada. Suba a versão.';
  if (/pending|in review|under review/i.test(msg)) hint = 'Já existe uma versão em revisão na Chrome Web Store. Espere a revisão terminar (ou cancele o envio no Developer Dashboard) e rode de novo.';
  return `${where}: HTTP ${status}${e.status ? ` (${e.status})` : ''}${msg ? ` — ${msg}` : ''}${hint ? `\n→ ${hint}` : ''}`;
}

/** JWT assinado com a chave da conta de serviço (RS256), trocado por um token de acesso. */
export function serviceAccountAssertion(sa, now = Math.floor(Date.now() / 1000)) {
  if (!sa?.client_email || !sa?.private_key) throw new Error('CWS_SERVICE_ACCOUNT não parece o JSON de uma chave de conta de serviço (faltam client_email/private_key).');
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key).toString('base64url');
  return `${head}.${claims}.${sig}`;
}

export async function getAccessToken({ serviceAccount, clientId, clientSecret, refreshToken, fetchFn = fetch }) {
  let form;
  if (serviceAccount) {
    let sa = serviceAccount;
    if (typeof sa === 'string') {
      try { sa = JSON.parse(sa); } catch { throw new Error('CWS_SERVICE_ACCOUNT não é um JSON válido. Cole o conteúdo inteiro do arquivo .json da chave.'); }
    }
    form = { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountAssertion(sa) };
  } else if (clientId && clientSecret && refreshToken) {
    form = { grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken };
  } else {
    throw new Error('Falta a credencial: defina CWS_SERVICE_ACCOUNT (ou CWS_CLIENT_ID, CWS_CLIENT_SECRET e CWS_REFRESH_TOKEN).');
  }
  const res = await fetchFn(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  const body = await readBody(res);
  if (!res.ok || !body?.access_token) {
    const tip = body?.error === 'invalid_grant' && !serviceAccount ? '\n→ O refresh token venceu ou foi revogado (em modo de teste ele dura 7 dias). Prefira a conta de serviço.' : '';
    throw new Error(explain('Obtenção do token', res.status, body) + tip);
  }
  return body.access_token;
}

export async function publishChrome({ publisherId, extensionId, zip, fetchFn = fetch, interval = 5000, timeout = 10 * 60_000, log = console.log, ...auth }) {
  for (const [k, v] of Object.entries({ CWS_PUBLISHER_ID: publisherId, CWS_EXTENSION_ID: extensionId })) if (!v) throw new Error(`Falta ${k}.`);
  const name = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`;

  log('1/4 Obtendo o token de acesso…');
  const token = await getAccessToken({ ...auth, fetchFn });
  const headers = { Authorization: `Bearer ${token}` };

  log('2/4 Enviando o pacote…');
  let res = await fetchFn(`${API}/upload/v2/${name}:upload`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: zip });
  let body = await readBody(res);
  if (!res.ok) throw new Error(explain('Envio do pacote', res.status, body));

  log('3/4 Esperando o processamento do pacote…');
  let state = body?.uploadState;
  const end = Date.now() + timeout;
  while (/IN_PROGRESS/.test(state || '')) {
    if (Date.now() > end) throw new Error(`Processamento do pacote: ainda em andamento depois de ${Math.round(timeout / 1000)} s. Confira no Developer Dashboard.`);
    await sleep(interval);
    res = await fetchFn(`${API}/v2/${name}:fetchStatus`, { headers });
    const st = await readBody(res);
    if (!res.ok) throw new Error(explain('Processamento do pacote', res.status, st));
    state = st?.lastAsyncUploadState;
    log(`  … ${state || 'aguardando'}`);
  }
  if (state !== 'SUCCEEDED') throw new Error(`Processamento do pacote: estado ${state || 'desconhecido'}. Veja os detalhes no Developer Dashboard (o pacote pode ter sido recusado, por exemplo por versão repetida).`);
  if (body?.crxVersion) log(`  versão enviada: ${body.crxVersion}`);

  log('4/4 Mandando para revisão…');
  res = await fetchFn(`${API}/v2/${name}:publish`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }) });
  body = await readBody(res);
  if (!res.ok) throw new Error(explain('Envio para revisão', res.status, body));
  for (const w of body?.warningInfo?.warnings || []) log(`  aviso: ${w.reason || ''} ${w.description || ''}`.trim());
  log(`Pronto: estado ${body?.state || 'enviado'} (o Google avisa por e-mail quando terminar a revisão).`);
  return body;
}

/** Confere as credenciais sem enviar nada: obtém o token e consulta o status do item. */
export async function checkChrome({ publisherId, extensionId, fetchFn = fetch, log = console.log, ...auth }) {
  for (const [k, v] of Object.entries({ CWS_PUBLISHER_ID: publisherId, CWS_EXTENSION_ID: extensionId })) if (!v) throw new Error(`Falta ${k}.`);
  const token = await getAccessToken({ ...auth, fetchFn });
  const name = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`;
  const res = await fetchFn(`${API}/v2/${name}:fetchStatus`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await readBody(res);
  if (!res.ok) throw new Error(explain('Credenciais da Chrome Web Store', res.status, body));
  const pub = body?.publishedItemRevisionStatus;
  const sub = body?.submittedItemRevisionStatus;
  const ver = (r) => r?.distributionChannels?.map((d) => d.crxVersion).filter(Boolean).join(', ');
  log(`✓ Chrome: acesso confirmado. Publicada: ${ver(pub) || '?'} (${pub?.state || '?'})${sub ? ` · em revisão: ${ver(sub) || '?'} (${sub.state || '?'})` : ''}.`);
  return body;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const env = process.env;
  const creds = {
    publisherId: env.CWS_PUBLISHER_ID, extensionId: env.CWS_EXTENSION_ID,
    serviceAccount: env.CWS_SERVICE_ACCOUNT || undefined,
    clientId: env.CWS_CLIENT_ID, clientSecret: env.CWS_CLIENT_SECRET, refreshToken: env.CWS_REFRESH_TOKEN,
  };
  if (args[0] === '--check') {
    try { await checkChrome(creds); }
    catch (e) { console.error(`::error::${e.message.replace(/\n/g, '%0A')}`); process.exit(1); }
    process.exit(0);
  }
  const [file = 'dist/neurotab.zip'] = args;
  try {
    await publishChrome({
      publisherId: env.CWS_PUBLISHER_ID, extensionId: env.CWS_EXTENSION_ID,
      serviceAccount: env.CWS_SERVICE_ACCOUNT || undefined,
      clientId: env.CWS_CLIENT_ID, clientSecret: env.CWS_CLIENT_SECRET, refreshToken: env.CWS_REFRESH_TOKEN,
      zip: await readFile(file),
    });
  } catch (e) {
    console.error(`::error::${e.message.replace(/\n/g, '%0A')}`);
    process.exit(1);
  }
}
