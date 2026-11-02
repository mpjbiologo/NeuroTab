// NeuroTab — camada de dados compartilhada (nova aba, configurações e service worker).
// Tudo fica em chrome.storage.local (permissão unlimitedStorage).

export const DATA_KEY = 'nt_data';
export const BG_KEY = 'nt_bg';
export const ACTIVE_KEY = 'nt_active_group';
export const SCHEMA_VERSION = 1;

export const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  yandex: { name: 'Yandex', url: 'https://yandex.com/search/?text=' },
  perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=' },
};

export const DEFAULT_SETTINGS = {
  columns: 6,
  showSearch: false,
  searchEngine: 'google',
  showGroups: true,
  groupStyle: 'icon_text', // icon_text | icon | text
  barPosition: 'top', // top | bottom
  showContextMenu: true,
  showAddButtons: true,
  openInNewTab: false,
  bgEnabled: true,
  bgColor: '#141418',
  bgDim: 0, // 0–80 (%)
  tileRadius: 4,
};

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
    settings: { ...DEFAULT_SETTINGS },
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
    })),
    settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
  };
}

export async function loadData() {
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

// Favicon via API nativa do Chromium (permissão "favicon"), com fallback.
export function faviconUrl(pageUrl, size = 32) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

// Baixa o favicon, devolve { favicon: dataURL, color: '#rrggbb' } com a cor dominante.
// Funciona na página e no service worker (OffscreenCanvas).
export async function inspectFavicon(pageUrl) {
  const out = { favicon: '', color: PALETTE[Math.floor(Math.random() * PALETTE.length)] };
  try {
    const blob = await (await fetch(faviconUrl(pageUrl, 32))).blob();
    out.favicon = await blobToDataUrl(blob);
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
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
    console.warn('NeuroTab: favicon indisponível', e);
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
  const settings = { ...DEFAULT_SETTINGS };
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
    background: typeof o.bg === 'string' && o.bg.startsWith('data:image') ? o.bg : null,
  };
}

// Formato próprio de backup.
export function toBackup(data, background) {
  return { format: 'neurotab', version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data, background };
}

export function parseBackup(json) {
  if (json && json.format === 'neurotab') return { data: normalize(json.data), background: json.background || null };
  if (json && Array.isArray(json.categories) && Array.isArray(json.links)) return fromSpeedDialBackup(json);
  throw new Error('Arquivo não reconhecido. Use um backup da NeuroTab (.json) ou do Speed Dial (.spd).');
}
