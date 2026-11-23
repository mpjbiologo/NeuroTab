// Adaptador: OpenAI e compatíveis (OpenRouter, Ollama, LM Studio, Groq…).
import { http, postJson, DIM } from './http.js';
import { VISION_NAME } from '../catalog.js';

function headers(c) {
  const h = {};
  if (c.key) h.Authorization = 'Bearer ' + c.key;
  if (c.type === 'openrouter') { h['HTTP-Referer'] = 'https://github.com/mpjbiologo/NeuroTab'; h['X-Title'] = 'NeuroTab'; }
  return h;
}
const asText = (content) => (Array.isArray(content) ? content.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : content);
const toOpenAI = (content) => (Array.isArray(content)
  ? content.map((x) => (x.type === 'image' ? { type: 'image_url', image_url: { url: `data:${x.mime};base64,${x.data}` } } : { type: 'text', text: x.text }))
  : content);

export async function generate(c, { system = '', messages, json = false, maxTokens = 1200 }) {
  const conv = messages.map((m) => ({ ...m, content: m.role === 'user' ? toOpenAI(m.content) : asText(m.content) }));
  const body = { model: c.model, messages: system ? [{ role: 'system', content: system }, ...conv] : conv };
  if (json && c.type !== 'ollama') body.response_format = { type: 'json_object' };
  if (c.type === 'openai') body.max_completion_tokens = maxTokens * 4; // inclui raciocínio
  else body.max_tokens = maxTokens;
  const r = await postJson(`${c.base}/chat/completions`, headers(c), body);
  return r?.choices?.[0]?.message?.content || '';
}

export async function embed(c, texts, kind = 'doc') {
  const prefix = /nomic/.test(c.model) ? (kind === 'query' ? 'search_query: ' : 'search_document: ') : '';
  const body = { model: c.model, input: texts.map((t) => prefix + t) };
  if (/text-embedding-3/.test(c.model)) body.dimensions = DIM;
  const r = await postJson(`${c.base}/embeddings`, headers(c), body);
  return (r.data || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
}

const ollamaRoot = (base) => base.replace(/\/v1$/, '');

/** O Ollama novo diz o que cada modelo sabe ("capabilities"); nos antigos, decide pela família e pelo nome. */
export async function ollamaCaps(base, model) {
  try {
    const info = await postJson(ollamaRoot(base) + '/api/show', {}, { model, name: model });
    if (Array.isArray(info?.capabilities)) return { vision: info.capabilities.includes('vision'), embed: info.capabilities.includes('embedding') };
    const fam = [...(info?.details?.families || []), info?.details?.family].join(' ');
    if (/clip|mllama|vision/i.test(fam) || Object.keys(info?.model_info || {}).some((k) => /vision/.test(k)) || info?.projector_info) return { vision: true, embed: null };
    if (/bert/i.test(fam)) return { vision: false, embed: true };
  } catch { /* sem /api/show: decide pelo nome */ }
  return { vision: VISION_NAME.test(model) ? true : null, embed: null };
}

export async function listModels(c) {
  const r = await http(`${c.base}/models`, { headers: headers(c) });
  let list = (r.data || r.models || []).map((m) => {
    const mods = m.architecture?.input_modalities;
    return { id: m.id || m.name, caps: Array.isArray(mods) ? { vision: mods.includes('image'), embed: null } : null };
  }).filter((m) => m.id);
  if (c.type === 'openai') list = list.filter((m) => /^(gpt|o\d|chatgpt|text-embedding)/.test(m.id) && !/(audio|realtime|image|tts|transcribe|search)/.test(m.id));
  if (c.type === 'ollama') {
    for (const m of list.slice(0, 40)) m.caps = await ollamaCaps(c.base, m.id);
  }
  return list.sort((a, b) => a.id.localeCompare(b.id));
}
