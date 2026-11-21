// NeuroTab — temas visuais (#51) e ajustes do editor de aparência (#58).
// As cores e fontes ficam em src/theme.css; aqui só a escolha e as sobreposições (lib/look.js).
import { lookVars, sanitizeLook } from './look.js';

export const THEMES = {
  futurista: { label: 'Futurista', desc: 'Noite índigo, ciano elétrico e letras geométricas.', bg: '#141a2e' },
  sobria: { label: 'Sóbria', desc: 'Grafite neutro e azul: limpo como um app de trabalho.', bg: '#1a1b1f' },
  calorosa: { label: 'Calorosa', desc: 'Carvão quente, âmbar e cantos suaves.', bg: '#231c17' },
};
export const DEFAULT_THEME = 'futurista';
export const themeOf = (settings) => (THEMES[settings?.theme] ? settings.theme : DEFAULT_THEME);

const applied = new WeakMap(); // elemento → nomes das variáveis que pusemos nele

/** Aplica o tema na página e guarda para a próxima abertura (theme-boot.js). */
export function applyTheme(name, doc = document) {
  const t = THEMES[name] ? name : DEFAULT_THEME;
  doc.documentElement.dataset.theme = t;
  try { localStorage.setItem('nt_theme', t); } catch { /* sem localStorage */ }
  let meta = doc.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = doc.createElement('meta'); meta.name = 'theme-color'; doc.head.append(meta); }
  meta.content = THEMES[t].bg;
  return t;
}

/** Põe os tokens do editor num elemento (a página inteira ou só uma prévia). */
export function paintLook(el, look) {
  const L = sanitizeLook(look);
  const vars = lookVars(L);
  for (const k of applied.get(el) || []) if (!(k in vars)) el.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  applied.set(el, Object.keys(vars));
  el.dataset.wstyle = L.widgetStyle;
  return vars;
}

/** Tema + ajustes do editor, na página toda. Guarda tudo para o theme-boot.js evitar o piscar. */
export function applyLook(settings, doc = document) {
  const t = applyTheme(themeOf(settings), doc);
  const look = sanitizeLook(settings?.look);
  const vars = paintLook(doc.documentElement, look);
  if (look.bg) doc.querySelector('meta[name="theme-color"]').content = look.bg;
  try { localStorage.setItem('nt_look', JSON.stringify({ vars, wstyle: look.widgetStyle })); } catch { /* sem localStorage */ }
  return t;
}
