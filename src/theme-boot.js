// Aplica o tema salvo antes da página desenhar (evita piscar o tema padrão). Ver lib/theme.js.
try {
  const t = localStorage.getItem('nt_theme');
  if (t) document.documentElement.dataset.theme = t;
} catch { /* sem localStorage: fica o padrão */ }
