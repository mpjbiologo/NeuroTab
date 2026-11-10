#!/usr/bin/env node
// Envia um pacote novo para a loja do Edge (Microsoft Edge Add-ons) e manda para certificação.
// Usa a API de atualização v1.1 (chave de API + Client ID, criadas em Partner Center → Publish API).
//
// Uso:  EDGE_PRODUCT_ID=... EDGE_CLIENT_ID=... EDGE_API_KEY=... node scripts/publish-edge.mjs dist/neurotab.zip "notas"
//
// Passos: 1) sobe o zip para o rascunho  2) espera a validação  3) publica o rascunho  4) espera o envio.
// Depois disso a Microsoft revisa (alguns dias) e, aprovada, a loja atualiza todo mundo sozinha.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const API = 'https://api.addons.microsoftedge.microsoft.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Explicações em português para os erros mais comuns da API.
const HINTS = {
  401: 'Chave de API ou Client ID inválidos ou vencidos. Gere uma chave nova em Partner Center → Microsoft Edge → Publish API e atualize o segredo EDGE_API_KEY.',
  403: 'Sem permissão para este produto. Confira o EDGE_PRODUCT_ID (Partner Center → a extensão → Extension overview → Product ID).',
  404: 'Produto não encontrado. Confira o EDGE_PRODUCT_ID.',
  InProgressSubmission: 'Já existe uma versão em revisão na loja do Edge. Espere a revisão terminar (ou cancele o envio no Partner Center) e rode de novo.',
  UnpublishInProgress: 'A extensão está sendo despublicada no Partner Center.',
  NoModulesUpdated: 'O pacote é igual ao que já está na loja. Suba a versão no manifest.json.',
};

function explain(where, status, body) {
  const code = body?.errorCode || '';
  const detail = [body?.message, ...(body?.errors || []).map((e) => e.message || JSON.stringify(e))].filter(Boolean).join(' | ');
  const hint = HINTS[code] || HINTS[status] || '';
  return `${where}: HTTP ${status}${code ? ` (${code})` : ''}${detail ? ` — ${detail}` : ''}${hint ? `\n→ ${hint}` : ''}`;
}

async function readBody(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return { message: text.slice(0, 500) }; }
}

/** A API devolve o id da operação no cabeçalho Location (às vezes como URL completa). */
const operationId = (res) => (res.headers.get('location') || '').split('/').filter(Boolean).pop();

async function poll(fetchFn, url, headers, { where, interval, timeout, log }) {
  const end = Date.now() + timeout;
  for (;;) {
    const res = await fetchFn(url, { headers });
    const body = await readBody(res);
    if (!res.ok) throw new Error(explain(where, res.status, body));
    if (body?.status === 'Succeeded') return body;
    if (body?.status === 'Failed') throw new Error(explain(where, res.status, body));
    if (Date.now() > end) throw new Error(`${where}: a operação ainda estava em andamento depois de ${Math.round(timeout / 1000)} s. Confira no Partner Center.`);
    log(`  … ${where}: ${body?.status || 'aguardando'}`);
    await sleep(interval);
  }
}

export async function publishEdge({ productId, clientId, apiKey, zip, notes = '', fetchFn = fetch, interval = 5000, timeout = 10 * 60_000, log = console.log }) {
  for (const [k, v] of Object.entries({ EDGE_PRODUCT_ID: productId, EDGE_CLIENT_ID: clientId, EDGE_API_KEY: apiKey })) if (!v) throw new Error(`Falta ${k}.`);
  const auth = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
  const base = `${API}/products/${encodeURIComponent(productId)}/submissions`;
  const opts = { interval, timeout, log };

  log('1/4 Enviando o pacote para o rascunho…');
  let res = await fetchFn(`${base}/draft/package`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: zip });
  if (res.status !== 202) throw new Error(explain('Envio do pacote', res.status, await readBody(res)));
  const up = operationId(res);
  if (!up) throw new Error('Envio do pacote: a API não devolveu o id da operação (cabeçalho Location).');

  log('2/4 Esperando a validação do pacote…');
  await poll(fetchFn, `${base}/draft/package/operations/${up}`, auth, { ...opts, where: 'Validação do pacote' });

  log('3/4 Mandando para certificação…');
  res = await fetchFn(base, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) });
  if (res.status !== 202) throw new Error(explain('Envio para certificação', res.status, await readBody(res)));
  const pub = operationId(res);
  if (!pub) throw new Error('Envio para certificação: a API não devolveu o id da operação (cabeçalho Location).');

  log('4/4 Confirmando o envio…');
  const done = await poll(fetchFn, `${base}/operations/${pub}`, auth, { ...opts, where: 'Envio para certificação' });
  log(`Pronto: ${done.message || 'versão enviada para revisão da Microsoft.'}`);
  return done;
}

/**
 * Confere as credenciais sem enviar nada: consulta uma operação que não existe.
 * 401/403 = credencial recusada; qualquer outra resposta = a Microsoft aceitou a chave e o produto.
 */
export async function checkEdge({ productId, clientId, apiKey, fetchFn = fetch, log = console.log }) {
  for (const [k, v] of Object.entries({ EDGE_PRODUCT_ID: productId, EDGE_CLIENT_ID: clientId, EDGE_API_KEY: apiKey })) if (!v) throw new Error(`Falta ${k}.`);
  const url = `${API}/products/${encodeURIComponent(productId)}/submissions/operations/00000000-0000-0000-0000-000000000000`;
  const res = await fetchFn(url, { headers: { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId } });
  const body = await readBody(res);
  if (res.status === 401 || res.status === 403) throw new Error(explain('Credenciais do Edge', res.status, body));
  log(`✓ Edge: a Microsoft aceitou a chave e o Client ID (resposta ${res.status} à consulta de teste).`);
  return res.status;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    try { await checkEdge({ productId: process.env.EDGE_PRODUCT_ID, clientId: process.env.EDGE_CLIENT_ID, apiKey: process.env.EDGE_API_KEY }); }
    catch (e) { console.error(`::error::${e.message.replace(/\n/g, '%0A')}`); process.exit(1); }
    process.exit(0);
  }
  const [file = 'dist/neurotab.zip', notes = ''] = args;
  try {
    await publishEdge({
      productId: process.env.EDGE_PRODUCT_ID, clientId: process.env.EDGE_CLIENT_ID, apiKey: process.env.EDGE_API_KEY,
      zip: await readFile(file), notes,
    });
  } catch (e) {
    console.error(`::error::${e.message.replace(/\n/g, '%0A')}`);
    process.exit(1);
  }
}
