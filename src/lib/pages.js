// Várias páginas de widgets na nova aba (0.9.2.1, #75). Funções puras sobre as configurações.
//
// Modelo: `settings.widgets`, `layoutMode` e `freeFixed` são SEMPRE os da página aberta
// (assim todo o resto do código continua igual). `settings.pages` guarda as páginas
// ([{ id, name, icon, widgets, mode, freeFixed }]); o registro da página aberta pode estar
// desatualizado e é refeito ao trocar. `settings.page` = id da página aberta.
// Com `pages` vazio existe uma página só (como antes da 0.9.2.1).

export const DEFAULT_PAGES_NAV = {
  style: 'dots', // dots | tabs | arrows | hidden
  start: 'last', // last | first
  swipe: true, // deslizar no touchpad / tela de toque
  clockAll: true, // relógio em todas as páginas (false = só na primeira)
};
export const MAX_PAGES = 9;

const uid = () => 'pg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function sanitizePagesNav(n) {
  const s = { ...DEFAULT_PAGES_NAV, ...(n && typeof n === 'object' ? n : {}) };
  return {
    style: ['dots', 'tabs', 'arrows', 'hidden'].includes(s.style) ? s.style : 'dots',
    start: s.start === 'first' ? 'first' : 'last',
    swipe: s.swipe !== false,
    clockAll: s.clockAll !== false,
  };
}

// Devolve { pages, page } conferidos. Uma página só vira lista vazia.
export function sanitizePages(pages, page) {
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p && typeof p === 'object' && p.id).slice(0, MAX_PAGES).map((p, i) => ({
    id: str(p.id, 40), name: str(p.name, 30) || `Página ${i + 1}`, icon: str(p.icon, 8),
    widgets: Array.isArray(p.widgets) ? p.widgets.filter((w) => w && w.id).map((w) => ({ ...w })) : [],
    mode: ['free', 'auto'].includes(p.mode) ? p.mode : 'grid', freeFixed: p.freeFixed && typeof p.freeFixed === 'object' ? p.freeFixed : {},
  }));
  const ids = new Set();
  const uniq = list.filter((p) => (ids.has(p.id) ? false : ids.add(p.id)));
  if (uniq.length < 2) return { pages: [], page: '' };
  return { pages: uniq, page: uniq.some((p) => p.id === page) ? page : uniq[0].id };
}

export const hasPages = (s) => Array.isArray(s.pages) && s.pages.length > 1;
export const pageIndex = (s) => Math.max(0, (s.pages || []).findIndex((p) => p.id === s.page));
export const currentPage = (s) => (hasPages(s) ? s.pages[pageIndex(s)] : null);

const snapshot = (s) => ({ widgets: structuredClone(s.widgets || []), mode: ['free', 'auto'].includes(s.layoutMode) ? s.layoutMode : 'grid', freeFixed: structuredClone(s.freeFixed || {}) });

// Guarda a página aberta no registro dela (antes de trocar, criar ou mover).
export function storeLive(s) {
  if (!hasPages(s)) return s;
  const i = pageIndex(s);
  s.pages[i] = { ...s.pages[i], ...snapshot(s) };
  return s;
}

function load(s, page) {
  s.widgets = structuredClone(page.widgets || []);
  s.layoutMode = page.mode || 'grid';
  s.freeFixed = structuredClone(page.freeFixed || {});
  s.page = page.id;
  s.activeLayout = ''; // layouts salvos: o seletor volta para "atual" ao trocar de página
}

// Troca de página (por id, índice ou ±1). Muda `s` e devolve true se trocou.
export function switchPage(s, target) {
  if (!hasPages(s)) return false;
  const i = pageIndex(s);
  let j = typeof target === 'number' ? target : s.pages.findIndex((p) => p.id === target);
  if (target === 'next') j = (i + 1) % s.pages.length;
  if (target === 'prev') j = (i - 1 + s.pages.length) % s.pages.length;
  if (j < 0 || j >= s.pages.length || j === i) return false;
  storeLive(s);
  load(s, s.pages[j]);
  return true;
}

// Cria uma página (vazia) depois da última. Com uma página só, a atual vira a "Início".
export function addPage(s, { name = '', icon = '' } = {}) {
  if (!hasPages(s)) s.pages = [{ id: uid(), name: 'Início', icon: '🏠', ...snapshot(s) }];
  if (s.pages.length >= MAX_PAGES) return null;
  if (!s.page) s.page = s.pages[0].id;
  storeLive(s);
  const p = { id: uid(), name: str(name, 30) || `Página ${s.pages.length + 1}`, icon: str(icon, 8), widgets: [], mode: 'grid', freeFixed: {} };
  s.pages.push(p);
  return p;
}

export function renamePage(s, id, { name, icon } = {}) {
  const p = (s.pages || []).find((x) => x.id === id);
  if (!p) return false;
  if (name != null) p.name = str(name, 30) || p.name;
  if (icon != null) p.icon = str(icon, 8);
  return true;
}

// Muda a posição de uma página (dir = -1 / +1).
export function movePage(s, id, dir) {
  const i = (s.pages || []).findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= s.pages.length) return false;
  storeLive(s);
  [s.pages[i], s.pages[j]] = [s.pages[j], s.pages[i]];
  return true;
}

// Apaga uma página. keepWidgets: os widgets dela vão para a primeira página que sobrar.
// Sobrando uma só, volta a não ter páginas (tudo como antes).
export function removePage(s, id, { keepWidgets = true } = {}) {
  if (!hasPages(s)) return false;
  storeLive(s);
  const i = s.pages.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const [gone] = s.pages.splice(i, 1);
  const dest = s.pages[0];
  if (keepWidgets && gone.widgets.length) dest.widgets = [...dest.widgets, ...gone.widgets.map(({ fx, fy, fw, fh, ...w }) => w)];
  const live = s.pages.find((p) => p.id === s.page) || dest;
  load(s, live);
  if (s.pages.length < 2) { s.pages = []; s.page = ''; }
  return true;
}

// Move o widget (índice na página aberta) para outra página (vai para o fim dela).
export function moveWidgetToPage(s, idx, pageId) {
  if (!hasPages(s) || pageId === s.page) return false;
  const dest = s.pages.find((p) => p.id === pageId);
  const w = s.widgets[idx];
  if (!dest || !w) return false;
  s.widgets.splice(idx, 1);
  const { fx, fy, fw, fh, max, ...clean } = w; // posição do modo livre não serve na outra página
  storeLive(s);
  dest.widgets = [...dest.widgets, clean];
  return true;
}

// Página a abrir ao carregar a nova aba (start = 'first' volta para a primeira).
export function startPage(s) {
  if (!hasPages(s) || s.pagesNav?.start !== 'first' || pageIndex(s) === 0) return false;
  return switchPage(s, 0);
}

// Acha a página por nome falado ("trabalho", "página 2", "segunda").
const ORD = { primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6, setima: 7, oitava: 8, nona: 9, first: 1, second: 2, third: 3 };
export function findPage(s, text) {
  if (!hasPages(s)) return -1;
  const f = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const n = f.match(/\b(\d)\b/)?.[1] || Object.entries(ORD).find(([w]) => new RegExp(`\\b${w}\\b`).test(f))?.[1];
  if (n && +n <= s.pages.length) return +n - 1;
  return s.pages.findIndex((p) => p.name && f.includes(p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')));
}
