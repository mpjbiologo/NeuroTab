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
  routing: {
    label: 'Rotas pela rua',
    why: 'Traça o caminho, a distância e o tempo de um trajeto no widget Trânsito (servidores do OpenStreetMap), quando você pede uma rota. Só os dois pontos do trajeto são enviados. Não considera o trânsito de agora.',
    // três servidores gratuitos do OpenStreetMap: se um recusar, o próximo responde
    origins: ['https://routing.openstreetmap.de/*', 'https://valhalla1.openstreetmap.de/*', 'https://router.project-osrm.org/*'],
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
  gmail: {
    label: 'E-mail (Gmail)',
    why: 'O widget E-mail lê, no próprio Gmail e com a sessão já aberta neste navegador, a lista de e-mails não lidos (remetente, assunto, trecho e hora) para mostrar e avisar. Nada é enviado a outro lugar e nenhuma senha é guardada.',
    origins: ['https://mail.google.com/*'],
    managed: true, // pedido no widget
  },
  siteIcons: {
    label: 'Ícones dos atalhos em alta resolução',
    why: 'Busca o ícone de cada atalho em boa resolução no serviço de ícones do Google (t1.gstatic.com) ou do DuckDuckGo, conforme a sua escolha em Aparência → Estilo dos atalhos. Só o endereço do site vai para lá.',
    origins: ['https://t1.gstatic.com/*', 'https://icons.duckduckgo.com/*'],
    managed: true, // pedido em Estilo dos atalhos
  },
  mediaLinks: {
    label: 'Salvar mídia a partir de links',
    why: 'Para salvar no cérebro com resumo um post do Instagram, TikTok, X ou um vídeo do YouTube a partir do link (botão direito no link ou Captura rápida), a NeuroTab abre o link numa aba escondida e lê a legenda, a transcrição e o autor. Para posts do X, busca o texto completo no FixTweet (api.fxtwitter.com). Nada é enviado a esses sites além do próprio pedido da página.',
    origins: ['https://www.instagram.com/*', 'https://www.tiktok.com/*', 'https://www.youtube.com/*', 'https://x.com/*', 'https://api.fxtwitter.com/*'],
    data: ['websiteContent'],
    managed: true, // pedido em Configurações → Mídia
  },
  mediaDownload: {
    label: 'Baixar vídeos da Mídia',
    why: 'Baixa para a pasta Downloads o vídeo dos posts salvos (Instagram, TikTok e X) e, se você deixar, usa o seu login nesses sites para a NeuroTab Ponte conseguir baixar. Os cookies vão só para a Ponte, no seu computador.',
    origins: [],
    permissions: ['downloads', 'cookies'],
    managed: true, // pedido na janela do item e em Configurações → Mídia
  },
  systemInfo: {
    label: 'Widget Sistema pelo navegador (processador e memória)',
    why: 'Sem a NeuroTab Ponte, o widget Sistema mostra o uso do processador e da memória pelas interfaces do próprio navegador (Chrome e Edge). Nada sai do computador.',
    origins: [],
    permissions: ['system.cpu', 'system.memory'],
    managed: true, // pedido no widget
  },
  network: {
    label: 'Widget Rede (velocidade e DNS)',
    why: 'Mede a velocidade da internet e a latência baixando e enviando dados de teste para o servidor da Cloudflare, e compara a rapidez dos DNS seguros (Cloudflare, Google, Quad9, AdGuard, OpenDNS e NextDNS) com consultas a nomes comuns. Só quando você pede um teste ou liga o monitor; nenhum dado seu é enviado.',
    origins: ['https://speed.cloudflare.com/*', 'https://cloudflare-dns.com/*', 'https://dns.google/*', 'https://dns.quad9.net/*', 'https://dns.adguard-dns.com/*', 'https://doh.opendns.com/*', 'https://dns.nextdns.io/*'],
    managed: true, // pedido no widget
  },
  clipboardSites: {
    label: 'Área de transferência nos sites',
    why: 'Quando você liga "Ao copiar em sites" no widget Área de transferência, guarda neste computador o texto que você copia e o site de origem. Nada é enviado. Não funciona em janelas anônimas nem em campos de senha.',
    origins: ['https://*/*'],
    managed: true, // pedido no widget
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
export const DATA_TYPES = ['locationInfo', 'websiteContent', 'bookmarksInfo'];
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
export function requestAccess({ origins = [], permissions = [], data = [] } = {}) {
  const req = { origins, ...(permissions.length ? { permissions } : {}) };
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
