// NeuroTab — IA com vários provedores. As chamadas vão direto do navegador
// para o provedor escolhido, com a chave do próprio usuário.
import { displayTitle, searchItems, TYPES } from './brain.js';
import { hostOf } from './store.js';

export const PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    note: 'Tem camada gratuita. Recomendado para começar.',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-flash-latest',
    base: 'https://generativelanguage.googleapis.com',
  },
  openai: {
    name: 'OpenAI (ChatGPT)',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5-mini',
    base: 'https://api.openai.com/v1',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-haiku-5-5',
    base: 'https://api.anthropic.com/v1',
  },
  openrouter: {
    name: 'OpenRouter (centenas de modelos)',
    note: 'Uma chave só para modelos de vários fornecedores, incluindo alguns gratuitos.',
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'openrouter/auto',
    base: 'https://openrouter.ai/api/v1',
  },
  ollama: {
    name: 'Ollama (no seu computador, sem chave)',
    note: 'Rode o Ollama com OLLAMA_ORIGINS="chrome-extension://*" para liberar a extensão.',
    noKey: true,
    defaultModel: 'llama3.2',
    base: 'http://localhost:11434/v1',
    editableBase: true,
  },
  custom: {
    name: 'Outro compatível com OpenAI (URL própria)',
    note: 'LM Studio, Groq, Mistral, DeepSeek, Together…',
    defaultModel: '',
    base: '',
    editableBase: true,
  },
};

export function aiConfig(settings) {
  const ai = settings.ai || {};
  const id = PROVIDERS[ai.provider] ? ai.provider : 'gemini';
  const p = PROVIDERS[id];
  return {
    id,
    p,
    key: (ai.keys || {})[id] || '',
    model: (ai.models || {})[id] || p.defaultModel,
    base: ((ai.baseUrls || {})[id] || p.base).replace(/\/+$/, ''),
  };
}

export function isConfigured(settings) {
  const c = aiConfig(settings);
  return !!(c.base && c.model && (c.p.noKey || c.key));
}

export function originsFor(cfg) {
  try {
    const u = new URL(cfg.base);
    return [`${u.protocol}//${u.hostname}/*`];
  } catch {
    return [];
  }
}

// Precisa ser chamado a partir de um clique (gesto do usuário).
export async function requestPermission(cfg) {
  const origins = originsFor(cfg);
  if (!origins.length) throw new Error('URL do provedor inválida.');
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

async function http(url, opts) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error('Não foi possível conectar ao provedor de IA. Verifique a internet, a URL e a permissão de acesso.');
  }
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = null; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || txt.slice(0, 200);
    if (res.status === 401 || res.status === 403) throw new Error('Chave de API recusada: ' + msg);
    if (res.status === 429) throw new Error('Limite de uso atingido no provedor. Tente de novo em instantes. (' + msg + ')');
    throw new Error(`Erro ${res.status}: ${msg}`);
  }
  return json;
}

/**
 * messages: [{ role: 'user' | 'assistant', content: string }]
 * Retorna o texto da resposta.
 */
