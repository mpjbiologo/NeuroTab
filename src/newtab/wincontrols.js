// NeuroTab — Controles de janela dos widgets (#18): minimizar, maximizar e restaurar.
// - Minimizar: o cartão fica só com o cabeçalho; continua montado (nada se perde) e o estado fica salvo.
// - Maximizar: o cartão ocupa a área útil da nova aba (sem cobrir a barra de atalhos nem os botões
//   flutuantes); Esc, o botão ou um clique fora restauram. Não fica salvo: ao recarregar, volta ao normal.
import { $, h } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { setWidget, repositionFree } from './free.js';
import { isFree } from './widgets.js';

let maxed = null; // { card, backdrop }

/** Botões ▁ e ⤢ do cabeçalho de um widget. */
export function windowButtons(card, w, idx) {
  const minBtn = h('button', { class: 'wwin-min', type: 'button' });
  const maxBtn = h('button', { class: 'wwin-max', type: 'button' });
  const paint = () => {
    const min = card.classList.contains('minimized');
    const max = card.classList.contains('maximized');
    minBtn.textContent = min ? '▭' : '▁';
    minBtn.title = t(min ? 'Restaurar' : 'Minimizar');
    minBtn.setAttribute('aria-pressed', String(min));
    maxBtn.textContent = max ? '❐' : '⤢';
    maxBtn.title = t(max ? 'Restaurar' : 'Maximizar');
    maxBtn.setAttribute('aria-pressed', String(max));
  };
  minBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMin(card, idx).then(paint); });
  maxBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMax(card); paint(); });
  card.addEventListener('nt-window', paint);
  if (w.min) card.classList.add('minimized');
  paint();
  return h('div', { class: 'wwin' }, minBtn, maxBtn);
}

async function toggleMin(card, idx) {
  if (card.classList.contains('maximized')) restoreMax();
  const min = !card.classList.contains('minimized');
  card.classList.toggle('minimized', min);
  await setWidget(idx, { min: min || null }, true);
  if (isFree()) repositionFree();
}

/** Área útil para o widget maximizado: a área central, descontando barra de atalhos e botões flutuantes. */
function usableInset() {
  const c = $('#center').getBoundingClientRect();
  const cs = getComputedStyle($('#center'));
  const narrow = document.body.classList.contains('narrow');
  const m = narrow ? 8 : 16;
  const fab = document.body.classList.contains('has-fab') && !narrow ? 86 : 0;
  const top = m + (document.body.classList.contains('dock-top') ? 52 : 0);
  const bottom = m + (document.body.classList.contains('dock-bottom') || narrow ? 60 : 0);
  const left = Math.max(m, c.left + (narrow ? 0 : parseFloat(cs.paddingLeft) || 0));
  const right = Math.max(m, fab, innerWidth - c.right + (narrow ? 0 : parseFloat(cs.paddingRight) || 0));
  return { top, right, bottom, left };
}

function toggleMax(card) {
  if (card.classList.contains('maximized')) { restoreMax(); return; }
  restoreMax();
  card.classList.remove('minimized');
  const box = usableInset();
  for (const [k, v] of Object.entries(box)) card.style.setProperty(`--mx-${k}`, `${Math.round(v)}px`);
  const backdrop = h('div', { class: 'wmax-backdrop', onclick: () => restoreMax() });
  card.before(backdrop);
  card.classList.add('maximized');
  maxed = { card, backdrop };
  card.querySelector('.wwin-max')?.focus();
}

/** Volta o widget maximizado ao tamanho e posição de antes. */
export function restoreMax() {
  if (!maxed) return;
  const { card, backdrop } = maxed;
  maxed = null;
  backdrop.remove();
  card.classList.remove('maximized');
  for (const k of ['top', 'right', 'bottom', 'left']) card.style.removeProperty(`--mx-${k}`);
  if (card.isConnected) card.dispatchEvent(new Event('nt-window'));
}

export const isMaximized = () => !!maxed;

export function setupWindowControls() {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && maxed) { e.stopPropagation(); restoreMax(); } }, true);
  window.addEventListener('resize', () => {
    if (!maxed) return;
    const box = usableInset();
    for (const [k, v] of Object.entries(box)) maxed.card.style.setProperty(`--mx-${k}`, `${Math.round(v)}px`);
  });
}
