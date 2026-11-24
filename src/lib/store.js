// NeuroTab — camada de dados compartilhada (nova aba, configurações e service worker).
// Tudo fica em chrome.storage.local (permissão unlimitedStorage).
import { migrateIfNeeded, normalizeItems, CURRENT_SCHEMA } from './migrations.js';
import { DEFAULT_LOOK, sanitizeLook, sanitizeTheme, MAX_THEMES } from './look.js';
import { DEFAULT_TILES, sanitizeTiles, cleanIcon, SHAPES } from './tiles.js';
import { DEFAULT_CLEAN, sanitizeClean } from './clean.js';
import { DEFAULT_FINANCE, sanitizeFinancePrefs } from './finance/prefs.js';
import { DEFAULT_DATAHUB, DEFAULT_WATCH, sanitizeDatahub, sanitizeWatch } from './datahub/prefs.js';
import { DEFAULT_MENU, sanitizeMenu } from './menu-actions.js';
import { THEMES as THEME_IDS } from './theme.js';
import { DEFAULT_NET, sanitizeNet } from './net.js';
import { DEFAULT_MEDIA_SAVE, sanitizeMediaSave } from './media.js';
import { DEFAULT_MEDIA_DL, sanitizeMediaDl } from './media-download.js';
import { DEFAULT_AI, sanitizeAi } from './ai/config.js';
import { DEFAULT_SYS, sanitizeSys } from './sysinfo.js';

export const DATA_KEY = 'nt_data';
export const BG_KEY = 'nt_bg';
export const ACTIVE_KEY = 'nt_active_group';
export const BRAIN_KEY = 'nt_brain';
export const TRASH_KEY = 'nt_trash';
export const SCHEMA_VERSION = 1;

export const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  yandex: { name: 'Yandex', url: 'https://yandex.com/search/?text=' },
  perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=' },
};

export const DEFAULT_WIDGETS = [
  { id: 'capture', w: 6 },
  { id: 'reminders', w: 6 },
  { id: 'brain', w: 6 },
  { id: 'ask', w: 6 },
  { id: 'clock', w: 4 },
  { id: 'quotes', w: 4 },
];

const SIZE_TO_W = { s: 4, m: 6, l: 12 };
export function normalizeWidgets(list) {
  return (Array.isArray(list) ? list : DEFAULT_WIDGETS).map((w) => {
    const out = { ...w, w: Math.max(3, Math.min(12, w.w || SIZE_TO_W[w.size] || 6)) };
    delete out.size;
    return out;
  });
}

export { DEFAULT_AI };

