// Adaptador: Google Gemini (API generativelanguage).
import { http, postJson, DIM } from './http.js';
import { AIError } from '../errors.js';

const parts = (content) => (Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }])
  .map((x) => (x.type === 'image' ? { inline_data: { mime_type: x.mime, data: x.data } } : { text: x.text }));

export async function generate(c, { system = '', messages, json = false, maxTokens = 1200 }) {
  const body = {
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: parts(m.content) })),
    generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const model = c.model.replace(/^models\//, '');
  const r = await postJson(`${c.base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': c.key }, body);
  const out = (r?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!out) throw new AIError('invalid', 'A IA não retornou texto (' + (r?.candidates?.[0]?.finishReason || r?.promptFeedback?.blockReason || 'vazio') + ').');
  return out;
}

export async function embed(c, texts, kind = 'doc') {
  const model = 'models/' + c.model.replace(/^models\//, '');
  const reqs = (opts) => texts.map((t) => ({ model, content: { parts: [{ text: t }] }, ...opts }));
  const url = `${c.base}/v1beta/${model}:batchEmbedContents`;
  const headers = { 'x-goog-api-key': c.key };
  let r;
  try {
    r = await postJson(url, headers, { requests: reqs({ taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', outputDimensionality: DIM }) });
  } catch (e) {
    if (e.status !== 400) throw e;
    r = await postJson(url, headers, { requests: reqs({}) }); // modelo sem suporte a esses campos
  }
  return (r.embeddings || []).map((e) => e.values);
}

export async function listModels(c) {
  const r = await http(`${c.base}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': c.key } });
  return (r.models || [])
    .filter((m) => /gemini|embedding/.test(m.name) && !/(image|tts|audio|live|robotics|computer)/.test(m.name))
    .map((m) => {
      const methods = m.supportedGenerationMethods || [];
      const embed = methods.includes('embedContent') || methods.includes('batchEmbedContents');
      return methods.includes('generateContent') || embed ? { id: m.name.replace(/^models\//, ''), caps: { embed, vision: !embed } } : null;
    })
    .filter(Boolean);
}
