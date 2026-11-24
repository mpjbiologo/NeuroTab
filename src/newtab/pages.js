// Várias páginas de widgets (0.9.2.1, #75): pontinhos sob o relógio, setas ao passar o mouse,
// deslizar, Alt+[ / Alt+] / Alt+1…9, voz e a barra de páginas no modo de edição.
import { $, h, toast } from '../lib/ui.js';
import { saveData } from '../lib/store.js';
import { t } from '../lib/i18n.js';
import { S, bus } from './state.js';
import { renderWidgets, layoutSig } from './widgets.js';
import { registerHotkey } from './keys.js';
import { hasPages, pageIndex, switchPage, addPage, renamePage, movePage, removePage, moveWidgetToPage, startPage, findPage, MAX_PAGES } from '../lib/pages.js';
import { hotkeyLabel } from '../lib/hotkeys.js';

const s = () => S.data.settings;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let busy = false;

async function persist() {
  S.widgetsSig = layoutSig();
  await saveData(S.data);
}

// Troca de página com um deslizar curto (ou sem animação, com "reduzir movimento").
export async function goPage(target) {
  if (busy || !hasPages(s())) return false;
  const from = pageIndex(s());
  if (!switchPage(s(), target)) return false;
  busy = true;
  const to = pageIndex(s());
  const dir = to > from ? 1 : -1;
  await persist(); // grava antes de animar: outra gravação no meio não traz a página velha de volta
  const box = $('#widgets');
  if (!reduced()) {
    box.style.transition = 'transform .16s ease-in, opacity .16s ease-in';
    box.style.transform = `translateX(${-dir * 40}px)`;
    box.style.opacity = '0';
    await new Promise((r) => setTimeout(r, 160));
  }
  renderWidgets();
  paintPager();
  if (!reduced()) {
    box.style.transition = 'none';
    box.style.transform = `translateX(${dir * 40}px)`;
    requestAnimationFrame(() => {
      box.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
      box.style.transform = '';
      box.style.opacity = '';
    });
  }
  busy = false;
  return true;
}

// ── Indicador (pontinhos / abas / setas) ────────────────────────────────────
export function paintPager() {
  const pager = $('#pager');
  const st = s();
  const nav = st.pagesNav || {};
  const on = hasPages(st) && nav.style !== 'hidden';
  document.body.classList.toggle('has-pages', hasPages(st));
  document.body.classList.toggle('page-rest', hasPages(st) && pageIndex(st) > 0 && nav.clockAll === false);
  pager.hidden = !on;
  paintEditPages();
  if (!on) { pager.replaceChildren(); return; }
  const cur = pageIndex(st);
  const label = (p, i) => `${p.icon ? p.icon + ' ' : ''}${p.name || `Página ${i + 1}`}`;
  const items = nav.style === 'arrows' ? [] : st.pages.map((p, i) => h('button', {
    class: 'pg-' + (nav.style === 'tabs' ? 'tab' : 'dot'), type: 'button', 'data-page': i,
    'aria-current': i === cur ? 'page' : null, 'aria-label': label(p, i), title: label(p, i) + (i < 9 ? ` (${hotkeyLabel(st.hotkeys, 'pageN').replace('1…9', String(i + 1))})` : ''),
    onclick: () => goPage(i),
  }, nav.style === 'tabs' ? label(p, i) : ''));
  pager.className = 'pager pager-' + nav.style;
  pager.replaceChildren(
    h('button', { class: 'pg-arrow prev', type: 'button', 'aria-label': 'Página anterior', title: `Página anterior (${hotkeyLabel(st.hotkeys, 'pagePrev')})`, onclick: () => goPage('prev') }, '‹'),
    h('div', { class: 'pg-items', role: 'tablist', 'aria-label': 'Páginas' }, ...items),
    h('button', { class: 'pg-arrow next', type: 'button', 'aria-label': 'Próxima página', title: `Próxima página (${hotkeyLabel(st.hotkeys, 'pageNext')})`, onclick: () => goPage('next') }, '›'),
  );
}

// ── Barra de páginas no modo de edição ──────────────────────────────────────
export function paintEditPages() {
  const box = $('#pageEdit');
  if (!box) return;
  const st = s();
  const cur = hasPages(st) ? st.pages[pageIndex(st)] : null;
  box.replaceChildren(...[
    h('span', { class: 'pe-label' }, cur ? `${cur.icon ? cur.icon + ' ' : ''}${cur.name}` : t('Página única')),
    cur ? h('button', { class: 'btn', id: 'pageRename', title: 'Renomear esta página', onclick: renameDialog }, '✏️') : null,
    cur && pageIndex(st) > 0 ? h('button', { class: 'btn', title: 'Mover a página para a esquerda', onclick: async () => { movePage(st, cur.id, -1); await persist(); paintPager(); } }, '◀') : null,
    cur && pageIndex(st) < st.pages.length - 1 ? h('button', { class: 'btn', title: 'Mover a página para a direita', onclick: async () => { movePage(st, cur.id, 1); await persist(); paintPager(); } }, '▶') : null,
    cur ? h('button', { class: 'btn danger', id: 'pageDel', title: 'Apagar esta página', onclick: deletePage }, '🗑') : null,
    h('button', { class: 'btn', id: 'pageAdd', title: 'Nova página de widgets', disabled: hasPages(st) && st.pages.length >= MAX_PAGES, onclick: newPage }, '＋ Página'),
  ].filter(Boolean));
}