export const DEFAULT_SETTINGS = {
  // Layout
  dockPosition: 'left', // left | right | top | bottom
  dockPinned: false,
  dockMode: 'always', // always | auto (esconde e volta ao chegar perto da borda) | collapsed (alça para abrir) (#64)
  dockHideDelay: 0.6, // segundos até esconder de novo
  widgets: DEFAULT_WIDGETS,
  showClock: true,
  userName: '',
  lang: 'auto', // auto | pt-BR | en | es
  // Atalhos
  columns: 6,
  showSearch: true,
  searchEngine: 'google',
  imageOcr: true, // ler o texto das imagens da biblioteca, no próprio computador
  searchEnter: 'web', // o que o Enter faz na barra de pesquisa: web | first | ask | note | task
  showGroups: true,
  groupStyle: 'icon_text', // icon_text | icon | text
  barPosition: 'top', // top | bottom
  showContextMenu: true,
  showAddButtons: true,
  openInNewTab: false,
  searchNewTab: true, // pesquisas na web abrem em nova aba (#70)
  bgEnabled: true,
  theme: 'futurista', // futurista | sobria | calorosa (src/theme.css)
  bgColor: '#141418',
  bgDim: 0, // 0–80 (%)
  bgMode: 'image', // image | slides
  slideSource: 'local', // local | bing | nasa | all
  slideInterval: 5, // minutos
  tileRadius: 4,
  iconSource: 'browser', // de onde vêm os ícones dos atalhos: browser | google | duckduckgo (precisa da permissão)
  clean: DEFAULT_CLEAN, // Modo Clean (0.9.0, #69)
  finance: DEFAULT_FINANCE, // Finanças (0.9.1, #66): só as preferências; os dados ficam em nt_finance, neste computador
  menu: DEFAULT_MENU, // botão direito (0.9.0, #55): { order, hidden, fav }
  menuCloudOk: [], // serviços de IA na internet que a pessoa liberou para as ações do botão direito
  tiles: DEFAULT_TILES, // formato, tamanho e cores dos blocos de atalho (#59)
  look: DEFAULT_LOOK, // ajustes do editor visual por cima do tema (#58)
  customThemes: [], // [{ id, name, base, look }] temas salvos pela pessoa
  mediaDl: DEFAULT_MEDIA_DL, // baixar o vídeo dos itens de Mídia (0.7.11)
  mediaSave: DEFAULT_MEDIA_SAVE, // "Salvar no cérebro com resumo": categorias, IA na internet, imagens (#67)
  net: DEFAULT_NET,
  system: DEFAULT_SYS, // widget Sistema: o que mostrar, °C/°F, intervalo, alertas, LibreHardwareMonitor (0.7.10) // widget Rede: servidor, tamanho do teste, DNS comparados, monitor de travadas (#52)
  // Widgets
  weather: null, // (antigo) { name, lat, lon } — migrado para places
  places: [], // [{ id, name, region, lat, lon, tz }] — o primeiro é a cidade principal
  heroWeather: true, // clima junto do relógio
  heroPlaces: true, // outras cidades/fusos abaixo do relógio
  mapPlaces: [], // [{ id, name, icon, address, lat, lon }]
  mapRoutes: [], // [{ id, from: placeId | 'here', to: placeId, mode, name }]
  quoteCurrencies: 'USD-BRL,EUR-BRL,BTC-BRL',
  quoteStocks: 'PETR4,VALE3,ITUB4',
  brapiToken: '', // (antigo) migrado para nt_datahub_keys na 0.9.2 — não sincroniza mais
  watch: DEFAULT_WATCH, // lista de acompanhamento do widget Cotações (0.9.2, #71)
  datahub: DEFAULT_DATAHUB, // fontes de dados: ligadas, ordem, limites, clima, alertas
  shortcutsWidgetGroup: '',
  // IA e voz
  ai: DEFAULT_AI,
  voiceLang: '', // vazio = idioma da interface
  assistantName: 'NeuroTab', // nome do assistente (#15)
  wakeWord: false, // palavra de ativação (experimental)
  wakePhrase: 'NeuroTab', // frase de ativação; vazia = o nome do assistente
  wakeBeep: true, // sinal sonoro curto ao ouvir a frase
  wakeCommandSecs: 8, // tempo para falar o comando depois da frase
  voiceEngine: 'auto', // auto | device (no computador) | whisper (servidor local) | cloud (serviço do navegador)
  voiceLocalOnly: false, // a voz nunca vai para a nuvem (reconhecimento e leitura)
  whisperUrl: '', // ex.: http://127.0.0.1:8080/inference (whisper.cpp)
  whisperModel: '',
  wakeMinutes: 10, // desliga sozinha após X min sem ser chamada
  speakAnswers: false,
  // Conversa por voz (0.8.2, #40) e visual (#39)
  voiceConversation: true, // chamado pela palavra de ativação, continua ouvindo até o silêncio
  voiceGreet: true, // responde falando ao ser chamado
  voiceGreeting: '', // frase própria com {nome}; vazia = padrão do idioma
  voiceGreetVoice: '', // voz da saudação (#70); vazia = a mesma das respostas
  voiceGreetAlways: false, // cumprimenta mesmo quando o pedido vem junto com a palavra de ativação
  voiceSilenceSecs: 60, // encerra a conversa após X segundos sem ninguém falar
  voiceConvButton: false, // o botão 🎙 / Alt+M também abre a conversa (senão, um pedido só)
  voiceViz: 'orb', // orb | bars | line | particles | classic
  voiceVizMic: true, // as ondas seguem o volume do microfone
  // Modo conversa (0.8.3, #44)
  voiceModeButtons: true, // mostra 💬 e 📋 perto do microfone
  voiceChatIdleMin: 10, // desliga sozinho após X minutos sem ninguém falar
  voiceChatBargeIn: false, // falar por cima interrompe a resposta (pode confundir com caixa de som)
  voiceChatNoticed: false, // já viu o aviso de custo e privacidade
  // Modo reunião (0.8.3, #41)
  meetingSource: 'mic', // mic (presencial) | tab (online: microfone + áudio da aba)
  meetingKeepAudio: false, // guarda o áudio além da transcrição
  meetingConsentSkip: false, // não mostrar de novo o aviso de consentimento
  meetingPinTab: true, // a aba da reunião abre fixada
  meetingAudioDays: 0, // apagar áudios de reuniões com mais de X dias (0 = nunca)
  storageAutoCaches: false, // Armazenamento (0.8.3, #68): limpar caches com mais de 30 dias
  ttsVoice: '',
  ttsRate: 1,
  ttsPitch: 1,
  // Relógio
  timerSound: 'sino',
  // Layouts salvos
  layoutMode: 'grid', // grid | free
  freeFixed: {}, // posições do relógio e da busca no modo livre
  layouts: [], // [{ id, name, widgets, mode, freeFixed }]
  activeLayout: '',
  // Atualizações
  checkUpdates: true,
};

