// NeuroTab — central de contas (Google agora; Microsoft na 0.7.6.3).
// Várias contas ao mesmo tempo. Cada recurso (sincronização, agenda, e-mail…) pede só as permissões
// de que precisa, quando é ligado. O acesso fica guardado só neste navegador; nada passa por servidor nosso.
//
// Login: identity.launchWebAuthFlow (Chrome, Edge e Firefox), fluxo implícito do Google → token de 1 hora,
// renovado em silêncio (prompt=none) enquanto a pessoa estiver logada no Google neste navegador.
import { OAUTH, SCOPES } from './oauth-config.js';

export const ACCOUNTS_KEY = 'nt_accounts'; // { accounts: [{ id, provider, email, name, picture, scopes, addedAt }] }
export const TOKENS_KEY = 'nt_account_tokens'; // { [id]: { accessToken, expiresAt, scopes } } — nunca vai para backup nem sincronização

const store = () => globalThis.chrome?.storage?.local;
const ident = () => globalThis.browser?.identity || (globalThis.chrome && chrome.identity);
const perms = () => globalThis.browser?.permissions || globalThis.chrome?.permissions;

export class AuthError extends Error {
  constructor(message, code = 'auth') { super(message); this.code = code; }
}

export const OAUTH_OVERRIDE_KEY = 'nt_oauth_override'; // { google: 'client id' } — só para testar antes de gravar no código

/** Client ID em uso: o gravado no código ou, para testes, o colado em Contas → "Para quem configura o login". */
export async function clientId(provider) {
  if (OAUTH[provider]?.clientId) return OAUTH[provider].clientId;
  try { return ((await store().get(OAUTH_OVERRIDE_KEY))[OAUTH_OVERRIDE_KEY] || {})[provider] || ''; } catch { return ''; }
}
/** O provedor está configurado (há client ID)? */
export const providerReady = async (provider) => !!(await clientId(provider));

/** Endereço de retorno do login neste navegador (para cadastrar no Google Cloud). */
export function redirectUrl() {
  try { return ident()?.getRedirectURL?.() || ''; } catch { return ''; }
}

export async function listAccounts() {
  return (await store().get(ACCOUNTS_KEY))[ACCOUNTS_KEY]?.accounts || [];
}
async function saveAccounts(accounts) { await store().set({ [ACCOUNTS_KEY]: { accounts } }); }
async function loadTokens() { return (await store().get(TOKENS_KEY))[TOKENS_KEY] || {}; }
async function saveToken(id, tok) { const all = await loadTokens(); all[id] = tok; await store().set({ [TOKENS_KEY]: all }); }

/** Pede a permissão "identity" (opcional no manifesto). Chamar direto no clique. */
export function requestIdentity() {
  try { return perms().request({ permissions: ['identity'] }).catch(() => false); } catch { return Promise.resolve(false); }
}
export async function hasIdentity() {
  try { return !!ident()?.launchWebAuthFlow || await perms().contains({ permissions: ['identity'] }); } catch { return false; }
}

