// NeuroTab — tipos de servidor de IA e o que cada modelo sabe fazer (0.8.0).
// "Tipo" é o formato da API (Gemini, OpenAI e compatíveis, Anthropic…); um servidor é um endereço desse tipo.

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

/** Nome curto para listas e selos ("Gemini", "Ollama"…). */
export const SHORT = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter', ollama: 'Ollama', custom: 'Compatível' };

/** Modelo de embeddings padrão de cada tipo. Anthropic não tem (null). */
export const EMBED_DEFAULTS = {
  gemini: 'gemini-embedding-001',
  openai: 'text-embedding-3-small',
  openrouter: 'openai/text-embedding-3-small',
  ollama: 'nomic-embed-text',
  custom: '',
  anthropic: null,
};

const CLOUD_TYPES = new Set(['gemini', 'openai', 'anthropic', 'openrouter']);

/** Onde os dados vão: 'local' (este computador), 'lan' (rede de casa) ou 'cloud' (internet). */
export function whereOf(type, base) {
  if (CLOUD_TYPES.has(type)) return 'cloud';
  let host = '';
  try { host = new URL(base).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return 'cloud'; }
  if (host === 'localhost' || /^127\./.test(host) || host === '::1') return 'local';
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
    || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host) || /\.(local|lan|home\.arpa|internal)$/.test(host)) return 'lan';
  return 'cloud';
}

export const WHERE = {
  local: { icon: '🖥️', label: 'Este computador' },
  lan: { icon: '🏠', label: 'Rede de casa' },
  cloud: { icon: '☁️', label: 'Internet' },
};

const EMBED_NAME = /embed|nomic-bert|\bbge\b|bge-|mxbai|minilm|(^|[-/])e5-|gte-|arctic-embed|text-embedding/i;
export const VISION_NAME = /llava|bakllava|vision|gemma3|qwen2(\.5)?-?vl|qwen3-?vl|minicpm-v|moondream|granite3\.2-vision|mistral-small3\.[12]|llama4|pixtral/i;

/**
 * Palpite do que o modelo sabe fazer, pelo tipo e pelo nome: { text, vision, embed }.
 * true = sabe, false = não sabe, null = não dá para saber (é permitido; a pessoa pode corrigir).
 */
export function guessCaps(type, model = '') {
  const m = String(model);
  if (EMBED_NAME.test(m)) return { text: false, vision: false, embed: true };
  switch (type) {
    case 'gemini': return { text: true, vision: /gemini|gemma-3/i.test(m) ? true : null, embed: false };
    case 'anthropic': return { text: true, vision: /claude/i.test(m) ? true : null, embed: false };
    case 'openai': return { text: true, vision: /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|^o[34]|chatgpt-4o/i.test(m) ? true : /gpt-3\.5/i.test(m) ? false : null, embed: false };
    default: return { text: true, vision: VISION_NAME.test(m) ? true : null, embed: false };
  }
}
