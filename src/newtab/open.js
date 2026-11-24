// NeuroTab — Abrir endereços a partir da nova aba (#70): pesquisas na web em nova aba (opção, ligada por padrão);
// atalhos seguem "Abrir atalhos em nova aba".
import { S } from './state.js';

export function openUrl(url, { search = false } = {}) {
  const s = S.data.settings;
  const newTab = search ? s.searchNewTab !== false : !!s.openInNewTab;
  if (!newTab) { location.href = url; return; }
  if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url, active: true });
  else window.open(url, '_blank', 'noopener');
}