// Aba "Mídia" das configurações: análise de imagens (e, no futuro, vídeos e áudios).
export const DEFAULT_MEDIA = {
  save: 'ask', // ao analisar uma imagem do botão direito: 'auto' guarda na biblioteca, 'ask' pergunta, 'never' só guarda se pedir
  provider: '', // IA para imagens ('' = a mesma da aba IA); usa a chave daquele provedor
};

export function mergeSettings(s = {}) {
  if (!Array.isArray(s.places) || (!s.places.length && s.weather)) {
    s = { ...s, places: s.weather ? [{ id: 'home', name: s.weather.name, region: s.weather.region || '', lat: s.weather.lat, lon: s.weather.lon, tz: null }] : [] };
  }
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    widgets: normalizeWidgets(s.widgets),
    layouts: Array.isArray(s.layouts) ? s.layouts.map((l) => ({ ...l, widgets: normalizeWidgets(l.widgets) })) : [],
    media: { ...DEFAULT_MEDIA, ...(s.media || {}) },
    tiles: sanitizeTiles(s.tiles),
    clean: sanitizeClean(s.clean),
    finance: sanitizeFinancePrefs(s.finance),
    datahub: sanitizeDatahub(s.datahub),
    watch: sanitizeWatch(s.watch, s),
    menu: sanitizeMenu(s.menu),
    menuCloudOk: Array.isArray(s.menuCloudOk) ? s.menuCloudOk.filter((x) => typeof x === 'string').slice(0, 20) : [],
    look: sanitizeLook(s.look),
    net: sanitizeNet(s.net),
    mediaSave: sanitizeMediaSave(s.mediaSave),
    mediaDl: sanitizeMediaDl(s.mediaDl),
    system: sanitizeSys(s.system),
    customThemes: Array.isArray(s.customThemes) ? s.customThemes.map((t) => sanitizeTheme(t, THEME_IDS)).filter(Boolean).slice(0, MAX_THEMES) : [],
    dockMode: ['always', 'auto', 'collapsed'].includes(s.dockMode) ? s.dockMode : 'always',
    iconSource: ['browser', 'google', 'duckduckgo'].includes(s.iconSource) ? s.iconSource : 'browser',
    ai: sanitizeAi(s.ai, s.media), // central de IA (0.8.0): migra a configuração antiga sozinha
  };
}

