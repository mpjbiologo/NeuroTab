// NeuroTab — Modo livre: widgets posicionados em qualquer lugar da tela (arrastar, redimensionar, camadas, encaixe).
import { saveData } from '../lib/store.js';
import { $, $$, h, toast } from '../lib/ui.js';
import { WIDGETS } from '../widgets/index.js';
import { bringToFront } from '../lib/window-manager.js';
import { S, heroEl, omniEl } from './state.js';
import { renderGrid } from './grid.js';
import { renderLayoutPicker } from './layouts.js';
import { buildCard, isFree, layoutSig, mountCard, renderWidgets } from './widgets.js';
import { spanFor, overlapsAny, firstFreeSpot, nearestFreePosition, snapAxis } from '../lib/layout-geometry.js';

// =====================================================================
// LIVRE — widgets em qualquer lugar da tela
// =====================================================================
const FIXED = {
  _hero: { el: () => heroEl, label: '🕐 Relógio', def: { fx: 0.3, fy: 10, fw: 0.4 }, show: () => S.data.settings.showClock },
  _search: { el: () => omniEl, label: '🔎 Busca', def: { fx: 0.22, fy: 170, fw: 0.56 }, show: () => S.data.settings.showSearch },
};

/** Corrige conflitos herdados no layout salvo, sem reorganizar widgets que já estão livres. */
function repairLoadedFreeLayout() {
  const box = $('#widgets');
  const W = box.clientWidth;
  if (!W) return false;

  const placed = [];
  let changed = false;
  let unresolved = false;

  for (const frame of $$('.free-item', box)) {
    const width = Math.min(W, frame.offsetWidth);
    const height = frame.offsetHeight;
    const original = {
      x: frame.offsetLeft,
      y: Math.max(0, frame.offsetTop),
      w: width,
      h: height,
    };
    const desired = {
      x: Math.max(0, Math.min(W - width, original.x)),
      y: original.y,
      w: width,
      h: height,
    };
    const rect = (p) => ({ l: p.x, t: p.y, r: p.x + p.w, b: p.y + p.h });

    let next = desired;
    if (overlapsFreeItem(rect(next), placed)) {
      next = nearestFree(box, desired, placed);
    }

    if (!next) {
      unresolved = true;
      placed.push(rect(original));
      continue;
    }

    const moved = Math.abs(next.x - frame.offsetLeft) > 1
      || Math.abs(next.y - frame.offsetTop) > 1
      || Math.abs(next.w - frame.offsetWidth) > 1;
    if (moved) {
      frame.style.left = next.x + 'px';
      frame.style.top = next.y + 'px';
      frame.style.width = next.w + 'px';
      changed = true;

      const fixedKey = frame.dataset.fixed;
      if (fixedKey) {
        S.data.settings.freeFixed = S.data.settings.freeFixed || {};
        S.data.settings.freeFixed[fixedKey] = {
          ...(S.data.settings.freeFixed[fixedKey] || FIXED[fixedKey].def),
          fx: next.x / W,
          fy: next.y,
          fw: next.w / W,
        };
      } else {
        const idx = Number(frame.dataset.idx);
        const widget = S.data.settings.widgets[idx];
        if (widget) Object.assign(widget, { fx: next.x / W, fy: next.y, fw: next.w / W });
      }
    }
    placed.push(rect(next));
  }

  if (changed) saveWidgets().catch((err) => console.error('Falha ao salvar layout recuperado:', err));
  if (unresolved) toast('Alguns widgets continuam sobrepostos: não foi encontrado espaço livre suficiente.');
  return changed;
}

