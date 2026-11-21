// NeuroTab — captura do que é copiado nos sites (nível 2 da área de transferência).
// Registrado só quando a pessoa liga essa opção e concede o acesso aos sites. Não roda em janelas anônimas.
// Não lê a área de transferência: pega o texto selecionado no momento do Ctrl+C / Copiar e o site de origem.
(() => {
  if (window.__ntClip) return;
  window.__ntClip = true;
  const SENSITIVE = /password|one-time-code|cc-number|cc-csc|cc-exp|new-password|current-password/i;
  const grab = (e) => {
    try {
      const el = document.activeElement;
      let text = '';
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        if (el.type === 'password' || SENSITIVE.test(el.autocomplete || '') || SENSITIVE.test(el.name || '') || SENSITIVE.test(el.id || '')) return;
        text = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
      } else {
        text = String(document.getSelection() || '');
      }
      if (!text.trim()) return; // botões "copiar" que escrevem direto: o nível 3 pega
      chrome.runtime.sendMessage({ type: 'clip:copy', text: text.slice(0, 100000), url: location.href, title: document.title, cut: e.type === 'cut' }).catch(() => {});
    } catch { /* a página continua normal */ }
  };
  document.addEventListener('copy', grab, true);
  document.addEventListener('cut', grab, true);
})();
