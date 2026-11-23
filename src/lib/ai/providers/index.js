// Contrato comum dos adaptadores (0.8.0, #7):
//   generate(c, { system, messages, json, maxTokens }) → texto
//   embed(c, texts, kind) → vetores
//   listModels(c) → [{ id, caps: { vision, embed } | null }]
// c = { type, base, key, model } (o que o roteador escolheu).
import * as gemini from './gemini.js';
import * as anthropic from './anthropic.js';
import * as openai from './openai.js';

export const adapterFor = (type) => (type === 'gemini' ? gemini : type === 'anthropic' ? anthropic : openai);
export { ollamaCaps } from './openai.js';