export function renderFree() {
  const box = $('#widgets');
  box.replaceChildren();
  box.style.gridTemplateColumns = '';
  const W = box.clientWidth;
  const s = S.data.settings;
  s.freeFixed = s.freeFixed || {};

  // Relógio e busca viram itens livres
  for (const [key, f] of Object.entries(FIXED)) {
    const el = f.el();
    if (!f.show()) { $('#center').prepend(el); continue; }
    const pos = { ...f.def, ...(s.freeFixed[key] || {}) };
    const handle = h('div', { class: 'ff-handle', title: 'Arraste para mover' }, '⠿ ', f.label);
    const grip = h('div', { class: 'grip' });
    const frame = h('div', { class: 'free-item free-fixed', 'data-fixed': key }, handle, el, grip);
    box.append(frame);
    placeFrame(frame, pos, W, false);
    attachFree(frame, {
      handles: [handle],
      grip,
      fixedHeight: false,
      minW: key === '_hero' ? 160 : 260,
      save: async (p) => { S.data.settings.freeFixed = { ...(S.data.settings.freeFixed || {}), [key]: p }; await saveWidgets(); },
    });
  }

  // Widgets
  const list = s.widgets;
  list.forEach((w, idx) => {
    if (!WIDGETS[w.id]) return;
    if (w.fx == null) Object.assign(w, autoPlace(w, W));
    const parts = buildCard(w, idx);
    const { card, header, grip } = parts;
    card.classList.add('free-item');
    box.append(card);
    placeFrame(card, w, W, true);
    S.zTop = Math.max(S.zTop, w.fz || 0);
    grip.addEventListener('dblclick', async () => { card.style.height = 'auto'; const hpx = Math.min(900, card.offsetHeight); card.style.height = hpx + 'px'; await setWidget(idx, { fh: hpx }, true); fitCanvas(); });
    attachFree(card, {
      handles: [header],
      grip,
      fixedHeight: true,
      minW: 200,
      minH: 110,
      save: (p) => setWidget(idx, p, true),
    });
    mountCard(parts, w, idx);
  });
  if (!list.length) box.append(h('p', { class: 'muted free-empty' }, 'Nenhum widget. Clique em 🧩 → ＋ Widget.'));
  repairLoadedFreeLayout();
  fitCanvas();
}

function placeFrame(frame, p, W, fixedHeight) {
  frame.style.left = Math.round(p.fx * W) + 'px';
  frame.style.top = Math.round(p.fy) + 'px';
  frame.style.width = Math.round(Math.min(W, p.fw * W)) + 'px';
  if (fixedHeight) frame.style.height = Math.round(p.fh || 320) + 'px';
  if (p.fz) frame.style.zIndex = p.fz;
}

export function repositionFree() {
  const box = $('#widgets');
  const W = box.clientWidth;
  for (const frame of $$('.free-item', box)) {
    if (frame.dataset.fixed) placeFrame(frame, { ...FIXED[frame.dataset.fixed].def, ...(S.data.settings.freeFixed?.[frame.dataset.fixed] || {}) }, W, false);
    else {
      const w = S.data.settings.widgets[+frame.dataset.idx];
      if (w) placeFrame(frame, w, W, true);
    }
  }
  fitCanvas();
}

function fitCanvas(extra = 0) {
  const box = $('#widgets');
  let bottom = 0;
  for (const f of $$('.free-item', box)) bottom = Math.max(bottom, f.offsetTop + f.offsetHeight);
  const min = innerHeight - (box.getBoundingClientRect().top + scrollY) - 10;
  box.style.height = Math.max(min, bottom + 40, extra) + 'px';
}

/** Primeiro espaço livre (de cima para baixo, da esquerda para a direita). */
export function autoPlace(w, W) {
  const fw = Math.min(1, (w.w || WIDGETS[w.id]?.defaultW || 6) / 12);
  const fh = w.fh || 340;
  const obstacles = $$('#widgets .free-item').map((f) => ({ l: f.offsetLeft, t: f.offsetTop, r: f.offsetLeft + f.offsetWidth, b: f.offsetTop + f.offsetHeight }));
  const spot = firstFreeSpot({ width: fw * W, height: fh, W, obstacles });
  return spot ? { fx: spot.x / W, fy: spot.y, fw, fh } : { fx: 0, fy: 0, fw, fh };
}

let guides = [];
function guide(dir, at) {
  const g = h('div', { class: 'guide guide-' + dir });
  if (dir === 'v') g.style.left = at + 'px'; else g.style.top = at + 'px';
  $('#widgets').append(g);
  guides.push(g);
}
function clearGuides() { guides.forEach((g) => g.remove()); guides = []; }

/** Evita que janelas do layout livre terminem sobrepostas após mover/redimensionar. */
function freeItemRects(box, except) {
  return Array.from(box.querySelectorAll('.free-item')).filter((item) => item !== except).map((item) => ({
    l: item.offsetLeft, t: item.offsetTop,
    r: item.offsetLeft + item.offsetWidth, b: item.offsetTop + item.offsetHeight,
  }));
}

const overlapsFreeItem = (rect, obstacles) => overlapsAny(rect, obstacles);
/** Posição livre mais próxima dentro da área dos widgets (ver lib/layout-geometry.js). */
const nearestFree = (box, desired, obstacles) => nearestFreePosition({ W: box.clientWidth, desired, obstacles });

