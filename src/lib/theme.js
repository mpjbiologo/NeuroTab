// NeuroTab — temas visuais (#51). As cores e fontes ficam em src/theme.css; aqui só a escolha.
export const THEMES = {
  futurista: { label: 'Futurista', desc: 'Noite índigo, ciano elétrico e letras geométricas.', bg: '#141a2e' },
  sobria: { label: 'Sóbria', desc: 'Grafite neutro e azul: limpo como um app de trabalho.', bg: '#1a1b1f' },
  calorosa: { label: 'Calorosa', desc: 'Carvão quente, âmbar e cantos suaves.', bg: '#231c17' },
};
export const DEFAULT_THEME = 'futurista';
export const themeOf = (settings) => (THEMES[settings?.theme] ? settings.theme : DEFAULT_THEME);

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
