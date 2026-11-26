// Teste individual de cada modelo (0.9.2.3, #76): uma chamada mínima por modelo, com tempo-limite,
// poucos testes ao mesmo tempo, parada no primeiro "limite excedido" e resultado explicado.
// Não guarda nem registra a chave; os resultados ficam só neste navegador (nt_ai_probe).
import { adapterFor } from './providers/index.js';

export const PROBE_KEY = 'nt_ai_probe'; // { [serverId]: { [modelId]: { status, at, ms, detail, code } } }

/** Estados mostrados ao lado de cada modelo. */
export const PROBE_STATUS = {
  ok: { icon: '●', label: 'Conectado', cls: 'ok' },
  auth: { icon: '✕', label: 'Não autorizado', cls: 'err' },
  missing: { icon: '✕', label: 'Indisponível', cls: 'err' },
  limit: { icon: '⏳', label: 'Limite excedido', cls: 'warn' },
  unsupported: { icon: '◐', label: 'Incompatível', cls: 'warn' },
  offline: { icon: '✕', label: 'Erro de conexão', cls: 'err' },
  inconclusive: { icon: '?', label: 'Inconclusivo', cls: 'warn' },
  untested: { icon: '○', label: 'Não testado', cls: 'muted' },
};

export const PROBE_HINT = {
  ok: 'O modelo respondeu a uma chamada mínima com esta chave.',
  auth: 'A chave foi recusada ou não tem acesso a este modelo.',
  missing: 'O modelo não existe mais, não foi encontrado ou o servidor está indisponível agora.',
  limit: 'Cota ou limite de pedidos atingido. Espere um pouco antes de testar de novo.',
  unsupported: 'O modelo existe, mas não faz o que a NeuroTab pede (gerar texto ou embeddings).',
  offline: 'Sem resposta: internet, endereço, permissão de acesso ou tempo esgotado.',
  inconclusive: 'O provedor respondeu de um jeito que não confirma nem descarta o acesso.',
  untested: 'Ainda não testado.',
};

/** Código de erro (AIError) → estado do modelo. */
export function statusFromError(e) {
  if (e?.timeout) return 'offline';
  switch (e?.code) {
    case 'auth': return 'auth';
    case 'missing': case 'server': return 'missing';
    case 'limit': return 'limit';
    case 'unsupported': return 'unsupported';
    case 'offline': return 'offline';
    case 'invalid': return 'ok'; // respondeu (HTTP 200), só que sem o texto esperado: o acesso existe
    default: return 'inconclusive';
  }
}

const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const tm = setTimeout(() => reject(Object.assign(new Error(`Tempo esgotado (${Math.round(ms / 1000)} s).`), { timeout: true })), ms);
  p.then((v) => { clearTimeout(tm); resolve(v); }, (e) => { clearTimeout(tm); reject(e); });
});

/**
 * Testa um modelo com a chamada mais barata que confirma o uso pela NeuroTab:
 * embeddings para modelos só de embeddings; senão, gerar um texto curtíssimo.
 * `c` = { type, base, key }; `caps` = { embed, text }. Devolve { status, ms, detail, code, at }.
 */
export async function probeModel(c, model, { caps = {}, timeoutMs = 20000, adapter = adapterFor(c.type), now = Date.now } = {}) {
  const t0 = now();
  const embedOnly = caps.embed === true && caps.text === false;
  try {
    if (embedOnly) {
      if (c.type === 'anthropic') return { status: 'unsupported', ms: 0, detail: 'A Anthropic não oferece embeddings.', code: 'unsupported', at: now() };
      await withTimeout(adapter.embed({ ...c, model }, ['ok'], 'query'), timeoutMs);
    } else {
      await withTimeout(adapter.generate({ ...c, model }, { messages: [{ role: 'user', content: 'Responda apenas: OK' }], maxTokens: 16 }), timeoutMs);
    }
    return { status: 'ok', ms: now() - t0, detail: '', code: '', at: now() };
  } catch (e) {
    const status = statusFromError(e);
    const detail = String(e?.message || '').slice(0, 240);
    return { status, ms: now() - t0, detail: e?.status ? `HTTP ${e.status} · ${detail}` : detail, code: e?.code || (e?.timeout ? 'timeout' : ''), at: now() };
  }
}

/**
 * Roda `run(model)` para cada modelo com no máximo `concurrency` ao mesmo tempo.
 * Para de começar testes novos quando `isCancelled()` ou quando um resultado for "limit"
 * (os que faltaram voltam como "untested", explicando o motivo). `onResult(model, r)` a cada um.
 */
export async function probeMany(models, run, { concurrency = 2, onResult = () => {}, isCancelled = () => false } = {}) {
  const queue = [...models];
  const out = {};
  let stop = '';
  const worker = async () => {
    while (queue.length) {
      if (isCancelled()) stop ||= 'Teste cancelado.';
      if (stop) break;
      const m = queue.shift();
      const r = await run(m);
      out[m] = r;
      onResult(m, r);
      if (r.status === 'limit') stop ||= 'Parado: o provedor avisou limite de uso. Espere um pouco e teste os restantes.';
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, models.length)) }, worker));
  for (const m of queue) {
    out[m] = { status: 'untested', ms: 0, detail: stop, code: '', at: 0 };
    onResult(m, out[m]);
  }
  return out;
}

/** Contagem por grupo para o resumo e o filtro: conectados, com problema e não testados. */
export function probeGroup(r) {
  if (!r || r.status === 'untested') return 'untested';
  return r.status === 'ok' ? 'ok' : 'bad';
}

export function probeSummary(results = {}, models = Object.keys(results)) {
  const s = { ok: 0, bad: 0, untested: 0, last: 0 };
  for (const m of models) {
    const r = results[m];
    s[probeGroup(r)]++;
    if (r?.at > s.last) s.last = r.at;
  }
  return s;
}

// ---------- Guardar (só neste navegador, nunca a chave) ----------
export async function loadProbes(serverId) {
  try { return (await chrome.storage.local.get(PROBE_KEY))[PROBE_KEY]?.[serverId] || {}; } catch { return {}; }
}

export async function saveProbes(serverId, results) {
  const all = (await chrome.storage.local.get(PROBE_KEY))[PROBE_KEY] || {};
  const clean = {};
  for (const [m, r] of Object.entries(results || {})) {
    if (r && r.status !== 'untested') clean[m] = { status: r.status, at: r.at, ms: r.ms, detail: String(r.detail || '').slice(0, 240), code: r.code || '' };
  }
  all[serverId] = clean;
  await chrome.storage.local.set({ [PROBE_KEY]: all });
}

export async function forgetProbes(serverId) {
  const all = (await chrome.storage.local.get(PROBE_KEY))[PROBE_KEY] || {};
  delete all[serverId];
  await chrome.storage.local.set({ [PROBE_KEY]: all });
}
