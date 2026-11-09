// NeuroTab — proteção de segredos (chaves de API) em mensagens de erro e registros.
// Não é criptografia: só evita que uma chave apareça na tela, no console ou em relatórios de erro.

// Formatos conhecidos de chaves: OpenAI (sk-…), Anthropic (sk-ant-…), OpenRouter (sk-or-…), Google (AIza…), tokens Bearer.
const PATTERNS = [
  /\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /([?&](?:key|api_key|apikey|token)=)[^&\s"']+/gi,
];

/** Mostra só o começo e o fim da chave: "sk-ab…wxyz". */
export function maskKey(key) {
  const k = String(key || '');
  if (k.length <= 8) return k ? '••••' : '';
  return `${k.slice(0, 5)}…${k.slice(-4)}`;
}

/** Remove chaves conhecidas e qualquer segredo informado de um texto. */
export function redact(text, secrets = []) {
  let s = String(text ?? '');
  for (const sec of secrets) {
    if (typeof sec === 'string' && sec.length >= 6) s = s.split(sec).join('[chave oculta]');
  }
  for (const re of PATTERNS) s = s.replace(re, (m, prefix) => (typeof prefix === 'string' && prefix.startsWith('?') || typeof prefix === 'string' && prefix.startsWith('&') ? prefix + '[oculto]' : '[chave oculta]'));
  return s;
}

/** Segredos presentes nos cabeçalhos de uma requisição (para ocultar na mensagem de erro). */
export function secretsFromHeaders(headers = {}) {
  return Object.entries(headers)
    .filter(([k]) => /authorization|api-key|x-goog-api-key|x-api-key/i.test(k))
    .map(([, v]) => String(v).replace(/^Bearer\s+/i, ''));
}
