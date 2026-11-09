// NeuroTab — mapa de permissões: cada acesso a site existe por causa de um recurso.
// Os obrigatórios ficam em "host_permissions" no manifest; os demais são pedidos só quando a pessoa usa o recurso.
// O teste tests/unit/permissions.test.js confere que o manifest e este mapa batem.

export const FEATURES = {
  weather: {
    label: 'Clima e fusos horários',
    why: 'Busca a previsão do tempo e as cidades que você adiciona (Open-Meteo). Envia só as coordenadas das cidades escolhidas.',
    origins: ['https://api.open-meteo.com/*', 'https://geocoding-api.open-meteo.com/*'],
    data: ['locationInfo'], // Firefox: consentimento de dados (coordenadas das cidades)
    required: true,
  },
  updates: {
    label: 'Aviso de versão nova',
    why: 'Consulta a última versão publicada no GitHub. Não é usado quando a extensão vem de uma loja.',
    origins: ['https://api.github.com/*'],
    required: true,
  },
  quotes: {
    label: 'Cotações e conversão de moedas',
    why: 'Busca dólar, euro, bitcoin (AwesomeAPI) e ações da B3 (brapi.dev) para o widget Cotações e para converter moedas na busca.',
    origins: ['https://economia.awesomeapi.com.br/*', 'https://brapi.dev/*'],
  },
  traffic: {
    label: 'Endereços do widget Trânsito',
    why: 'Procura o endereço dos seus locais favoritos (OpenStreetMap Nominatim).',
    origins: ['https://nominatim.openstreetmap.org/*'],
    data: ['locationInfo'],
  },
  slides: {
    label: 'Fotos do dia nos slides',
    why: 'Baixa a foto do dia do Bing e da NASA para o fundo da nova aba.',
    origins: ['https://www.bing.com/*', 'https://api.nasa.gov/*'],
  },
  ai: {
    label: 'Provedores de IA',
    why: 'Envia suas perguntas e o texto das notas usadas como contexto ao provedor que você configurar, com a sua chave.',
    origins: ['https://generativelanguage.googleapis.com/*', 'https://api.openai.com/*', 'https://api.anthropic.com/*', 'https://openrouter.ai/*'],
    data: ['websiteContent'],
    managed: true, // pedido na tela de IA, por provedor
  },
  local: {
    label: 'IA local (Ollama, LM Studio)',
    why: 'Conecta a um servidor de IA rodando no seu computador.',
    origins: ['http://localhost/*', 'http://127.0.0.1/*'],
    managed: true,
  },
  sites: {
    label: 'Outros sites (sob demanda)',
    why: 'Pedido site a site quando você adiciona um feed de notícias, salva uma imagem pelo menu ou usa uma IA com endereço próprio.',
    origins: ['https://*/*'],
    managed: true,
    perSite: true,
  },
};

const api = () => globalThis.chrome?.permissions;

// ---------- Consentimento de dados do Firefox (data_collection_permissions) ----------
// O Firefox pergunta à pessoa antes de a extensão enviar dados pessoais a serviços externos.
// Os tipos usados aqui estão em "optional" no manifest do Firefox (scripts/firefox-manifest.mjs).
// Nos navegadores Chromium não existe esse consentimento: as funções abaixo devolvem true.
export const DATA_TYPES = ['locationInfo', 'websiteContent'];
export function usesDataConsent() {
  return typeof globalThis.browser !== 'undefined' && typeof globalThis.browser?.runtime?.getBrowserInfo === 'function';
}

export async function hasData(type) {
  if (!usesDataConsent()) return true;
  try {
    return await globalThis.browser.permissions.contains({ data_collection: [type] });
  } catch {
    return true; // Firefox sem suporte ao consentimento (anterior ao 140)
  }
}

/** Pede origens e/ou consentimento de dados num único pedido. Chamar direto no clique, sem await antes. */
export function requestAccess({ origins = [], data = [] } = {}) {
  const req = { origins };
  if (usesDataConsent() && data.length) req.data_collection = data;
  return api().request(req).catch(() => false);
}

/** Recursos cujo acesso pode ser ligado/desligado pela pessoa. */
export const TOGGLEABLE = Object.entries(FEATURES).filter(([, f]) => !f.required && !f.managed).map(([id]) => id);

export async function hasFeature(id) {
  const f = FEATURES[id];
  if (!f) return false;
  try {
    if (!(await api().contains({ origins: f.origins }))) return false;
    for (const d of f.data || []) if (!(await hasData(d))) return false;
    return true;
  } catch {
    return false;
  }
}

/** Pede o acesso do recurso (sites e, no Firefox, consentimento de dados). Chamar direto num clique. */
export async function requestFeature(id) {
  const f = FEATURES[id];
  if (!f) return false;
  return requestAccess({ origins: f.origins, data: f.data || [] });
}

export async function revokeFeature(id) {
  const f = FEATURES[id];
  if (!f || f.required) return false;
  try {
    return await api().remove({ origins: f.origins });
  } catch {
    return false;
  }
}

/** Sites liberados individualmente (feeds, imagens, IA com endereço próprio). */
export async function grantedSites() {
  try {
    const all = (await api().getAll()).origins || [];
    const known = new Set(Object.values(FEATURES).flatMap((f) => f.origins));
    return all.filter((o) => !known.has(o));
  } catch {
    return [];
  }
}

export async function revokeSite(origin) {
  try {
    return await api().remove({ origins: [origin] });
  } catch {
    return false;
  }
}
