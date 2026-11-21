// NeuroTab — editor visual da aparência (#58): valida o que a pessoa escolhe e traduz em tokens de src/theme.css.
// Nada aqui toca no DOM: lib/theme.js aplica. Um valor inválido nunca chega à página — volta ao do tema.

export const HEX = /^#[0-9a-f]{6}$/i;
export const COLOR_KEYS = ['accent', 'bg', 'surface', 'text', 'border'];
export const WIDGET_STYLES = { glass: 'Translúcido', solid: 'Sólido', outline: 'Contorno', minimal: 'Minimalista' };
export const SHADOWS = { theme: 'Do tema', none: 'Sem sombra', soft: 'Suave', strong: 'Forte' };
export const DENSITIES = { compact: 'Compacta', normal: 'Normal', cozy: 'Espaçosa' };

/** Tudo vazio = o tema escolhido, sem mudanças. */
export const DEFAULT_LOOK = {
  accent: '', bg: '', surface: '', text: '', border: '',
  opacity: null, // 20–100: transparência de painéis e widgets (null = do tema)
  radius: null, // 0–28 px: cantos médios (null = do tema)
  shadow: 'theme',
  density: 'normal',
  widgetStyle: 'glass',
};

/** Paletas prontas: um ponto de partida que a pessoa ainda pode ajustar. */
export const PALETTES = {
  oceano: { label: 'Oceano', base: 'futurista', look: { accent: '#38bdf8', bg: '#0b1d2a', surface: '#11293a', text: '#e6f4fb', border: '#7dd3fc' } },
  floresta: { label: 'Floresta', base: 'calorosa', look: { accent: '#6ee7a8', bg: '#0f1d16', surface: '#16291f', text: '#eaf6ee', border: '#86efac' } },
  ameixa: { label: 'Ameixa', base: 'futurista', look: { accent: '#f0abfc', bg: '#1d1224', surface: '#2a1a33', text: '#f8eefc', border: '#e9a8f5' } },
  lima: { label: 'Grafite e lima', base: 'sobria', look: { accent: '#c6f432', bg: '#151515', surface: '#1f1f1f', text: '#f2f2f2', border: '#d4d4d4', radius: 6 } },
  aurora: { label: 'Aurora', base: 'futurista', look: { accent: '#fb7185', bg: '#14142b', surface: '#1f1d3d', text: '#f5f3ff', border: '#a5b4fc', radius: 18, widgetStyle: 'glass' } },
};

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const numOrNull = (v, a, b) => (v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? null : clamp(Math.round(Number(v)), a, b));
const pick = (v, allowed, dflt) => (Object.hasOwn(allowed, v) ? v : dflt);

/** Limpa um objeto de aparência vindo do armazenamento, de um tema importado ou do formulário. */
export function sanitizeLook(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_LOOK };
  for (const k of COLOR_KEYS) out[k] = typeof r[k] === 'string' && HEX.test(r[k].trim()) ? r[k].trim().toLowerCase() : '';
  out.opacity = numOrNull(r.opacity, 20, 100);
  out.radius = numOrNull(r.radius, 0, 28);
  out.shadow = pick(r.shadow, SHADOWS, 'theme');
  out.density = pick(r.density, DENSITIES, 'normal');
  out.widgetStyle = pick(r.widgetStyle, WIDGET_STYLES, 'glass');
  return out;
}

export const isDefaultLook = (look) => JSON.stringify(sanitizeLook(look)) === JSON.stringify(DEFAULT_LOOK);