function attachFree(frame, { handles, grip, fixedHeight, minW = 200, minH = 110, save }) {
  const box = $('#widgets');
  const begin = (e, mode) => {
    if (e.button !== 0) return;
    if (frame.classList.contains('maximized')) return; // maximizado não se arrasta nem redimensiona
    if (mode === 'move' && e.target.closest('button, input, select, textarea, a, label, .wact, .wtools')) return;
    if (mode === 'move' && frame.classList.contains('free-fixed') && !S.editing) return;
    e.preventDefault();
    const W = box.clientWidth;
    const r = { x: frame.offsetLeft, y: frame.offsetTop, w: frame.offsetWidth, h: frame.offsetHeight };
    const sx = e.clientX;
    const sy = e.clientY;
    S.zTop = bringToFront(frame);
    frame.classList.add(mode === 'move' ? 'moving' : 'resizing');
    const others = $$('.free-item', box).filter((f) => f !== frame).map((f) => ({ l: f.offsetLeft, t: f.offsetTop, r: f.offsetLeft + f.offsetWidth, b: f.offsetTop + f.offsetHeight }));
    const xs = [0, W, W / 2, ...others.flatMap((o) => [o.l, o.r, o.l - 16, o.r + 16])];
    const ys = [0, ...others.flatMap((o) => [o.t, o.b, o.t - 16, o.b + 16])];
    let cur = { ...r };
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      const snap = !ev.altKey;
      clearGuides();
      if (mode === 'move') {
        let x = r.x + dx;
        let y = Math.max(0, r.y + dy);
        if (snap) {
          const a = snapAxis([x, x + r.w, x + r.w / 2], xs);
          if (a) { x += a.d; guide('v', a.at); } else x = Math.round(x / 10) * 10;
          const b = snapAxis([y, y + r.h], ys);
          if (b) { y += b.d; guide('h', b.at); } else y = Math.round(y / 10) * 10;
        }
        cur.x = Math.max(0, Math.min(W - r.w, x));
        cur.y = Math.max(0, y);
      } else {
        let w = r.w + dx;
        let hh = r.h + dy;
        if (snap) {
          const a = snapAxis([r.x + w], xs);
          if (a) { w += a.d; guide('v', a.at); } else w = Math.round(w / 10) * 10;
          if (fixedHeight) {
            const b = snapAxis([r.y + hh], ys);
            if (b) { hh += b.d; guide('h', b.at); } else hh = Math.round(hh / 10) * 10;
          }
        }
        cur.w = Math.max(minW, Math.min(W - r.x, w));
        cur.h = Math.max(minH, hh);
      }
      frame.style.left = cur.x + 'px';
      frame.style.top = cur.y + 'px';
      frame.style.width = cur.w + 'px';
      if (fixedHeight) frame.style.height = cur.h + 'px';
      fitCanvas(cur.y + cur.h + 200);
    };
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      clearGuides();
      frame.classList.remove('moving', 'resizing');
      if (!moved) return;

      const obstacles = freeItemRects(box, frame);
      const proposed = { l: cur.x, t: cur.y, r: cur.x + cur.w, b: cur.y + cur.h };
      if (mode === 'move' && overlapsFreeItem(proposed, obstacles)) {
        const free = nearestFree(box, cur, obstacles);
        if (free) {
          cur.x = free.x;
          cur.y = free.y;
          frame.style.left = cur.x + 'px';
          frame.style.top = cur.y + 'px';
        } else {
          cur = { ...r };
          frame.style.left = r.x + 'px';
          frame.style.top = r.y + 'px';
          toast('Não há espaço livre para posicionar este widget.');
        }
      } else if (mode === 'resize' && overlapsFreeItem(proposed, obstacles)) {
        cur.w = r.w;
        cur.h = r.h;
        frame.style.width = r.w + 'px';
        if (fixedHeight) frame.style.height = r.h + 'px';
        toast('Redimensionamento limitado para evitar sobreposição. Mova o widget ou tente outro tamanho.');
      }

      const p = { fx: cur.x / W, fy: cur.y, fw: cur.w / W, fz: S.zTop };
      if (fixedHeight) p.fh = cur.h;
      await save(p);
      fitCanvas();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };
  handles.forEach((hd) => hd.addEventListener('pointerdown', (e) => begin(e, 'move')));
  grip?.addEventListener('pointerdown', (e) => { e.stopPropagation(); begin(e, 'resize'); });
  frame.addEventListener('pointerdown', () => { S.zTop = bringToFront(frame); });
}

/** Converte a grade atual em posições livres, preservando o que se vê. */
function captureGridPositions() {
  const center = $('#center');
  const cs = getComputedStyle(center);
  const c = center.getBoundingClientRect();
  const ox = c.left + parseFloat(cs.paddingLeft);
  const oy = c.top + parseFloat(cs.paddingTop);
  const W = center.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const s = S.data.settings;
  s.freeFixed = s.freeFixed || {};
  for (const [key, f] of Object.entries(FIXED)) {
    const el = f.el();
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    const fw = key === '_hero' ? Math.min(0.4, 520 / W) : r.width / W;
    const fx = key === '_hero' ? (1 - fw) / 2 : (r.left - ox) / W;
    s.freeFixed[key] = { fx, fy: Math.max(0, r.top - oy), fw };
  }
  for (const card of $$('#widgets .widget')) {
    const w = s.widgets[+card.dataset.idx];
    if (!w) continue;
    const r = card.getBoundingClientRect();
    Object.assign(w, { fx: (r.left - ox) / W, fy: Math.max(0, r.top - oy), fw: r.width / W, fh: Math.round(r.height) });
  }
}