// Cores de bloco usadas quando não dá para extrair a cor do favicon.
export const PALETTE = [
  '#48ce70', '#4267b2', '#e5e4e2', '#b9a77f', '#3fa0a8', '#a7a9d6',
  '#3d7d45', '#5a8ff0', '#f4473b', '#c2234a', '#203f7f', '#2d2d2d',
  '#2f86d6', '#e3a3bd', '#1da1f2', '#d39a64', '#c3161c', '#8bb35b',
  '#2a7ff6', '#9a7cf0', '#7a4e93', '#36a9e1', '#4b4b4b', '#26f0a0',
];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function defaultData() {
  const g = { id: uid(), name: 'Principal', icon: '🏠' };
  const mk = (title, url, color) => ({ id: uid(), groupId: g.id, title, url, color, favicon: '' });
  return {
    version: SCHEMA_VERSION,
    groups: [g],
    links: [
      mk('Google', 'https://www.google.com/', '#b9a77f'),
      mk('YouTube', 'https://www.youtube.com/', '#f4473b'),
      mk('Gmail', 'https://mail.google.com/', '#e5e4e2'),
      mk('WhatsApp Web', 'https://web.whatsapp.com/', '#48ce70'),
      mk('GitHub', 'https://github.com/', '#2d2d2d'),
      mk('NeuroTab', 'https://github.com/mpjbiologo/NeuroTab', '#7a4e93'),
    ],
    settings: mergeSettings(),
  };
}

export function normalize(d) {
  if (!d || !Array.isArray(d.groups) || !d.groups.length) return defaultData();
  return {
    version: SCHEMA_VERSION,
    groups: d.groups.map((g) => ({ id: String(g.id), name: g.name || 'Grupo', icon: g.icon || '📁' })),
    links: (d.links || []).map((l) => ({
      id: String(l.id || uid()),
      groupId: String(l.groupId),
      title: l.title || hostOf(l.url),
      url: l.url,
      color: l.color || PALETTE[0],
      favicon: l.favicon || '',
      ...(cleanIcon(l.icon) ? { icon: cleanIcon(l.icon) } : {}),
      ...(SHAPES[l.shape] ? { shape: l.shape } : {}),
    })),
    settings: mergeSettings(d.settings),
  };
}

export async function loadData() {
  await migrateIfNeeded();
  const r = await chrome.storage.local.get(DATA_KEY);
  const data = normalize(r[DATA_KEY]);
  if (!r[DATA_KEY]) await saveData(data);
  return data;
}

export async function saveData(data) {
  await chrome.storage.local.set({ [DATA_KEY]: data });
}

export async function loadBg() {
  const r = await chrome.storage.local.get(BG_KEY);
  return r[BG_KEY] || null;
}