async function newPage() {
  const name = prompt(t('Nome da nova página (ex.: Trabalho, Estudos, Casa):'), '');
  if (name === null) return;
  const p = addPage(s(), { name: name.trim() });
  if (!p) { toast(t('Máximo de 9 páginas.')); return; }
  if (!(await goPage(p.id))) await persist();
  toast(t('Página criada. Adicione widgets com ＋ Widget.'));
}

async function renameDialog() {
  const st = s();
  const cur = st.pages[pageIndex(st)];
  const name = prompt(t('Nome da página:'), cur.name);
  if (name === null) return;
  const icon = prompt(t('Emoji da página (opcional):'), cur.icon || '');
  renamePage(st, cur.id, { name, icon: icon ?? cur.icon });
  await persist();
  paintPager();
}

async function deletePage() {
  const st = s();
  const cur = st.pages[pageIndex(st)];
  const n = st.widgets.length;
  if (!confirm(t(`Apagar a página "${cur.name}"?`))) return;
  const keep = n ? confirm(t(`Mover os ${n} widget(s) desta página para a primeira? (Cancelar apaga os widgets junto.)`)) : false;
  removePage(st, cur.id, { keepWidgets: keep });
  await persist();
  renderWidgets();
  paintPager();
  toast(t('Página apagada.'));
}

// Menu "Mover para a página…" do widget (modo de edição).
export function pageMenu(idx, anchor) {
  const st = s();
  if (!hasPages(st)) return;
  document.querySelector('.pg-menu')?.remove();
  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'pg-menu', role: 'menu', style: { top: `${r.bottom + 4}px`, left: `${Math.max(8, r.right - 180)}px` } },
    h('div', { class: 'pg-menu-t' }, t('Mover para a página')),
    ...st.pages.map((p, i) => h('button', { role: 'menuitem', type: 'button', disabled: p.id === st.page, onclick: async () => {
      menu.remove();
      if (moveWidgetToPage(st, idx, p.id)) { await persist(); renderWidgets(); toast(t(`Widget movido para "${p.name}".`)); }
    } }, `${p.icon ? p.icon + ' ' : ''}${p.name || `Página ${i + 1}`}`)));
  document.body.append(menu);
  setTimeout(() => document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) menu.remove(); }, { once: true }), 0);
}

// ── Deslizar (touchpad e toque) ─────────────────────────────────────────────
function setupSwipe() {
  const ok = (e) => hasPages(s()) && s().pagesNav?.swipe !== false && !S.editing && !document.querySelector('dialog[open], #voice:not([hidden])');
  // Dentro de algo que rola de lado, o gesto é dele.
  const scrollsX = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true; return false; };
  let acc = 0, last = 0, lock = 0;
  addEventListener('wheel', (e) => {
    if (!ok(e) || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5 || scrollsX(e.target)) return;
    const now = Date.now();
    if (now < lock) return;
    if (now - last > 250) acc = 0;
    last = now;
    acc += e.deltaX;
    if (Math.abs(acc) > 140) { lock = now + 700; const dir = acc > 0 ? 'next' : 'prev'; acc = 0; goPage(dir); }
  }, { passive: true });
  let sx = 0, sy = 0, st0 = 0, target = null;
  addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st0 = Date.now(); target = e.target; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (!ok(e) || !target || scrollsX(target)) return;
    const t0 = e.changedTouches[0];
    const dx = t0.clientX - sx, dy = t0.clientY - sy;
    if (Date.now() - st0 < 600 && Math.abs(dx) > 80 && Math.abs(dy) < 60) goPage(dx < 0 ? 'next' : 'prev');
  }, { passive: true });
}

export function setupPages() {
  if (startPage(s())) { renderWidgets(); persist(); }
  paintPager();
  registerHotkey('pagePrev', () => goPage('prev'));
  registerHotkey('pageNext', () => goPage('next'));
  registerHotkey('pageN', (n) => { if (hasPages(s()) && n <= s().pages.length) goPage(n - 1); });
  bus.on('data.changed', () => paintPager());
  bus.on('widgets.rendered', () => paintEditPages());
  setupSwipe();
}

// Voz: "ir para a página Trabalho", "próxima página", "página 2".
export async function voicePage(text) {
  const st = s();
  if (!hasPages(st)) return t('Você só tem uma página. Crie outras no modo de edição (🧩 → ＋ Página).');
  const f = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let target = /\b(proxima|seguinte|next)\b/.test(f) ? 'next' : /\b(anterior|previous|voltar)\b/.test(f) ? 'prev' : findPage(st, f);
  if (target === -1) return t('Não achei essa página. Suas páginas: ') + st.pages.map((p) => p.name).join(', ') + '.';
  await goPage(target);
  const p = st.pages[pageIndex(st)];
  return t('Página ') + p.name + '.';
}
