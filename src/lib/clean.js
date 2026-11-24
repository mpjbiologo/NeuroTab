// NeuroTab — Modo Clean (0.9.0, #69): tela limpa com data, relógio grande, barra do dia, busca e atalhos.
// Parte pura (opções, horas, barra do dia), testada em tests/unit/clean.test.js.

export const CLEAN_FONTS = {
  playfair: { label: 'Playfair Display (com serifa, embutida)', css: '"Playfair NT", "Playfair Display", Georgia, serif', weight: 700 },
  fraunces: { label: 'Fraunces (com serifa, embutida)', css: '"Fraunces NT", Georgia, serif', weight: 600 },
  georgia: { label: 'Georgia (com serifa, do sistema)', css: 'Georgia, "Times New Roman", serif', weight: 700 },
  serif: { label: 'Com serifa do sistema', css: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, serif', weight: 600 },
  inter: { label: 'Inter (sem serifa, embutida)', css: '"Inter NT", system-ui, sans-serif', weight: 300 },
  grotesk: { label: 'Space Grotesk (sem serifa, embutida)', css: '"Space Grotesk NT", system-ui, sans-serif', weight: 500 },
  system: { label: 'Sem serifa do sistema', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weight: 300 },
  mono: { label: 'Monoespaçada', css: 'ui-monospace, "Cascadia Mono", Consolas, monospace', weight: 500 },
};

export const DEFAULT_CLEAN = {
  on: false,
  links: 'icon_text', // icon_text | icon | none
  group: '', // id do grupo; vazio = o primeiro grupo
  count: 8, // 8 | 12 | 16 | 0 (todos)
  cols: 2, // 1 | 2 | 3
  font: 'playfair',
  h12: false,
  seconds: false,
  date: true,
  greet: true,
  dayBar: true,
  search: true,
  hint: true,
  blur: 'none', // none | soft | strong
  dim: 15, // 0–70 (%)
};

const pick = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, Math.round(+v))) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

export function sanitizeClean(c = {}) {
  const o = c && typeof c === 'object' ? c : {};
  const D = DEFAULT_CLEAN;
  return {
    on: bool(o.on, D.on),
    links: pick(o.links, ['icon_text', 'icon', 'none'], D.links),
    group: typeof o.group === 'string' ? o.group.slice(0, 40) : '',
    count: pick(+o.count, [0, 8, 12, 16], D.count),
    cols: num(o.cols, 1, 3, D.cols),
    font: Object.hasOwn(CLEAN_FONTS, o.font) ? o.font : D.font,
    h12: bool(o.h12, D.h12),
    seconds: bool(o.seconds, D.seconds),
    date: bool(o.date, D.date),
    greet: bool(o.greet, D.greet),
    dayBar: bool(o.dayBar, D.dayBar),
    search: bool(o.search, D.search),
    hint: bool(o.hint, D.hint),
    blur: pick(o.blur, ['none', 'soft', 'strong'], D.blur),
    dim: num(o.dim, 0, 70, D.dim),
  };
}

/** Quanto do dia já passou (0–1). */
export function dayProgress(d = new Date()) {
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
}

/** Partes do relógio: ['19', '31'] (+ segundos) e o sufixo AM/PM no modo 12 h. */
export function clockParts(d = new Date(), { h12 = false, seconds = false } = {}) {
  let h = d.getHours();
  let suffix = '';
  if (h12) { suffix = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; }
  const parts = [h12 ? String(h) : String(h).padStart(2, '0'), String(d.getMinutes()).padStart(2, '0')];
  if (seconds) parts.push(String(d.getSeconds()).padStart(2, '0'));
  return { parts, suffix };
}

/** "SEG · 23 NOV" no idioma da interface. */
export function dateLabel(d = new Date(), locale = 'pt-BR') {
  const wd = d.toLocaleDateString(locale, { weekday: 'short' }).replace(/\.$/, '');
  const mo = d.toLocaleDateString(locale, { month: 'short' }).replace(/\.$/, '');
  return `${wd} · ${d.getDate()} ${mo}`.toUpperCase();
}

/** Atalhos mostrados: do grupo escolhido (ou do primeiro), na ordem da NeuroTab, limitados pela quantidade. */
export function cleanLinks(data, c) {
  const groups = data.groups || [];
  const gid = groups.some((g) => g.id === c.group) ? c.group : groups[0]?.id;
  const list = (data.links || []).filter((l) => l.groupId === gid);
  return c.count ? list.slice(0, c.count) : list;
}