const randomState = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Monta o endereço de login do Google. */
export function googleAuthUrl({ scopes, loginHint = '', prompt = '', state, client = OAUTH.google.clientId }) {
  const g = OAUTH.google;
  const q = new URLSearchParams({
    client_id: client,
    response_type: 'token',
    redirect_uri: redirectUrl(),
    scope: [...new Set([...g.baseScopes, ...scopes])].join(' '),
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) q.set('login_hint', loginHint);
  if (prompt) q.set('prompt', prompt);
  return `${g.authUrl}?${q}`;
}

/** Lê a resposta do login (o token vem no fragmento #). */
export function parseAuthResponse(url, state) {
  const frag = new URLSearchParams(String(url).split('#')[1] || String(url).split('?')[1] || '');
  if (frag.get('error')) {
    const e = frag.get('error');
    throw new AuthError(e === 'access_denied' ? 'Você não autorizou o acesso.' : e === 'interaction_required' || e === 'login_required' || e === 'consent_required' ? 'É preciso entrar de novo na conta.' : `O login falhou (${e}).`, e);
  }
  if (frag.get('state') !== state) throw new AuthError('Resposta de login inválida. Tente de novo.', 'state');
  const token = frag.get('access_token');
  if (!token) throw new AuthError('O login não devolveu acesso. Tente de novo.', 'no_token');
  return { accessToken: token, expiresAt: Date.now() + (Number(frag.get('expires_in')) || 3600) * 1000 - 60e3, scopes: (frag.get('scope') || '').split(/\s+/).filter(Boolean) };
}

async function runFlow({ scopes, loginHint, prompt, interactive }) {
  const client = await clientId('google');
  if (!client) throw new AuthError('O login com Google ainda não foi configurado nesta versão da NeuroTab.', 'not_configured');
  if (!ident()?.launchWebAuthFlow) throw new AuthError('Este navegador não permitiu o login (falta a permissão de identidade).', 'no_identity');
  const state = randomState();
  let url;
  try {
    url = await ident().launchWebAuthFlow({ url: googleAuthUrl({ scopes, loginHint, prompt, state, client }), interactive });
  } catch (e) {
    const m = String(e?.message || e);
    if (/did not approve|canceled|cancelled|closed/i.test(m)) throw new AuthError('Login cancelado.', 'cancelled');
    throw new AuthError(interactive ? `Não consegui abrir o login: ${m}` : 'É preciso entrar de novo na conta.', interactive ? 'flow' : 'interaction_required');
  }
  return parseAuthResponse(url, state);
}

async function userInfo(accessToken, fetchFn = fetch) {
  const res = await fetchFn(OAUTH.google.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new AuthError('Não consegui ler os dados da conta.', 'userinfo');
  return res.json();
}

/**
 * Conecta uma conta Google (abre a janela de login). feature: recurso que já pede a permissão junto.
 * Se a conta já existe, atualiza as permissões. Devolve a conta.
 */
export async function connectGoogle({ feature = '', fetchFn = fetch } = {}) {
  const scopes = feature ? SCOPES.google[feature] || [] : [];
  const tok = await runFlow({ scopes, prompt: 'select_account', interactive: true });
  const info = await userInfo(tok.accessToken, fetchFn);
  const id = `google:${info.sub}`;
  const accounts = await listAccounts();
  const prev = accounts.find((a) => a.id === id);
  const acc = { id, provider: 'google', email: info.email || '', name: info.name || info.email || 'Google', picture: info.picture || '', scopes: [...new Set([...(prev?.scopes || []), ...tok.scopes])], addedAt: prev?.addedAt || Date.now() };
  await saveAccounts(prev ? accounts.map((a) => (a.id === id ? acc : a)) : [...accounts, acc]);
  await saveToken(id, tok);
  return acc;
}

const hasScopes = (granted, need) => need.every((s) => granted.includes(s));

/**
 * Acesso válido para uma conta e recurso. Renova em silêncio quando vence; com interactive, abre o login
 * se precisar de permissão nova ou se a sessão do Google saiu. Erros: AuthError (code 'interaction_required' etc.).
 */
export async function getAccessToken(accountId, feature = '', { interactive = false } = {}) {
  const acc = (await listAccounts()).find((a) => a.id === accountId);
  if (!acc) throw new AuthError('Conta não conectada.', 'no_account');
  const need = feature ? SCOPES[acc.provider]?.[feature] || [] : [];
  const tok = (await loadTokens())[accountId];
  if (tok && tok.expiresAt > Date.now() && hasScopes(tok.scopes, need)) return tok.accessToken;
  const fresh = await runFlow({ scopes: [...new Set([...(acc.scopes || []).filter((s) => s.startsWith('https://')), ...need])], loginHint: acc.email, prompt: interactive && !hasScopes(acc.scopes || [], need) ? 'consent' : interactive ? '' : 'none', interactive });
  await saveToken(accountId, fresh);
  if (!hasScopes(acc.scopes || [], fresh.scopes)) {
    const accounts = await listAccounts();
    await saveAccounts(accounts.map((a) => (a.id === accountId ? { ...a, scopes: [...new Set([...(a.scopes || []), ...fresh.scopes])] } : a)));
  }
  if (!hasScopes(fresh.scopes, need)) throw new AuthError('A permissão necessária não foi concedida.', 'scope');
  return fresh.accessToken;
}

/** fetch autenticado: renova o acesso uma vez se o Google responder 401. */
export async function authFetch(accountId, feature, url, opts = {}, { fetchFn = fetch, interactive = false } = {}) {
  let token = await getAccessToken(accountId, feature, { interactive });
  const go = (t) => fetchFn(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  let res = await go(token);
  if (res.status === 401) {
    const all = await loadTokens();
    delete all[accountId];
    await store().set({ [TOKENS_KEY]: all });
    token = await getAccessToken(accountId, feature, { interactive });
    res = await go(token);
  }
  return res;
}

/** Desconecta a conta: revoga o acesso no Google e apaga os dados locais dela. */
export async function disconnect(accountId, { fetchFn = fetch } = {}) {
  const tok = (await loadTokens())[accountId];
  if (tok?.accessToken && accountId.startsWith('google:')) {
    await fetchFn(`${OAUTH.google.revokeUrl}?token=${encodeURIComponent(tok.accessToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => {});
  }
  const all = await loadTokens();
  delete all[accountId];
  await store().set({ [TOKENS_KEY]: all });
  await saveAccounts((await listAccounts()).filter((a) => a.id !== accountId));
}