// ---------- cores ----------
export function hexToRgb(hex) {
  if (!HEX.test(hex || '')) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (rgb) => '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/** Luminância relativa (WCAG 2). */
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Contraste WCAG entre duas cores (hex ou [r,g,b]); 1 a 21. */
export function contrast(a, b) {
  const A = Array.isArray(a) ? a : hexToRgb(a);
  const B = Array.isArray(b) ? b : hexToRgb(b);
  if (!A || !B) return 21;
  const [l1, l2] = [luminance(A), luminance(B)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Texto legível por cima de uma cor: quase preto ou branco, o que contrastar mais. */
export function readableOn(hex, dark = '#111318', light = '#ffffff') {
  return contrast(hex, dark) >= contrast(hex, light) ? dark : light;
}
/** Mistura simples em sRGB (p = fração de a). */
export function mix(a, b, p = 0.5) {
  const A = hexToRgb(a); const B = hexToRgb(b);
  if (!A || !B) return a;
  return rgbToHex(A.map((v, i) => v * p + B[i] * (1 - p)));
}

const SHADOW_CSS = { none: 'none', soft: '0 6px 18px rgb(0 0 0 / .22)', strong: '0 16px 44px rgb(0 0 0 / .5)' };
const DENSITY = { compact: 0.7, cozy: 1.3 };

/** Tokens CSS para sobrepor ao tema (só os que a pessoa mudou). */
export function lookVars(raw) {
  const L = sanitizeLook(raw);
  const v = {};
  if (L.accent) {
    v['--accent'] = L.accent;
    v['--accent-text'] = mix(L.accent, '#ffffff', 0.82);
    v['--accent-soft'] = `color-mix(in oklch, ${L.accent} 16%, transparent)`;
    v['--on-accent'] = readableOn(L.accent);
    v['--active-glow'] = `0 6px 24px color-mix(in oklch, ${L.accent} 28%, transparent)`;
    v['--ring'] = `0 0 0 2px var(--bg), 0 0 0 4px ${L.accent}`;
  }
  if (L.bg) v['--bg'] = L.bg;
  if (L.surface) {
    v['--surface-solid'] = L.surface;
    v['--surface-strong'] = `color-mix(in oklch, ${L.surface} 94%, transparent)`;
    v['--field'] = `color-mix(in oklch, ${mix(L.surface, '#000000', 0.6)} 72%, transparent)`;
  }
  if (L.surface || L.opacity !== null) v['--surface'] = `color-mix(in oklch, var(--surface-solid) ${L.opacity ?? 74}%, transparent)`;
  if (L.text) {
    v['--text'] = L.text;
    v['--text-2'] = `color-mix(in oklch, ${L.text} 80%, var(--bg))`;
    v['--text-3'] = `color-mix(in oklch, ${L.text} 70%, var(--bg))`;
  }
  if (L.border) {
    v['--border'] = `color-mix(in oklch, ${L.border} 16%, transparent)`;
    v['--border-strong'] = `color-mix(in oklch, ${L.border} 34%, transparent)`;
    v['--tint-1'] = `color-mix(in oklch, ${L.border} 5%, transparent)`;
    v['--tint-2'] = `color-mix(in oklch, ${L.border} 9%, transparent)`;
    v['--tint-3'] = `color-mix(in oklch, ${L.border} 15%, transparent)`;
  }
  if (L.radius !== null) {
    v['--radius-sm'] = Math.round(L.radius * 0.66) + 'px';
    v['--radius-md'] = L.radius + 'px';
    v['--radius-lg'] = Math.round(L.radius * 1.4) + 'px';
  }
  if (SHADOW_CSS[L.shadow]) v['--shadow-card'] = SHADOW_CSS[L.shadow];
  if (DENSITY[L.density]) v['--dens'] = String(DENSITY[L.density]);
  return v;
}

/**
 * Avisos de legibilidade. `c` são as cores já resolvidas (hex) do resultado final:
 * { text, surface, bg, accent, onAccent }.
 */
export function lookWarnings(c) {
  const w = [];
  if (contrast(c.text, c.surface) < 4.5) w.push('O texto fica difícil de ler sobre os painéis.');
  if (contrast(c.text, c.bg) < 3) w.push('O texto quase some sobre o fundo.');
  if (contrast(c.accent, c.bg) < 1.8) w.push('A cor de destaque se confunde com o fundo.');
  if (c.onAccent && contrast(c.accent, c.onAccent) < 3) w.push('O texto dos botões fica fraco sobre a cor de destaque.');
  return w;
}

// ---------- temas salvos e arquivos ----------
export const MAX_THEMES = 30;

export function sanitizeTheme(t, themes = {}) {
  if (!t || typeof t !== 'object') return null;
  const name = String(t.name || '').trim().slice(0, 40);
  if (!name) return null;
  return {
    id: typeof t.id === 'string' && /^[\w-]{1,40}$/.test(t.id) ? t.id : 'u' + Math.random().toString(36).slice(2, 10),
    name,
    base: Object.hasOwn(themes, t.base) ? t.base : Object.keys(themes)[0] || 'futurista',
    look: sanitizeLook(t.look),
  };
}

export function themeFile({ name, base, look }) {
  return { format: 'neurotab-theme', v: 1, name: String(name || 'Meu tema').slice(0, 40), base, look: sanitizeLook(look) };
}

/** Lê um arquivo de tema (texto JSON). Lança erro com mensagem amigável se não servir. */
export function parseThemeFile(text, themes) {
  if (typeof text !== 'string' || text.length > 20000) throw new Error('Arquivo de tema inválido ou grande demais.');
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('Este arquivo não é um tema da NeuroTab (JSON inválido).'); }
  if (!j || j.format !== 'neurotab-theme') throw new Error('Este arquivo não é um tema da NeuroTab.');
  if (Number(j.v) > 1) throw new Error('Este tema foi feito numa versão mais nova da NeuroTab.');
  const t = sanitizeTheme({ name: j.name || 'Tema importado', base: j.base, look: j.look }, themes);
  if (!t) throw new Error('Tema sem nome.');
  return t;
}
