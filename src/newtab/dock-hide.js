// NeuroTab — barra de atalhos que se esconde (#64).
// Modos: always (fixa, como sempre foi) | auto (sai da tela e volta ao chegar perto da borda) |
// collapsed (fica só uma alça; clique ou toque abre). Em telas sem mouse, "auto" vira "collapsed".
// A barra passa POR CIMA do conteúdo nos modos que escondem: os widgets não mudam de lugar ao abrir/fechar.
import { $ } from '../lib/ui.js';
import { S } from './state.js';
import { dockPos, closePanel } from './rail.js';

const EDGE = 14; // px da borda que trazem a barra de volta (não precisa mirar no último pixel)
const body = () => document.body.classList;
const noHover = () => matchMedia('(hover: none)').matches;
let timer;
let hold = false; // 📌 nos modos que escondem: segura a barra aberta até clicar de novo
let over = false;

export const MODES = ['always', 'auto', 'collapsed'];
export function dockMode() {
  const m = MODES.includes(S.data.settings.dockMode) ? S.data.settings.dockMode : 'always';
  return m === 'auto' && noHover() ? 'collapsed' : m;
}
export const hides = () => dockMode() !== 'always';
export const dockHeld = () => hold;

const delay = () => Math.max(0, Math.min(5, Number(S.data.settings.dockHideDelay ?? 0.6))) * 1000;
// Foco do teclado segura a barra aberta; o foco que fica num botão depois de um clique, não.
const kbdFocus = () => !!$('#dock').querySelector(':focus-visible');
const busy = () => hold || over || !!S.drag || kbdFocus() || !!document.querySelector('dialog[open], .ctx');

export function applyDockMode() {
  const m = dockMode();
  const b = body();
  b.toggle('dock-hide', m !== 'always');
  b.toggle('dock-auto', m === 'auto');
  b.toggle('dock-collapsed', m === 'collapsed');
  if (m === 'always') { hold = false; b.remove('dock-show'); clearTimeout(timer); }
  const handle = $('#dockHandle');
  handle.hidden = m === 'always';
  handle.setAttribute('aria-expanded', String(b.contains('dock-show')));
  paintPin();
}

export function showDock() {
  clearTimeout(timer);
  if (!hides()) return;
  body().add('dock-show');
  $('#dockHandle').setAttribute('aria-expanded', 'true');
}

export function hideDock(force) {
  clearTimeout(timer);
  if (!hides() || (!force && busy())) return;
  if (force) hold = false;
  body().remove('dock-show');
  $('#dockHandle').setAttribute('aria-expanded', 'false');
  closePanel(true);
  paintPin();
}

function scheduleHide() {
  clearTimeout(timer);
  if (!hides() || !body().contains('dock-show')) return;
  timer = setTimeout(() => { if (!busy()) hideDock(); else scheduleHide(); }, delay());
}

/** O 📌 nos modos que escondem: segura a barra aberta (não muda a configuração). */
export function toggleHold() {
  hold = !hold;
  if (hold) showDock();
  else scheduleHide();
  paintPin();
}
function paintPin() {
  const pin = $('#pinDock');
  if (!pin) return;
  if (hides()) {
    pin.classList.toggle('on', hold);
    pin.title = hold ? 'Soltar a barra (volta a se esconder)' : 'Segurar a barra aberta';
    pin.setAttribute('aria-pressed', String(hold));
  } else {
    pin.classList.toggle('on', !!S.data.settings.dockPinned);
    pin.title = 'Fixar painel de atalhos';
    pin.setAttribute('aria-pressed', String(!!S.data.settings.dockPinned));
  }
}

function nearEdge(x, y) {
  switch (dockPos()) {
    case 'right': return x >= innerWidth - EDGE;
    case 'top': return y <= EDGE;
    case 'bottom': return y >= innerHeight - EDGE;
    default: return x <= EDGE;
  }
}

export function setupDockHide() {
  const dock = $('#dock');
  const handle = $('#dockHandle');
  dock.addEventListener('pointerenter', () => { over = true; showDock(); });
  dock.addEventListener('pointerleave', (e) => { over = false; if (e.pointerType !== 'touch') scheduleHide(); });
  dock.addEventListener('focusin', () => showDock());
  dock.addEventListener('focusout', () => setTimeout(() => { if (!kbdFocus()) scheduleHide(); }, 0));
  dock.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && hides() && $('#panel').hidden) { e.stopPropagation(); hideDock(true); handle.focus(); }
  });
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || dockMode() !== 'auto' || body().contains('dock-show')) return;
    if (nearEdge(e.clientX, e.clientY)) { showDock(); scheduleHide(); }
  }, { passive: true });
  handle.addEventListener('click', (e) => {
    e.stopPropagation();
    // No modo recolhido a alça abre e fecha; no automático ela só abre (o mouse já pode ter trazido a barra).
    if (dockMode() === 'collapsed' && body().contains('dock-show')) { hideDock(true); return; }
    showDock();
    dock.querySelector('.rail-btn')?.focus({ preventScroll: true });
  });
  // Toque ou clique fora fecha (menos quando segurada pelo 📌).
  document.addEventListener('pointerdown', (e) => {
    if (!hides() || hold || !body().contains('dock-show')) return;
    if (dock.contains(e.target) || handle.contains(e.target) || e.target.closest('dialog, .ctx')) return;
    hideDock(true);
  });
  // Ctrl+. abre a barra pelo teclado e põe o foco no primeiro grupo.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== '.' || !hides()) return;
    e.preventDefault();
    showDock();
    dock.querySelector('.rail-btn')?.focus();
  });
  matchMedia('(hover: none)').addEventListener?.('change', applyDockMode);
}
