// NeuroTab — Montagem dos widgets: qual layout usar, quando remontar e entre grade e modo livre.
import { $, h } from '../lib/ui.js';
import { WIDGETS } from '../widgets/index.js';
import { S, heroEl, omniEl } from './state.js';
import { ctx } from './context.js';
import { paintModeButtons, removeWidget, renderFree, setWidget } from './free.js';
import { renderGrid } from './grid.js';

export function layoutCols() {
  const w = $('#widgets').clientWidth || innerWidth;
  return w >= 1000 ? 12 : w >= 620 ? 6 : 1;
}

export function spanFor(w) {
  if (S.gridCols === 12) return w;
  if (S.gridCols === 6) return w >= 7 ? 6 : 3;
  return 1;
}

// ---------- Modo de layout ----------
export const isFree = () => S.data.settings.layoutMode === 'free' && innerWidth >= 700;
export const layoutSig = (s = S.data.settings) => JSON.stringify([s.widgets, s.freeFixed, s.layoutMode]);

export function buildCard(w, idx) {
  const def = WIDGETS[w.id];
  const actions = h('div', { class: 'wact' });
  const body = h('div', { class: 'wbody' });
  const grip = h('div', { class: 'grip', title: 'Arraste para redimensionar · duplo clique: altura automática' });
  const header = h('header', {},
    h('span', { class: 'wt' }, def.icon, ' ', def.title),
    actions,
    h('div', { class: 'wtools' },
      h('button', { class: 'wgrid', title: 'Mais estreito', onclick: () => setWidget(idx, { w: Math.max(3, (w.w || 6) - 1) }) }, '−'),
      h('span', { class: 'wsize wgrid' }, `${w.w}/12`),
      h('button', { class: 'wgrid', title: 'Mais largo', onclick: () => setWidget(idx, { w: Math.min(12, (w.w || 6) + 1) }) }, '+'),
      h('button', { title: 'Remover', onclick: () => removeWidget(idx) }, '✕'),
    ),
  );
  const card = h('article', { class: 'widget', 'data-id': w.id, 'data-idx': idx }, header, body, grip);
  return { def, card, header, body, grip, actions };
}

export function mountCard({ def, body, actions }, w, idx) {
  try {
    const wctx = Object.assign(Object.create(ctx), { actions, saveWidget: (patch) => setWidget(idx, patch, true) });
    Object.defineProperty(wctx, 'widget', { get: () => S.data.settings.widgets[idx] || w });
    const inst = def.mount(body, wctx);
    S.mounted.push({ id: w.id, destroy: inst?.destroy });
  } catch (err) {
    console.error(err);
    body.append(h('p', { class: 'muted' }, 'Erro ao carregar este widget.'));
  }
}

export function renderWidgets() {
  S.mounted.forEach((m) => { try { m.destroy?.(); } catch {} });
  S.mounted = [];
  $('#center').prepend(heroEl, omniEl); // tira de dentro dos quadros antes de redesenhar
  S.widgetsSig = layoutSig();
  const free = isFree();
  document.body.classList.toggle('free', free);
  if (S.editing) paintModeButtons();
  if (free) renderFree();
  else renderGrid();
}
