// NeuroTab — busca por significado (embeddings).
// Cada nota vira um vetor gerado pelo provedor de IA do usuário; os vetores ficam no IndexedDB.
// A busca combina palavras (searchItems) e significado (similaridade de cosseno).
import { openDB } from './idb.js';
import { aiConfig, isConfigured, complete, parseJson } from './ai.js';
import { displayTitle, searchItems } from './brain.js';
import { redact, secretsFromHeaders } from './secrets.js';

const STORE = 'vectors';
const DIM = 768;

// Modelos de embeddings padrão. Anthropic não tem — usa o plano B (a IA reordena).
export const EMBED_DEFAULTS = {
  gemini: 'gemini-embedding-001',
  openai: 'text-embedding-3-small',
  openrouter: 'openai/text-embedding-3-small',
  ollama: 'nomic-embed-text',
  custom: '',
  anthropic: null,
};

export function embedConfig(settings) {
  const c = aiConfig(settings);
  const custom = (settings.ai?.embedModels || {})[c.id];
  const model = custom || EMBED_DEFAULTS[c.id] || '';
  return { ...c, embedModel: model, supported: !!model && isConfigured(settings), tag: `${c.id}:${model}` };
}

export function semanticOn(settings) {
  return !!settings.ai?.semantic && isConfigured(settings);
}

