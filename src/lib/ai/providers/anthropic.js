// Adaptador: Anthropic (Claude). Não tem embeddings.
import { http, postJson } from './http.js';
import { AIError } from '../errors.js';

const headers = (c) => ({ 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
const toAnthropic = (content) => (Array.isArray(content)
  ? content.map((x) => (x.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: x.mime, data: x.data } } : { type: 'text', text: x.text }))
  : content);

export async function generate(c, { system = '', messages, maxTokens = 1200 }) {
  const r = await postJson(`${c.base}/messages`, headers(c), { model: c.model, max_tokens: maxTokens, system: system || undefined, messages: messages.map((m) => ({ ...m, content: toAnthropic(m.content) })) });
  return (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export async function embed() {
  throw new AIError('unsupported', 'A Anthropic não oferece embeddings.');
}

export async function listModels(c) {
  const r = await http(`${c.base}/models?limit=100`, { headers: headers(c) });
  return (r.data || []).map((m) => ({ id: m.id, caps: { vision: true, embed: false } }));
}