export async function saveBg(dataUrl) {
  if (dataUrl) await chrome.storage.local.set({ [BG_KEY]: dataUrl });
  else await chrome.storage.local.remove(BG_KEY);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

export function normalizeUrl(raw) {
  let u = (raw || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  return u;
}

// Favicon via API nativa do Chromium (permissão "favicon"). No Firefox, usa o serviço do DuckDuckGo.
const HAS_FAVICON_API = (() => {
  try { return (chrome.runtime.getManifest().permissions || []).includes('favicon'); } catch { return false; }
})();

export function faviconUrl(pageUrl, size = 32) {
  if (!HAS_FAVICON_API) {
    try { return `https://icons.duckduckgo.com/ip3/${new URL(pageUrl).hostname}.ico`; } catch { return ''; }
  }
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

// ---------- Ícones dos sites em boa resolução ----------
// Fontes, da mais privada para a mais completa. O navegador só guarda 16–32 px da maioria dos sites;
// o serviço de ícones do Google entrega até 256 px (só o endereço do site vai para lá) e o DuckDuckGo, o .ico do site.
export const ICON_SOURCES = {
  browser: { label: 'Só o navegador (pode ficar borrado)', origins: [] },
  google: { label: 'Google — alta resolução', origins: ['https://t1.gstatic.com/*'] },
  duckduckgo: { label: 'DuckDuckGo', origins: ['https://icons.duckduckgo.com/*'] },
};
export const ICON_SIZE = 96; // guardado em 96×96: nítido até o maior bloco em tela de alta densidade

export function iconCandidates(pageUrl, source = 'browser') {
  let u;
  try { u = new URL(pageUrl); } catch { return []; }
  const out = [];
  if (source === 'google') out.push(`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(u.origin)}&size=128`);
  if (source === 'duckduckgo' || !HAS_FAVICON_API) out.push(`https://icons.duckduckgo.com/ip3/${u.hostname}.ico`);
  if (HAS_FAVICON_API) out.push(faviconUrl(pageUrl, 128), faviconUrl(pageUrl, 32));
  return out;
}

async function iconSource() {
  try {
    const src = (await chrome.storage.local.get(DATA_KEY))[DATA_KEY]?.settings?.iconSource;
    if (!ICON_SOURCES[src] || src === 'browser') return 'browser';
    const ok = await chrome.permissions.contains({ origins: ICON_SOURCES[src].origins });
    return ok ? src : 'browser';
  } catch { return 'browser'; }
}

/** Baixa as fontes em ordem e fica com a maior imagem (para na primeira com 96 px ou mais). */
export async function bestIcon(pageUrl, source) {
  let best = null;
  for (const url of iconCandidates(pageUrl, source ?? (await iconSource()))) {
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) continue;
      const bmp = await createImageBitmap(await r.blob());
      const side = Math.min(bmp.width, bmp.height);
      if (side < 8) continue;
      if (!best || side > best.side) best = { bmp, side };
      if (side >= ICON_SIZE) break;
    } catch { /* tenta a próxima fonte */ }
  }
  return best?.bmp || null;
}

// Baixa o favicon, devolve { favicon: dataURL (até 96×96 PNG), color: '#rrggbb' } com a cor dominante.
// Funciona na página e no service worker (OffscreenCanvas).
export async function inspectFavicon(pageUrl, { source } = {}) {
  const out = { favicon: '', color: PALETTE[Math.floor(Math.random() * PALETTE.length)] };
  try {
    const bmp = await bestIcon(pageUrl, source);
    if (!bmp) throw new Error('sem ícone');
    const side = Math.min(ICON_SIZE, Math.max(bmp.width, bmp.height));
    const k = side / Math.max(bmp.width, bmp.height);
    const c = new OffscreenCanvas(side, side);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, (side - bmp.width * k) / 2, (side - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
    out.favicon = await blobToDataUrl(await c.convertToBlob({ type: 'image/png' }));
    const px = ctx.getImageData(0, 0, side, side).data;
    let r = 0, g = 0, b = 0, w = 0, satSum = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3] / 255;
      if (a < 0.5) continue;
      const max = Math.max(px[i], px[i + 1], px[i + 2]);
      const min = Math.min(px[i], px[i + 1], px[i + 2]);
      const sat = max === 0 ? 0 : (max - min) / max;
      satSum += sat; n++;
      const weight = 0.15 + sat * 2; // privilegia pixels coloridos
      r += px[i] * weight; g += px[i + 1] * weight; b += px[i + 2] * weight; w += weight;
    }
    // Ícone sem cor (ex.: globo padrão) → mantém uma cor da paleta.
    if (w > 0 && satSum / n > 0.12) out.color = rgbToHex(r / w, g / w, b / w);
  } catch (e) {
    console.warn('NeuroTab: favicon indisponível', e?.message || e);
  }
  return out;
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function cssColorToHex(c) {
  if (!c) return PALETTE[0];
  if (c.startsWith('#')) return c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c.slice(0, 7);
  const m = c.match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m ? rgbToHex(+m[1], +m[2], +m[3]) : PALETTE[0];
}

// Ícones Font Awesome do Speed Dial antigo → emoji.
const FA_TO_EMOJI = {
  home: '🏠', rocket: '🚀', 'graduation-cap': '🎓', dollar: '💲', folder: '📁', star: '⭐',
  'share-alt': '🔗', 'level-down': '🤖', gamepad: '🎮', book: '📚', heart: '❤️', music: '🎵',
  film: '🎬', briefcase: '💼', code: '💻', 'shopping-cart': '🛒', globe: '🌐', user: '👤',
  cog: '⚙️', camera: '📷', newspaper: '📰', 'newspaper-o': '📰', bookmark: '🔖', cloud: '☁️',
};

// Importa o backup .spd da extensão "Speed Dial" (Chrome Web Store).
export function fromSpeedDialBackup(spd) {
  const groups = (spd.categories || []).map((c) => ({
    id: String(c.id),
    name: c.name,
    icon: FA_TO_EMOJI[c.icon] || '📁',
  }));
  if (!groups.length) groups.push({ id: '1', name: 'Principal', icon: '🏠' });
  const known = new Set(groups.map((g) => g.id));
  const links = (spd.links || [])
    .filter((l) => l.url)
    .map((l) => ({
      id: 'spd' + l.id,
      groupId: known.has(String(l.category)) ? String(l.category) : groups[0].id,
      title: l.title || hostOf(l.url),
      url: l.url,
      color: cssColorToHex(l.bgColor),
      favicon: typeof l.favicon === 'string' && l.favicon.startsWith('data:') ? l.favicon : '',
    }));
  const o = spd.opts || {};
  const settings = mergeSettings();
  const cols = parseInt(String(o.col_in_row || '').replace(/\D/g, ''), 10);
  if (cols >= 2 && cols <= 12) settings.columns = cols;
  if (typeof o.search_status === 'boolean') settings.showSearch = o.search_status;
  if (o.search && SEARCH_ENGINES[o.search]) settings.searchEngine = o.search;
  if (typeof o.group_status === 'boolean') settings.showGroups = o.group_status;
  if (o.group_style) settings.groupStyle = { i_t: 'icon_text', i: 'icon', t: 'text' }[o.group_style] || 'icon_text';
  if (o.group_pos) settings.barPosition = o.group_pos === 'bottom' ? 'bottom' : 'top';
  if (typeof o.show_context_btn === 'boolean') settings.showContextMenu = o.show_context_btn;
  if (typeof o.show_plus_btn === 'boolean') settings.showAddButtons = o.show_plus_btn;
  if (typeof o.bg_img_status === 'boolean') settings.bgEnabled = o.bg_img_status;
  return {
    data: normalize({ groups, links, settings }),
    brain: [],
    background: typeof o.bg === 'string' && o.bg.startsWith('data:image') ? o.bg : null,
  };
}

// Formato próprio de backup. Por padrão, chaves de API e tokens NÃO são exportados.
// `secrets` (opcional) já vem pronto: { protected: true, ...caixa criptografada } ou { protected: false, value }.
export function toBackup(data, background, brain, secrets = null) {
  const clean = structuredClone(data);
  clean.settings.ai = { ...clean.settings.ai, keys: {} };
  clean.settings.brapiToken = '';
  const out = { format: 'neurotab', version: SCHEMA_VERSION, schema: CURRENT_SCHEMA, exportedAt: new Date().toISOString(), data: clean, background, brain: brain || [] };
  if (secrets) out.secrets = secrets;
  return out;
}

/** Segredos que podem ir no backup (chaves de IA e token da brapi). */
export function collectSecrets(settings) {
  const keys = Object.fromEntries(Object.entries(settings.ai?.keys || {}).filter(([, v]) => v));
  return { aiKeys: keys, brapiToken: settings.brapiToken || '' };
}

/** Aplica segredos importados. overwrite=false só preenche o que estiver vazio. */
export function applySecrets(settings, secrets, overwrite = true) {
  if (!secrets) return 0;
  settings.ai = settings.ai || {};
  settings.ai.keys = settings.ai.keys || {};
  let n = 0;
  for (const [k, v] of Object.entries(secrets.aiKeys || {})) {
    if (v && (overwrite || !settings.ai.keys[k])) { settings.ai.keys[k] = v; n++; }
  }
  if (secrets.brapiToken && (overwrite || !settings.brapiToken)) { settings.brapiToken = secrets.brapiToken; n++; }
  return n;
}

export function parseBackup(json) {
  if (json && json.format === 'neurotab') {
    if (Number(json.schema) > CURRENT_SCHEMA) throw new Error('Este backup foi criado por uma versão mais nova da NeuroTab. Atualize a extensão antes de importar.');
    return { data: normalize(json.data), background: json.background || null, brain: normalizeItems(json.brain), secrets: json.secrets && typeof json.secrets === 'object' ? json.secrets : null };
  }
  if (json && Array.isArray(json.categories) && Array.isArray(json.links)) return fromSpeedDialBackup(json);
  throw new Error('Arquivo não reconhecido. Use um backup da NeuroTab (.json) ou do Speed Dial (.spd).');
}
