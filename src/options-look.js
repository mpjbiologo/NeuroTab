// NeuroTab — configurações de aparência: barra que se esconde (#64), estilo dos atalhos (#59) e editor visual (#58).
import { h } from './lib/ui.js';
import { THEMES, DEFAULT_THEME, applyLook, paintLook, themeOf } from './lib/theme.js';
import {
  COLOR_KEYS, DEFAULT_LOOK, PALETTES, SHADOWS, DENSITIES, WIDGET_STYLES, MAX_THEMES,
  sanitizeLook, isDefaultLook, lookWarnings, rgbToHex, themeFile, parseThemeFile, sanitizeTheme,
} from './lib/look.js';
import { DEFAULT_TILES, TILE_PRESETS, presetOf, paintTiles, tileEl, sanitizeTiles } from './lib/tiles.js';
import { faviconUrl, saveData, inspectFavicon, ICON_SOURCES } from './lib/store.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let api; // { data(): data, toast(msg, action?, fn?) }
// Lido ao carregar o módulo: a navegação troca o endereço para #editor logo depois.
const RESET = location.hash === '#reset-tema';
const D = () => api.data();
const save = () => saveData(D());

export function setupLook(a) {
  api = a;
  setupDock();
  setupTiles();
  setupEditor();
  if (RESET) resetTheme(true);
}

/** Chamado quando os dados mudam em outra aba. */
export function refreshLook() {
  paintDock();
  paintTilesPage();
  if (!dirty()) loadDraft();
  paintLookNote();
}

// =====================================================================
// Barra que se esconde (#64)
// =====================================================================
function setupDock() {
  $('#dockMode').addEventListener('change', () => setTimeout(paintDock, 0));
  $('[data-k="dockHideDelay"]').addEventListener('input', () => setTimeout(paintDock, 0));
  $('#dockReset').addEventListener('click', async () => {
    Object.assign(D().settings, { dockPosition: 'left', dockMode: 'always', dockHideDelay: 0.6, dockPinned: false });
    await save();
    for (const k of ['dockPosition', 'dockMode', 'dockHideDelay', 'dockPinned']) {
      const el = $(`[data-k="${k}"]`);
      if (el.type === 'checkbox') el.checked = !!D().settings[k]; else el.value = String(D().settings[k]);
    }
    paintDock();
    api.toast('Barra restaurada');
  });
  paintDock();
}
function paintDock() {
  const s = D().settings;
  const m = s.dockMode || 'always';
  $('#dockDelayOpt').hidden = m === 'always';
  $('#dockPinOpt').hidden = m !== 'always';
  const secs = Number(s.dockHideDelay ?? 0.6);
  $('#dockDelayOut').textContent = secs ? `Agora: ${secs.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s.` : 'Agora: na hora.';
}

// =====================================================================
// Estilo dos atalhos (#59)
// =====================================================================
const SAMPLE = [
  { title: 'YouTube', url: 'https://www.youtube.com/', color: '#ff0033' },
  { title: 'Gmail', url: 'https://mail.google.com/', color: '#e5e4e2' },
  { title: 'WhatsApp', url: 'https://web.whatsapp.com/', color: '#48ce70' },
  { title: 'GitHub', url: 'https://github.com/', color: '#2d2d2d' },
  { title: 'Notas', url: 'https://keep.google.com/', color: '#f6c445', icon: { kind: 'emoji', value: '📝' } },
  { title: 'Banco', url: 'https://exemplo.com/', color: '#4267b2', icon: { kind: 'letter', value: 'B' } },
];
function sampleLinks() {
  const d = D();
  const first = d.groups[0]?.id;
  const mine = d.links.filter((l) => l.groupId === first).slice(0, 6);
  return mine.length >= 3 ? mine : SAMPLE;
}

function setupTiles() {
  $('#tilePresets').replaceChildren(...Object.entries(TILE_PRESETS).map(([id, p]) => {
    const prev = h('span', { class: 'tp-prev', 'aria-hidden': 'true' });
    const b = h('button', { type: 'button', class: 'tile-preset', role: 'radio', 'data-id': id, onclick: () => usePreset(id) }, prev, h('span', { class: 'tp-name' }, p.label));
    return b;
  }));
  $('#tilePreview').closest('.pane')?.addEventListener('input', () => setTimeout(paintTilesPage, 0));
  $('#tilePreview').closest('.pane')?.addEventListener('change', () => setTimeout(paintTilesPage, 0));
  $('#tileReset').addEventListener('click', () => usePreset('classico', 'Estilo dos atalhos restaurado'));
  setupIcons();
  paintTilesPage();
}

