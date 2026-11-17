// NeuroTab — Controles de janela dos widgets (#18): minimizar, maximizar e restaurar.
// - Minimizar: o cartão fica só com o cabeçalho; continua montado (nada se perde) e o estado fica salvo.
// - Maximizar: o cartão ocupa a área útil da nova aba (sem cobrir a barra de atalhos nem os botões
//   flutuantes); Esc, o botão ou um clique fora restauram. Fica salvo (w.max): numa aba nova ou depois de
//   reabrir o navegador, o widget volta maximizado. Só um widget fica maximizado de cada vez.
import { $, h } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { setWidget, repositionFree } from './free.js';
import { isFree } from './widgets.js';
import { onEscape } from '../lib/window-manager.js';
import { S } from './state.js';

let maxed = null; // { card, backdrop, idx }

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
  maxBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMax(card, idx); paint(); });
  card.addEventListener('nt-window', paint);
  if (w.min && !w.max) card.classList.add('minimized');
  // Estado salvo: maximiza depois que o cartão entra na página e a grade/tela livre se acomoda.
  if (w.max) requestAnimationFrame(() => { if (card.isConnected && !maxed) { toggleMax(card, idx, { save: false }); paint(); } });
  paint();
  return h('div', { class: 'wwin' }, minBtn, maxBtn);
}

async function toggleMin(card, idx) {
  const wasMax = card.classList.contains('maximized');
  if (wasMax) restoreMax({ save: false });
  const min = !card.classList.contains('minimized');
  card.classList.toggle('minimized', min);
  await setWidget(idx, { min: min || null, ...(wasMax ? { max: null } : {}) }, true);
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

function toggleMax(card, idx, { save = true } = {}) {
  if (card.classList.contains('maximized')) { restoreMax(); return; }
  const prev = maxed?.idx;
  restoreMax({ save: false });
  const wasMin = card.classList.contains('minimized');
  card.classList.remove('minimized');
  const box = usableInset();
  for (const [k, v] of Object.entries(box)) card.style.setProperty(`--mx-${k}`, `${Math.round(v)}px`);
  const backdrop = h('div', { class: 'wmax-backdrop', onclick: () => restoreMax() });
  card.before(backdrop);
  card.classList.add('maximized');
  maxed = { card, backdrop, idx };
  if (save) card.querySelector('.wwin-max')?.focus({ preventScroll: true }); // ao abrir a aba, o foco fica na busca
  if (save && idx != null) saveMax(idx, prev, wasMin);
}

/** Guarda qual widget está maximizado (e tira a marca do anterior), sem redesenhar a tela. */
async function saveMax(idx, prev, wasMin) {
  const ws = S.data.settings.widgets;
  if (prev != null && prev !== idx && ws[prev]) delete ws[prev].max;
  for (const [i, w] of ws.entries()) if (i !== idx && w.max) delete w.max;
  await setWidget(idx, { max: true, ...(wasMin ? { min: null } : {}) }, true);
}

/**
 * Volta o widget maximizado ao tamanho e posição de antes. save:false só desfaz na tela (o cartão vai ser
 * redesenhado e volta maximizado); o padrão também apaga o estado salvo.
 */
export function restoreMax({ save = true } = {}) {
  if (!maxed) return;
  const { card, backdrop, idx } = maxed;
  maxed = null;
  if (save && idx != null && S.data.settings.widgets[idx]?.max) setWidget(idx, { max: null }, true);
  backdrop.remove();
  card.classList.remove('maximized');
  for (const k of ['top', 'right', 'bottom', 'left']) card.style.removeProperty(`--mx-${k}`);
  if (card.isConnected) card.dispatchEvent(new Event('nt-window'));
}

export const isMaximized = () => !!maxed;

export function setupWindowControls() {
  onEscape({ layer: 'maximized', isOpen: () => !!maxed, close: () => restoreMax() });
  window.addEventListener('resize', () => {
    if (!maxed) return;
    const box = usableInset();
    for (const [k, v] of Object.entries(box)) maxed.card.style.setProperty(`--mx-${k}`, `${Math.round(v)}px`);
  });
}