export async function setLayoutMode(mode) {
  const s = S.data.settings;
  if (mode === s.layoutMode) return;
  if (mode === 'free') {
    if (s.widgets.some((w) => w.fx == null) || !s.freeFixed?._hero) captureGridPositions();
  }
  s.layoutMode = mode;
  await saveWidgets();
  renderWidgets();
  toast(mode === 'free' ? 'Modo livre: arraste pelo título para qualquer lugar ✨' : 'Modo grade');
}

export async function rearrangeFree() {
  if (!confirm('Reorganizar todos os widgets em grade (você pode mover de novo depois)?')) return;
  const s = S.data.settings;
  s.layoutMode = 'grid';
  document.body.classList.remove('free');
  renderGrid();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  captureGridPositions();
  s.layoutMode = 'free';
  await saveWidgets();
  renderWidgets();
}

export function paintModeButtons() {
  const free = S.data.settings.layoutMode === 'free';
  $('#modeGrid').classList.toggle('sel', !free);
  $('#modeFree').classList.toggle('sel', free);
  $('#rearrange').hidden = !free;
}

export function applyWidgetSize(card, w) {
  card.style.gridColumn = `span ${spanFor(w.w || 6, S.gridCols)}`;
  if (w.hpx && S.gridCols > 1) { card.style.height = w.hpx + 'px'; card.style.maxHeight = 'none'; card.classList.add('fixed-h'); }
  else { card.style.height = ''; card.style.maxHeight = ''; card.classList.remove('fixed-h'); }
  const ws = card.querySelector('.wsize');
  if (ws) ws.textContent = `${w.w}/12`;
}

export function setupResize(card, grip, idx) {
  grip.addEventListener('dblclick', () => setWidget(idx, { hpx: null }));
  grip.addEventListener('pointerdown', (e) => {
    if (S.gridCols === 1) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const box = $('#widgets');
    const gap = parseFloat(getComputedStyle(box).columnGap) || 16;
    const colW = (box.clientWidth - gap * (S.gridCols - 1)) / S.gridCols;
    const r0 = card.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: r0.width, h: r0.height };
    const w = { ...S.data.settings.widgets[idx] };
    card.classList.add('resizing');
    const move = (ev) => {
      const width = start.w + (ev.clientX - start.x);
      let span = Math.round((width + gap) / (colW + gap));
      span = Math.max(S.gridCols === 12 ? 3 : 3, Math.min(S.gridCols, span));
      w.w = S.gridCols === 12 ? span : span >= 6 ? 12 : 6;
      w.hpx = Math.max(140, Math.min(1200, Math.round((start.h + (ev.clientY - start.y)) / 10) * 10));
      applyWidgetSize(card, w);
    };
    const up = async () => {
      grip.removeEventListener('pointermove', move);
      card.classList.remove('resizing');
      if (Math.abs(w.hpx - start.h) < 12) w.hpx = S.data.settings.widgets[idx].hpx || null;
      await setWidget(idx, { w: w.w, hpx: w.hpx }, true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
    grip.addEventListener('pointercancel', up, { once: true });
  });
}

export async function saveWidgets() {
  S.widgetsSig = layoutSig();
  await saveData(S.data);
}

export async function setWidget(idx, patch, silent) {
  const w = S.data.settings.widgets[idx];
  if (!w) return;
  Object.assign(w, patch);
  for (const k of Object.keys(patch)) if (patch[k] == null) delete w[k];
  await saveWidgets();
  if (!silent) renderWidgets();
  else if (!isFree()) {
    const card = $(`.widget[data-idx="${idx}"]`);
    if (card && ('w' in patch || 'hpx' in patch)) applyWidgetSize(card, w);
  }
}

export async function removeWidget(idx) {
  S.data.settings.widgets.splice(idx, 1);
  await saveWidgets();
  renderWidgets();
}

export function setEditing(on) {
  S.editing = on;
  document.body.classList.toggle('editing', on);
  $('#editBar').hidden = !on;
  $('#editLayout').classList.toggle('on', on);
  $$('.widget:not(.free-item)').forEach((w) => { w.draggable = on; });
  if (on) { renderLayoutPicker(); paintModeButtons(); }
}