// Ícones dos atalhos em alta resolução: fonte (com permissão) e atualizar todos.
function setupIcons() {
  const sel = $('#iconSource');
  sel.value = D().settings.iconSource || 'browser';
  sel.addEventListener('change', async () => {
    const src = sel.value;
    const origins = ICON_SOURCES[src]?.origins || [];
    if (origins.length && !(await chrome.permissions.request({ origins }).catch(() => false))) {
      sel.value = D().settings.iconSource || 'browser';
      api.toast('Sem a permissão, os ícones continuam vindo só do navegador.');
      return;
    }
    D().settings.iconSource = src;
    await save();
    paintIconState();
    if (src !== 'browser') refreshIcons();
  });
  $('#iconsRefresh').addEventListener('click', refreshIcons);
  paintIconState();
}
function paintIconState() {
  $('#iconSourceState').textContent = D().settings.iconSource === 'browser' ? '' : '✓ Ligado.';
}
async function refreshIcons() {
  const btn = $('#iconsRefresh');
  const links = D().links.filter((l) => !l.icon);
  if (!links.length) return;
  btn.disabled = true;
  let done = 0;
  const found = new Map(); // id → ícone novo (os dados podem ser recarregados enquanto isso; aplica no fim)
  for (const l of links) {
    const { favicon } = await inspectFavicon(l.url, { source: D().settings.iconSource });
    if (favicon && favicon !== l.favicon) found.set(l.id, favicon);
    btn.textContent = `${++done}/${links.length}…`;
  }
  let better = 0;
  for (const l of D().links) if (found.has(l.id) && !l.icon) { l.favicon = found.get(l.id); better++; }
  await save();
  btn.disabled = false;
  btn.textContent = 'Atualizar ícones';
  paintTilesPage();
  api.toast(`${better} ${better === 1 ? 'ícone atualizado' : 'ícones atualizados'}`);
}

async function usePreset(id, msg) {
  const p = TILE_PRESETS[id];
  const s = D().settings;
  const before = { tiles: s.tiles, tileRadius: s.tileRadius };
  s.tiles = sanitizeTiles(p.tiles);
  s.tileRadius = p.tileRadius;
  await save();
  fillTileInputs();
  paintTilesPage();
  api.toast(msg || `Estilo ${p.label} aplicado`, 'Desfazer', async () => { Object.assign(s, before); await save(); fillTileInputs(); paintTilesPage(); });
}

function fillTileInputs() {
  const s = D().settings;
  for (const el of $$('[data-k^="tiles."], [data-k="tileRadius"]')) {
    const v = el.dataset.k === 'tileRadius' ? s.tileRadius : s.tiles[el.dataset.k.slice(6)];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
  }
}

function paintTilesPage() {
  const s = D().settings;
  const box = $('#tilePreview');
  paintTiles(box, s);
  const grid = box.querySelector('.grid');
  const t = sanitizeTiles(s.tiles);
  grid.style.setProperty('--gcols', t.shape === 'pill' ? 3 : 6);
  grid.replaceChildren(...sampleLinks().map((l) => tileEl(l, s, { href: false, faviconFor: (x) => x.favicon || faviconUrl(x.url) })));
  $('#tileColorOpt').hidden = t.fill !== 'single';
  const cur = presetOf(s.tiles, s.tileRadius);
  for (const b of $$('#tilePresets .tile-preset')) {
    b.setAttribute('aria-checked', String(b.dataset.id === cur));
    const p = TILE_PRESETS[b.dataset.id];
    const prev = b.querySelector('.tp-prev');
    paintTiles(prev, { ...s, tiles: p.tiles, tileRadius: p.tileRadius });
    prev.replaceChildren(tileEl({ title: 'Site', url: 'https://exemplo.com', color: '#3fa0a8', icon: { kind: 'letter', value: 'N' } }, { ...s, tiles: p.tiles }, { href: false, faviconFor: () => '' }));
  }
}

