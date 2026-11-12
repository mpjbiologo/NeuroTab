#!/usr/bin/env node
// Confere as credenciais da loja do Firefox (AMO) sem enviar nada e mostra a situação da NeuroTab na loja.
// Uso:  AMO_JWT_ISSUER=... AMO_JWT_SECRET=... node scripts/check-amo.mjs
import { createHmac, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const API = 'https://addons.mozilla.org/api/v5';
export const GUID = 'neurotab@mpjbiologo.github.io';
const b64url = (x) => Buffer.from(x).toString('base64url');

/** Token JWT (HS256) que a AMO pede em cada chamada; vale 5 minutos. */
export function amoToken(issuer, secret, now = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 300 }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function getJson(fetchFn, url, token) {
  const res = await fetchFn(url, { headers: { Authorization: `JWT ${token}`, Accept: 'application/json' } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { detail: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body };
}

export async function checkAmo({ issuer, secret, fetchFn = fetch, log = console.log }) {
  if (!issuer) throw new Error('Falta AMO_JWT_ISSUER.');
  if (!secret) throw new Error('Falta AMO_JWT_SECRET.');
  const me = await getJson(fetchFn, `${API}/accounts/profile/`, amoToken(issuer, secret));
  if (me.status === 401 || me.status === 403) {
    throw new Error(`Credenciais da AMO recusadas (HTTP ${me.status}${me.body?.detail ? ` — ${me.body.detail}` : ''}).\n→ Gere uma chave nova em https://addons.mozilla.org/developers/addon/api/key/ e atualize AMO_JWT_ISSUER e AMO_JWT_SECRET.`);
  }
  if (!me.ok) throw new Error(`AMO respondeu HTTP ${me.status} ao conferir a conta.`);
  log(`✓ Firefox (AMO): chave aceita (conta ${me.body?.username || me.body?.name || '?'}).`);

  const addon = await getJson(fetchFn, `${API}/addons/addon/${encodeURIComponent(GUID)}/`, amoToken(issuer, secret));
  if (!addon.ok) {
    log(`  Aviso: não encontrei a NeuroTab (${GUID}) nesta conta (HTTP ${addon.status}). Confira se a chave é da mesma conta que publicou.`);
    return { user: me.body, addon: null };
  }
  const a = addon.body;
  log(`  NeuroTab na loja: ${a.url || '?'} · versão ${a.current_version?.version || '?'} · ${a.status || '?'}`);
  return { user: me.body, addon: a };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    await checkAmo({ issuer: process.env.AMO_JWT_ISSUER, secret: process.env.AMO_JWT_SECRET });
  } catch (e) {
    console.error(`::error::${e.message.replace(/\n/g, '%0A')}`);
    process.exit(1);
  }
}