// ---------- Chamadas de embeddings ----------
async function post(url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Não foi possível conectar ao provedor de IA. Verifique a internet, a URL e a permissão de acesso.');
  }
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* texto puro */ }
  if (!res.ok) {
    const msg = redact(json?.error?.message || json?.message || txt.slice(0, 200), secretsFromHeaders(headers));
    const err = new Error(res.status === 429 ? 'Limite de uso atingido no provedor. Tente de novo em instantes.' : `Erro ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Gera vetores (normalizados) para uma lista de textos. kind: 'doc' | 'query'. */
export async function embed(settings, texts, kind = 'doc') {
  const c = embedConfig(settings);
  if (!c.supported) throw new Error('O provedor escolhido não oferece embeddings.');
  let vecs;
  if (c.id === 'gemini') {
    const model = 'models/' + c.embedModel.replace(/^models\//, '');
    const reqs = (opts) => texts.map((t) => ({ model, content: { parts: [{ text: t }] }, ...opts }));
    const url = `${c.base}/v1beta/${model}:batchEmbedContents`;
    const headers = { 'x-goog-api-key': c.key };
    let r;
    try {
      r = await post(url, headers, { requests: reqs({ taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', outputDimensionality: DIM }) });
    } catch (e) {
      if (e.status !== 400) throw e;
      r = await post(url, headers, { requests: reqs({}) }); // modelo sem suporte a esses campos
    }
    vecs = (r.embeddings || []).map((e) => e.values);
  } else {
    const headers = c.key ? { Authorization: 'Bearer ' + c.key } : {};
    if (c.id === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/mpjbiologo/NeuroTab'; headers['X-Title'] = 'NeuroTab'; }
    const prefix = /nomic/.test(c.embedModel) ? (kind === 'query' ? 'search_query: ' : 'search_document: ') : '';
    const body = { model: c.embedModel, input: texts.map((t) => prefix + t) };
    if (/text-embedding-3/.test(c.embedModel)) body.dimensions = DIM;
    const r = await post(`${c.base}/embeddings`, headers, body);
    vecs = (r.data || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
  }
  if (vecs.length !== texts.length || vecs.some((v) => !Array.isArray(v) || !v.length)) throw new Error('O provedor devolveu embeddings em formato inesperado.');
  return vecs.map(normalizeVec);
}

function normalizeVec(v) {
  const a = Float32Array.from(v);
  let n = 0;
  for (let i = 0; i < a.length; i++) n += a[i] * a[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < a.length; i++) a[i] /= n;
  return a;
}

function dot(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// ---------- Texto e hash de cada item ----------
export function itemText(it) {
  return [displayTitle(it), it.summary, (it.tags || []).map((t) => '#' + t).join(' '), it.text || it.url || '']
    .filter(Boolean).join('\n').slice(0, 2000);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// ---------- IndexedDB ----------
async function allVectors() {
  const d = await openDB();
  return new Promise((res) => {
    const r = d.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
}

async function putVectors(rows) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    for (const r of rows) s.put(r);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

async function deleteVectors(ids) {
  if (!ids.length) return;
  const d = await openDB();
  return new Promise((res) => {
    const t = d.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    for (const id of ids) s.delete(id);
    t.oncomplete = res;
    t.onerror = res;
  });
}

export async function clearIndex() {
  const d = await openDB();
  return new Promise((res) => {
    const t = d.transaction(STORE, 'readwrite');
    t.objectStore(STORE).clear();
    t.oncomplete = res;
    t.onerror = res;
  });
}

let cache = null; // { tag, map: Map(id → {h, v}) }
async function vectorMap(tag) {
  if (cache && cache.tag === tag) return cache.map;
  const map = new Map();
  for (const r of await allVectors()) if (r.tag === tag) map.set(r.id, r);
  cache = { tag, map };
  return map;
}

/** Quantos itens já estão indexados com o modelo atual. */
export async function indexStatus(settings, items) {
  const c = embedConfig(settings);
  if (!c.supported) return { supported: false, done: 0, total: items.length };
  const map = await vectorMap(c.tag);
  const done = items.filter((it) => map.get(it.id)?.h === hash(itemText(it))).length;
  return { supported: true, done, total: items.length, model: c.embedModel };
}

/**
 * Gera vetores para itens novos ou alterados e remove os de itens apagados.
 * Usa um "lock" do navegador para que duas abas não indexem ao mesmo tempo.
 */
export async function indexItems(settings, items, onProgress) {
  const c = embedConfig(settings);
  if (!c.supported) return { done: 0, total: items.length, skipped: true };
  const run = async () => {
    cache = null; // outra aba pode ter indexado algo
    const map = await vectorMap(c.tag);
    const live = new Set(items.map((i) => i.id));
    const stale = [...map.keys()].filter((id) => !live.has(id));
    await deleteVectors(stale);
    stale.forEach((id) => map.delete(id));
    const todo = items.filter((it) => map.get(it.id)?.h !== hash(itemText(it)));
    let done = items.length - todo.length;
    onProgress?.(done, items.length);
    const BATCH = c.id === 'ollama' ? 16 : 64;
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const texts = chunk.map(itemText);
      const vecs = await embed(settings, texts, 'doc');
      const rows = chunk.map((it, k) => ({ id: it.id, tag: c.tag, h: hash(texts[k]), v: vecs[k] }));
      await putVectors(rows);
      rows.forEach((r) => map.set(r.id, r));
      done += chunk.length;
      onProgress?.(done, items.length);
    }
    return { done, total: items.length };
  };
  if (navigator.locks) {
    return navigator.locks.request('neurotab-semantic-index', { ifAvailable: true }, (lock) => (lock ? run() : { busy: true }));
  }
  return run();
}

// ---------- Busca ----------
const queryCache = new Map();
async function queryVector(settings, q) {
  const key = embedConfig(settings).tag + '|' + q;
  if (queryCache.has(key)) return queryCache.get(key);
  const [v] = await embed(settings, [q], 'query');
  if (queryCache.size > 50) queryCache.delete(queryCache.keys().next().value);
  queryCache.set(key, v);
  return v;
}

/** Itens mais parecidos com a pergunta: [{ it, sim }]. */
export async function semanticSearch(settings, items, q, limit = 20) {
  const c = embedConfig(settings);
  if (!c.supported || !q.trim()) return [];
  const map = await vectorMap(c.tag);
  if (!map.size) return [];
  const qv = await queryVector(settings, q.trim());
  const scored = [];
  for (const it of items) {
    const r = map.get(it.id);
    if (r) scored.push({ it, sim: dot(qv, r.v) });
  }
  scored.sort((a, b) => b.sim - a.sim);
  if (!scored.length) return [];
  // Corte relativo: os scores absolutos variam muito entre modelos.
  const best = scored[0].sim;
  return scored.filter((x) => x.sim >= best - 0.12).slice(0, limit);
}

/**
 * Busca híbrida: palavras + significado (fusão por posição — Reciprocal Rank Fusion).
 * Retorna [{ it, kw, sem }] — kw/sem indicam por onde o item foi achado.
 */
export async function hybridSearch(settings, items, q, limit = 20) {
  const kw = searchItems(items, q, limit * 2);
  let sem = [];
  try { sem = semanticOn(settings) ? await semanticSearch(settings, items, q, limit * 2) : []; } catch (e) { console.warn('NeuroTab: busca por significado indisponível', e); }
  const score = new Map();
  const add = (it, rank, field) => {
    const s = score.get(it.id) || { it, score: 0, kw: false, sem: false };
    s.score += 1 / (60 + rank);
    s[field] = true;
    score.set(it.id, s);
  };
  kw.forEach((it, i) => add(it, i, 'kw'));
  sem.forEach((x, i) => add(x.it, i, 'sem'));
  return [...score.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Plano B (provedor sem embeddings, ex.: Anthropic): a IA escolhe as notas relevantes
 * a partir de uma lista resumida das mais recentes.
 */
export async function rerankWithAI(settings, items, q, limit = 12) {
  const pool = items.slice(0, 150);
  if (!pool.length) return [];
  const list = pool.map((it, i) => `${i + 1}. ${displayTitle(it)} — ${(it.summary || it.text || it.url || '').replace(/\s+/g, ' ').slice(0, 140)}`).join('\n');
  const system = 'Você ajuda a encontrar notas relevantes. Responda SOMENTE com JSON: {"ids": [números das notas mais relevantes, da mais para a menos relevante, no máximo ' + limit + ']}. Considere o significado, não só palavras iguais. Se nenhuma servir, devolva {"ids": []}.';
  const out = parseJson(await complete(settings, { system, messages: [{ role: 'user', content: `Pergunta: ${q}\n\nNotas:\n${list}` }], json: true, maxTokens: 200 }));
  return (out.ids || []).map((n) => pool[+n - 1]).filter(Boolean).slice(0, limit);
}

/** Notas de contexto para "Pergunte ao cérebro". */
export async function contextItems(settings, items, q, limit = 14) {
  if (semanticOn(settings)) {
    const c = embedConfig(settings);
    try {
      if (c.supported) return (await hybridSearch(settings, items, q, limit)).map((x) => x.it);
      return await rerankWithAI(settings, items, q, limit);
    } catch (e) {
      console.warn('NeuroTab: contexto por significado falhou, usando palavras', e);
    }
  }
  return searchItems(items, q, limit);
}