// =====================================================================
// Editor visual (#58)
// =====================================================================
const COLOR_LABELS = { accent: 'Destaque (botões e seleção)', bg: 'Fundo da página', surface: 'Painéis e widgets', text: 'Texto', border: 'Bordas e linhas' };
const COLOR_VARS = { accent: '--accent', bg: '--bg', surface: '--surface-solid', text: '--text', border: '--border-strong' };
let draft = null; // { base, look }

const saved = () => ({ base: themeOf(D().settings), look: sanitizeLook(D().settings.look) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dirty = () => !!draft && !same(draft, saved());

function setupEditor() {
  const opts = (sel, map) => $(sel).replaceChildren(...Object.entries(map).map(([k, v]) => new Option(typeof v === 'string' ? v : v.label, k)));
  opts('#edBase', THEMES);
  opts('#edShadow', SHADOWS);
  opts('#edDensity', DENSITIES);
  opts('#edWidget', WIDGET_STYLES);
  $('#edPalettes').replaceChildren(...Object.entries(PALETTES).map(([id, p]) =>
    h('button', { type: 'button', class: 'ed-pal', title: p.label, onclick: () => { draft = { base: p.base, look: sanitizeLook({ ...DEFAULT_LOOK, ...p.look }) }; paintEditor(); } },
      h('span', { class: 'ed-sw', style: { background: `linear-gradient(135deg, ${p.look.bg} 0 50%, ${p.look.surface} 50% 75%, ${p.look.accent} 75%)` } }), p.label)));
  $('#edColors').replaceChildren(...COLOR_KEYS.map((k) => h('div', { class: 'ed-row' },
    h('label', { for: 'edc-' + k }, COLOR_LABELS[k]),
    h('div', { class: 'ed-ctl' },
      h('input', { type: 'color', id: 'edc-' + k, 'data-color': k, oninput: (e) => { draft.look[k] = e.target.value; paintEditor(); } }),
      h('small', { class: 'ed-src', id: 'eds-' + k }),
      h('button', { type: 'button', class: 'ed-undo', 'data-clear': k, title: 'Usar a do tema' }, '↺')))));
  $('#edForm').addEventListener('click', (e) => {
    const k = e.target.closest('[data-clear]')?.dataset.clear;
    if (!k) return;
    draft.look[k] = k === 'opacity' || k === 'radius' ? null : '';
    paintEditor();
  });
  $('#edBase').addEventListener('change', (e) => { draft.base = e.target.value; paintEditor(); });
  $('#edOpacity').addEventListener('input', (e) => { draft.look.opacity = Number(e.target.value); paintEditor(); });
  $('#edRadius').addEventListener('input', (e) => { draft.look.radius = Number(e.target.value); paintEditor(); });
  $('#edShadow').addEventListener('change', (e) => { draft.look.shadow = e.target.value; paintEditor(); });
  $('#edDensity').addEventListener('change', (e) => { draft.look.density = e.target.value; paintEditor(); });
  $('#edWidget').addEventListener('change', (e) => { draft.look.widgetStyle = e.target.value; paintEditor(); });
  $('#edApply').addEventListener('click', applyDraft);
  $('#edCancel').addEventListener('click', () => { loadDraft(); api.toast('Alterações descartadas'); });
  $('#edReset').addEventListener('click', () => resetTheme(false));
  $('#edSave').addEventListener('click', saveAsTheme);
  $('#edExport').addEventListener('click', () => {
    const name = prompt('Nome do tema no arquivo:', 'Meu tema');
    if (name === null) return;
    const blob = new Blob([JSON.stringify(themeFile({ name, base: draft.base, look: draft.look }), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `neurotab-tema-${slug(name)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('#edImport').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const t = parseThemeFile(await file.text(), THEMES);
      const list = D().settings.customThemes;
      if (list.length >= MAX_THEMES) throw new Error(`Limite de ${MAX_THEMES} temas salvos. Exclua algum antes.`);
      t.id = 'u' + Date.now().toString(36);
      list.push(t);
      await save();
      paintThemes();
      api.toast(`Tema "${t.name}" importado — clique em Usar para aplicar`);
    } catch (err) {
      alert(err.message);
    }
  });
  $('#lookClear').addEventListener('click', async () => {
    const before = sanitizeLook(D().settings.look);
    D().settings.look = { ...DEFAULT_LOOK };
    await save();
    applyLook(D().settings);
    loadDraft();
    paintLookNote();
    api.toast('Tema puro, sem ajustes', 'Desfazer', async () => { D().settings.look = before; await save(); applyLook(D().settings); loadDraft(); paintLookNote(); });
  });
  window.addEventListener('beforeunload', (e) => { if (dirty()) e.preventDefault(); });
  buildPreview();
  loadDraft();
  paintLookNote();
}

const slug = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tema';

function loadDraft() {
  draft = structuredClone(saved());
  paintEditor();
}

function buildPreview() {
  const line = (cls, txt) => h('p', { class: cls }, txt);
  $('#edPreview').replaceChildren(
    h('div', { class: 'mp-rail' }, h('i', { class: 'on' }), h('i'), h('i'), h('i')),
    h('div', { class: 'mp-main' },
      h('div', { class: 'mp-clock' }, '14:32'),
      h('div', { class: 'mp-greet' }, 'Boa tarde'),
      h('div', { class: 'mp-search' }, 'Pesquisar atalhos, notas ou na web…'),
      h('div', { class: 'mp-widgets' },
        h('div', { class: 'mp-w' }, h('div', { class: 'mp-wh' }, 'Notas'), line('', 'Ideia para o projeto novo'), line('t2', 'há 2 horas'), h('span', { class: 'mp-chip' }, '#trabalho')),
        h('div', { class: 'mp-w' }, h('div', { class: 'mp-wh' }, 'Tarefas'), line('', '☐ Responder os e-mails'), line('t3', '☑ Revisar o relatório'), h('span', { class: 'mp-btn' }, 'Salvar')))),
  );
}

// Resolve a cor final de um token (inclui oklch e color-mix) para hex, desenhando num canvas de 1 px.
const cv = document.createElement('canvas');
cv.width = cv.height = 1;
const g2 = cv.getContext('2d', { willReadFrequently: true });
function tokenHex(el, varName) {
  const probe = h('i', { style: { display: 'none', color: `var(${varName})` } });
  el.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  g2.clearRect(0, 0, 1, 1);
  g2.fillStyle = '#000';
  g2.fillStyle = c;
  g2.fillRect(0, 0, 1, 1);
  const [r, g, b] = g2.getImageData(0, 0, 1, 1).data;
  return rgbToHex([r, g, b]);
}

function paintEditor() {
  if (!draft) return;
  draft.look = sanitizeLook(draft.look);
  const L = draft.look;
  const pv = $('#edPreview');
  pv.dataset.theme = draft.base;
  const vars = paintLook(pv, L);
  pv.style.setProperty('--dens', vars['--dens'] || '1'); // não herda a densidade salva da página
  $('#edBase').value = draft.base;
  for (const k of COLOR_KEYS) {
    const inp = $('#edc-' + k);
    inp.value = L[k] || tokenHex(pv, COLOR_VARS[k]);
    $('#eds-' + k).textContent = L[k] ? 'sua' : 'do tema';
    inp.closest('.ed-row').classList.toggle('custom', !!L[k]);
  }
  const radiusNow = parseInt(getComputedStyle(pv).getPropertyValue('--radius-md'), 10) || 12;
  $('#edOpacity').value = L.opacity ?? 74;
  $('#edOpacityOut').textContent = L.opacity === null ? 'do tema' : L.opacity + '%';
  $('#edRadius').value = L.radius ?? radiusNow;
  $('#edRadiusOut').textContent = L.radius === null ? 'do tema' : L.radius + ' px';
  $('#edShadow').value = L.shadow;
  $('#edDensity').value = L.density;
  $('#edWidget').value = L.widgetStyle;
  const warn = currentWarnings();
  $('#edWarn').replaceChildren(...warn.map((w) => h('li', {}, '⚠ ' + w)));
  const d = dirty();
  $('#edDirty').hidden = !d;
  $('#edApply').disabled = !d;
  $('#edCancel').disabled = !d;
  paintThemes();
}

function currentWarnings() {
  const pv = $('#edPreview');
  return lookWarnings({
    text: tokenHex(pv, '--text'), surface: tokenHex(pv, '--surface-solid'), bg: tokenHex(pv, '--bg'),
    accent: tokenHex(pv, '--accent'), onAccent: tokenHex(pv, '--on-accent'),
  });
}

async function applyDraft() {
  const warn = currentWarnings();
  if (warn.length && !confirm(`Atenção:\n\n• ${warn.join('\n• ')}\n\nAplicar mesmo assim? (Dá para voltar em "Restaurar padrão" ou em options.html#reset-tema.)`)) return;
  const s = D().settings;
  const before = saved();
  s.theme = draft.base;
  s.look = sanitizeLook(draft.look);
  await save();
  applyLook(s);
  paintEditor();
  paintLookNote();
  api.afterTheme?.();
  api.toast('Aparência aplicada', 'Desfazer', async () => { s.theme = before.base; s.look = before.look; await save(); applyLook(s); loadDraft(); paintLookNote(); api.afterTheme?.(); });
}

/** Volta ao tema padrão, sem ajustes. quiet: veio de options.html#reset-tema. */
async function resetTheme(quiet) {
  const s = D().settings;
  const before = saved();
  if (!quiet && isDefaultLook(s.look) && s.theme === DEFAULT_THEME && !dirty()) { api.toast('Já está no padrão'); return; }
  s.theme = DEFAULT_THEME;
  s.look = { ...DEFAULT_LOOK };
  await save();
  applyLook(s);
  loadDraft();
  paintLookNote();
  api.afterTheme?.();
  if (quiet) {
    if (location.hash === '#reset-tema') history.replaceState(null, '', location.pathname + '#editor');
    api.toast('Aparência restaurada para o padrão');
  } else {
    api.toast('Aparência padrão restaurada', 'Desfazer', async () => { s.theme = before.base; s.look = before.look; await save(); applyLook(s); loadDraft(); paintLookNote(); api.afterTheme?.(); });
  }
}

async function saveAsTheme() {
  const list = D().settings.customThemes;
  if (list.length >= MAX_THEMES) { alert(`Limite de ${MAX_THEMES} temas salvos. Exclua algum antes.`); return; }
  const name = prompt('Nome do tema:', `Meu tema ${list.length + 1}`);
  if (!name?.trim()) return;
  const t = sanitizeTheme({ id: 'u' + Date.now().toString(36), name, base: draft.base, look: draft.look }, THEMES);
  list.push(t);
  await save();
  paintThemes();
  api.toast(`Tema "${t.name}" salvo`);
}

function paintThemes() {
  const list = D().settings.customThemes || [];
  const box = $('#edThemes');
  if (!list.length) { box.replaceChildren(h('p', { class: 'hint' }, 'Nenhum tema salvo ainda. Ajuste as cores e clique em "Salvar como tema".')); return; }
  const now = saved();
  box.replaceChildren(...list.map((t) => {
    const on = same({ base: t.base, look: t.look }, now);
    const L = t.look;
    const sw = h('span', { class: 'ed-sw', style: { background: `linear-gradient(135deg, ${L.bg || THEMES[t.base].bg} 0 50%, ${L.surface || '#2a2f45'} 50% 75%, ${L.accent || '#5ad1e6'} 75%)` } });
    return h('div', { class: 'ed-theme' + (on ? ' on' : '') },
      sw,
      h('span', { class: 'ed-tn' }, t.name, on ? h('small', {}, ' · em uso') : null),
      h('button', { type: 'button', class: 'btn', onclick: () => { draft = { base: t.base, look: sanitizeLook(t.look) }; paintEditor(); applyDraft(); } }, 'Usar'),
      h('button', { type: 'button', class: 'btn', title: 'Abrir no editor sem aplicar', onclick: () => { draft = { base: t.base, look: sanitizeLook(t.look) }; paintEditor(); } }, 'Editar'),
      h('button', { type: 'button', class: 'btn', onclick: async () => { list.splice(list.indexOf(t) + 1, 0, { ...structuredClone(t), id: 'u' + Date.now().toString(36), name: (t.name + ' (cópia)').slice(0, 40) }); await save(); paintThemes(); } }, 'Duplicar'),
      h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        if (!confirm(`Excluir o tema "${t.name}"? A aparência atual não muda.`)) return;
        const i = list.indexOf(t);
        list.splice(i, 1);
        await save();
        paintThemes();
        api.toast(`Tema "${t.name}" excluído`, 'Desfazer', async () => { list.splice(i, 0, t); await save(); paintThemes(); });
      } }, 'Excluir'));
  }));
}

function paintLookNote() {
  $('#lookNote').hidden = isDefaultLook(D().settings.look);
}
