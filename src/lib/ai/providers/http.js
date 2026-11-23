// Pedido HTTP comum dos adaptadores: erros viram AIError e a chave nunca aparece na mensagem.
import { redact, secretsFromHeaders } from '../../secrets.js';
import { AIError, AI_ERRORS, codeFromStatus } from '../errors.js';

export async function http(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new AIError('offline');
  }
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = null; }
  if (!res.ok) {
    // Alguns provedores repetem parte da chave na mensagem de erro.
    const msg = redact(String(json?.error?.message || json?.message || json?.error || txt).slice(0, 200), secretsFromHeaders(opts.headers));
    const code = codeFromStatus(res.status, msg);
    const text = code === 'auth' ? `${AI_ERRORS.auth} ${msg}`
      : code === 'limit' ? `${AI_ERRORS.limit} (${msg})`
      : `Erro ${res.status}: ${msg}`;
    throw new AIError(code, text, { status: res.status });
  }
  return json;
}

export const postJson = (url, headers, body) => http(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

export const DIM = 768; // dimensão dos vetores, quando o modelo deixa escolher