export async function complete(settings, { system = '', messages, json = false, maxTokens = 1200 }) {
  const c = aiConfig(settings);
  if (!isConfigured(settings)) throw new Error('Configure a IA em Configurações → IA.');

  if (c.id === 'gemini') {
    const body = {
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const model = c.model.replace(/^models\//, '');
    const r = await http(`${c.base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key },
      body: JSON.stringify(body),
    });
    const parts = r?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
    if (!text) throw new Error('A IA não retornou texto (' + (r?.candidates?.[0]?.finishReason || r?.promptFeedback?.blockReason || 'vazio') + ').');
    return text;
  }

  if (c.id === 'anthropic') {
    const r = await http(`${c.base}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: c.model, max_tokens: maxTokens, system: system || undefined, messages }),
    });
    return (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  // OpenAI e compatíveis (OpenRouter, Ollama, LM Studio, Groq…)
  const headers = { 'Content-Type': 'application/json' };
  if (c.key) headers.Authorization = 'Bearer ' + c.key;
  if (c.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/mpjbiologo/NeuroTab';
    headers['X-Title'] = 'NeuroTab';
  }
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const body = { model: c.model, messages: msgs };
  if (json && c.id !== 'ollama') body.response_format = { type: 'json_object' };
  if (c.id === 'openai') body.max_completion_tokens = maxTokens * 4; // inclui raciocínio
  else body.max_tokens = maxTokens;
  const r = await http(`${c.base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
  return r?.choices?.[0]?.message?.content || '';
}

export async function listModels(settings) {
  const c = aiConfig(settings);
  if (c.id === 'gemini') {
    const r = await http(`${c.base}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': c.key } });
    return (r.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /gemini/.test(n) && !/(image|tts|audio|live|embedding|robotics|computer)/.test(n));
  }
  if (c.id === 'anthropic') {
    const r = await http(`${c.base}/models?limit=100`, {
      headers: { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    return (r.data || []).map((m) => m.id);
  }
  const headers = c.key ? { Authorization: 'Bearer ' + c.key } : {};
  const r = await http(`${c.base}/models`, { headers });
  let ids = (r.data || r.models || []).map((m) => m.id || m.name);
  if (c.id === 'openai') ids = ids.filter((n) => /^(gpt|o\d|chatgpt)/.test(n) && !/(audio|realtime|image|tts|transcribe|search)/.test(n));
  return ids.sort();
}

export function parseJson(text) {
  const clean = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Resposta da IA em formato inesperado.');
  }
}

function nowContext() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `Agora é ${now.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })} (fuso ${tz}, UTC${sign}${hh}:${mm}).`;
}

// ---------- Organizar um item (título, resumo, tags, tipo, lembrete) ----------
export async function enrich(settings, item) {
  const system = `Você organiza o "segundo cérebro" de uma pessoa. Responda SOMENTE com JSON válido, em português do Brasil.
${nowContext()}
Formato:
{"titulo": "até 8 palavras", "resumo": "1 frase curta (ou vazio se o texto já for curto)", "tags": ["até 4 tags, minúsculas, sem #"], "tipo": "nota|tarefa|ideia|trecho|pagina", "lembrete": "data/hora ISO 8601 com fuso, ou null"}
Regras: "tipo" é "tarefa" quando o texto descreve algo a fazer. Preencha "lembrete" SOMENTE se o texto pedir para lembrar/avisar ou citar data e hora para fazer algo.`;
  const content = [
    item.title && `Título atual: ${item.title}`,
    item.pageTitle && `Página: ${item.pageTitle} (${hostOf(item.url)})`,
    `Conteúdo:\n${(item.text || item.url || '').slice(0, 6000)}`,
  ].filter(Boolean).join('\n');
  const out = parseJson(await complete(settings, { system, messages: [{ role: 'user', content }], json: true, maxTokens: 400 }));
  const map = { nota: 'note', tarefa: 'task', ideia: 'idea', trecho: 'clip', pagina: 'page', página: 'page' };
  const patch = { enriched: true };
  if (!item.title && out.titulo) patch.title = String(out.titulo).slice(0, 90);
  if (out.resumo && (item.text || '').length > 140) patch.summary = String(out.resumo).slice(0, 300);
  if (Array.isArray(out.tags)) patch.tags = [...new Set([...(item.tags || []), ...out.tags.map((t) => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean)])].slice(0, 6);
  if (item.type === 'note' && map[out.tipo] && map[out.tipo] !== 'page') patch.type = map[out.tipo];
  if (!item.remindAt && out.lembrete) {
    const ts = Date.parse(out.lembrete);
    if (ts && ts > Date.now() - 60e3) patch.remindAt = ts;
  }
  return patch;
}

// ---------- Perguntar ao cérebro ----------
export function buildContext(items, question, limit = 14) {
  let found = searchItems(items, question, limit);
  if (found.length < 4) {
    const recent = items.filter((i) => !found.includes(i)).slice(0, limit - found.length);
    found = [...found, ...recent];
  }
  const text = found.map((it, i) => {
    const meta = [TYPES[it.type]?.label, new Date(it.createdAt).toLocaleDateString('pt-BR'), it.tags.length && '#' + it.tags.join(' #'), it.url && hostOf(it.url), it.remindAt && 'lembrete ' + new Date(it.remindAt).toLocaleString('pt-BR'), it.type === 'task' && (it.done ? 'concluída' : 'pendente')].filter(Boolean).join(' · ');
    return `[${i + 1}] ${displayTitle(it)} (${meta})\n${(it.text || it.summary || it.url).slice(0, 1500)}`;
  }).join('\n\n');
  return { found, text };
}

export async function ask(settings, items, question, history = []) {
  const { found, text } = buildContext(items, question);
  const system = `Você é o assistente do "segundo cérebro" do usuário, dentro da extensão NeuroTab. Responda em português do Brasil, de forma direta e curta (use listas quando ajudar).
${nowContext()}
Use as notas abaixo como fonte principal e cite-as como [1], [2]… Se a resposta não estiver nas notas, diga isso em uma linha e então responda com conhecimento geral, deixando claro que não veio das notas.

NOTAS DO USUÁRIO:
${text || '(nenhuma nota salva ainda)'}`;
  const messages = [...history.slice(-6), { role: 'user', content: question }];
  const answer = await complete(settings, { system, messages, maxTokens: 900 });
  return { answer, sources: found };
}
