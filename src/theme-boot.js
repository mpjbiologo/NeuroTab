// Aplica o tema salvo antes da página desenhar (evita piscar o tema padrão). Ver lib/theme.js.
try {
  const root = document.documentElement;
  const t = localStorage.getItem('nt_theme');
  if (t) root.dataset.theme = t;
  // Ajustes do editor de aparência (#58). options.html#reset-tema ignora tudo e volta ao padrão.
  if (location.hash === '#reset-tema') localStorage.removeItem('nt_look');
  const look = JSON.parse(localStorage.getItem('nt_look') || 'null');
  if (look && look.vars && typeof look.vars === 'object') {
    for (const [k, v] of Object.entries(look.vars)) if (/^--[\w-]+$/.test(k) && typeof v === 'string') root.style.setProperty(k, v);
    if (typeof look.wstyle === 'string') root.dataset.wstyle = look.wstyle;
  }
} catch { /* sem localStorage: fica o padrão */ }
