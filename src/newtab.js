// NeuroTab — nova aba: barra de atalhos + centro com o segundo cérebro.
import {
  DATA_KEY, BG_KEY, ACTIVE_KEY, BRAIN_KEY, SEARCH_ENGINES,
  loadData, saveData, loadBg, uid, hostOf, normalizeUrl, faviconUrl, inspectFavicon, cssColorToHex,
} from './lib/store.js';
import * as Brain from './lib/brain.js';
import { isConfigured, enrich } from './lib/ai.js';
import { $, $$, h, toast, showCtx, micButton, toLocalInput, fromLocalInput } from './lib/ui.js';
import { WIDGETS } from './widgets/index.js';

const EMOJIS = ['🏠','⭐','📁','🚀','🎓','💲','💼','🤖','🎮','📚','🍺','🥗','🎬','🎵','🛒','💻','🔗','🧪','🧬','📰','✈️','⚙️','❤️','📷'];

let data;
let items = [];
let activeId;
let bgCache = null;
let drag = null; // { type: 'link' | 'group' | 'widget', id }
let editing = false;
const listeners = { brain: new Set(), data: new Set(), ask: new Set() };
let mounted = []; // [{ id, destroy }]

// ---------- Contexto entregue aos widgets ----------
const ctx = {
  get data() { return data; },
  get settings() { return data.settings; },
  get items() { return items; },
  brain: Brain,
  toast,
  async saveSettings(patch) {
    Object.assign(data.settings, patch);
    await saveData(data);
  },
  on(evt, fn) { listeners[evt].add(fn); return () => listeners[evt].delete(fn); },
  openItem: (it) => openItemDialog(it),
  newItem: (p) => openItemDialog(null, p),
  async capture(p) {
    const it = await Brain.addItem(p);
    items = await Brain.loadItems();
    if (data.settings.ai.autoEnrich && isConfigured(data.settings)) {
      chrome.runtime.sendMessage({ type: 'enrich', id: it.id }).catch(() => {});
    }
    return it;
  },
  aiReady: () => isConfigured(data.settings),
  openLinkDialog: (link) => editLink(link),
  faviconFor: (l) => l.favicon || faviconUrl(l.url),
  openSettings: (hash = '') => { location.href = 'options.html' + hash; },
};

init();

async function init() {
  data = await loadData();
  items = await Brain.loadItems();
  const r = await chrome.storage.local.get(ACTIVE_KEY);
  activeId = data.groups.some((g) => g.id === r[ACTIVE_KEY]) ? r[ACTIVE_KEY] : data.groups[0].id;
  bgCache = await loadBg();
  applySettings();
  renderDock();
  renderWidgets();
  setupOmni();
  setupClock();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes[DATA_KEY]) {
      const prevWidgets = JSON.stringify(data.settings.widgets);
      data = await loadData();
      if (!data.groups.some((g) => g.id === activeId)) activeId = data.groups[0].id;
      applySettings();
      renderDock();
      if (JSON.stringify(data.settings.widgets) !== prevWidgets) renderWidgets();
      listeners.data.forEach((fn) => fn(data));
    }
    if (changes[BRAIN_KEY]) {
      items = changes[BRAIN_KEY].newValue || [];
      listeners.brain.forEach((fn) => fn(items));
    }
    if (changes[BG_KEY]) { bgCache = changes[BG_KEY].newValue || null; applyBackground(); }
  });

  $('#addGroup').addEventListener('click', () => editGroup());
  $('#panelAdd').addEventListener('click', () => editLink());
  $('#pinDock').addEventListener('click', async () => {
    data.settings.dockPinned = !data.settings.dockPinned;
    await saveData(data);
  });
  $('#editLayout').addEventListener('click', () => setEditing(!editing));
  $('#doneEdit').addEventListener('click', () => setEditing(false));
  $('#addWidget').addEventListener('click', openWidgetPicker);
  setupPanelBehaviour();
  setupExternalDrop();

  const m = location.hash.match(/item=([\w]+)/);
  if (m) {
    const it = items.find((x) => x.id === m[1]);
    if (it) openItemDialog(it);
    history.replaceState(null, '', location.pathname);
  }
}

// ---------- Aparência ----------
function applySettings() {
  const s = data.settings;
  const root = document.documentElement.style;
  root.setProperty('--cols', s.columns);
  root.setProperty('--radius', s.tileRadius + 'px');
  root.setProperty('--dim', s.bgDim);
  root.setProperty('--bg-color', s.bgColor);
  const b = document.body.classList;
  ['left', 'right', 'top', 'bottom'].forEach((p) => b.toggle('dock-' + p, s.dockPosition === p));
  const lateral = s.dockPosition === 'left' || s.dockPosition === 'right';
  b.toggle('pinned', lateral && s.dockPinned);
  $('#pinDock').classList.toggle('on', s.dockPinned);
  $('#hero').hidden = !s.showClock;
  $('#omniWrap').hidden = !s.showSearch;
  $('#omni').placeholder = `Pesquisar atalhos, notas ou no ${(SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.google).name}…  (Ctrl+K)`;
  $('#addGroup').hidden = !s.showAddButtons;
  $('#panelAdd').hidden = !s.showAddButtons;
  if (lateral && s.dockPinned) openPanel(activeId, true);
  applyBackground();
}

function applyBackground() {
  const want = bgCache && data.settings.bgEnabled ? bgCache : null;
  if (want === applyBackground.last) return;
  applyBackground.last = want;
  $('#bg').style.backgroundImage = want ? `url("${want}")` : 'none';
}

function setupClock() {
  const tick = () => {
    const d = new Date();
    $('#clock').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const hr = d.getHours();
    const hello = hr < 5 ? 'Boa madrugada' : hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
    const name = data.settings.userName ? `, ${data.settings.userName}` : '';
    $('#greet').textContent = `${hello}${name} · ${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  };
  tick();
  setInterval(tick, 10_000);
}

// =====================================================================
// BARRA DE ATALHOS
// =====================================================================
let panelGroup = null;
let sticky = false;
let closeTimer;
let openTimer;

function renderDock() {
  const box = $('#railGroups');
  box.replaceChildren();
  const horizontal = ['top', 'bottom'].includes(data.settings.dockPosition);
  for (const g of data.groups) {
    const n = data.links.filter((l) => l.groupId === g.id).length;
    const b = h('button', { class: 'rail-btn' + (g.id === panelGroup ? ' active' : ''), title: `${g.name} (${n})`, draggable: true },
      h('span', { class: 'ico' }, g.icon),
      horizontal && h('span', { class: 'lbl' }, g.name),
    );
    b.addEventListener('mouseenter', () => {
      clearTimeout(openTimer);
      openTimer = setTimeout(() => openPanel(g.id), panelGroup ? 60 : 160);
    });
    b.addEventListener('mouseleave', () => clearTimeout(openTimer));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panelGroup === g.id && sticky && !isPinned()) { closePanel(true); return; }
      sticky = true;
      openPanel(g.id);
    });
    b.addEventListener('contextmenu', (e) => showCtx(e, [
      ['✎ Editar grupo', () => editGroup(g)],
      ['＋ Adicionar atalho aqui', () => { openPanel(g.id); editLink(); }],
      '-',
      ['🗑 Excluir grupo', () => deleteGroup(g), 'danger'],
    ]));
    b.addEventListener('dragstart', (e) => { drag = { type: 'group', id: g.id }; e.dataTransfer.setData('text/x-neurotab', g.id); });
    b.addEventListener('dragend', () => { drag = null; clearDropMarks(); });
    b.addEventListener('dragover', (e) => {
      if (!drag || drag.type === 'widget') return;
      e.preventDefault();
      clearDropMarks();
      b.classList.add('drop-target');
      if (drag.type === 'link') { clearTimeout(openTimer); openTimer = setTimeout(() => openPanel(g.id), 600); }
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop-target'));
    b.addEventListener('drop', async (e) => {
      e.preventDefault();
      clearDropMarks();
      if (!drag) return;
      if (drag.type === 'link') {
        const l = data.links.find((x) => x.id === drag.id);
        if (l && l.groupId !== g.id) {
          data.links.splice(data.links.indexOf(l), 1);
          l.groupId = g.id;
          data.links.push(l);
          await commit();
          toast(`Movido para ${g.icon} ${g.name}`);
        }
      } else if (drag.type === 'group' && drag.id !== g.id) {
        const r = b.getBoundingClientRect();
        const after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
        moveItem(data.groups, drag.id, g.id, after);
        await commit();
      }
      drag = null;
    });
    box.appendChild(b);
  }
  if (panelGroup) renderPanel();
}

const isPinned = () => data.settings.dockPinned && ['left', 'right'].includes(data.settings.dockPosition);

function openPanel(groupId, quiet) {
  clearTimeout(closeTimer);
  if (!data.groups.some((g) => g.id === groupId)) groupId = data.groups[0].id;
  panelGroup = groupId;
  if (activeId !== groupId) {
    activeId = groupId;
    if (!quiet) chrome.storage.local.set({ [ACTIVE_KEY]: groupId });
  }
  $('#panel').hidden = false;
  $$('#railGroups .rail-btn').forEach((b, i) => b.classList.toggle('active', data.groups[i]?.id === groupId));
  renderPanel();
}

function closePanel(force) {
  if (isPinned()) return;
  if (sticky && !force) return;
  sticky = false;
  panelGroup = null;
  $('#panel').hidden = true;
  $$('#railGroups .rail-btn').forEach((b) => b.classList.remove('active'));
}

function setupPanelBehaviour() {
  const dock = $('#dock');
  dock.addEventListener('mouseleave', () => {
    clearTimeout(openTimer);
    if (drag || isPinned() || sticky) return;
    closeTimer = setTimeout(() => closePanel(), 350);
  });
  dock.addEventListener('mouseenter', () => clearTimeout(closeTimer));
  document.addEventListener('click', (e) => {
    if (!dock.contains(e.target) && !e.target.closest('dialog, .ctx')) closePanel(true);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) closePanel(true); });
}

function renderPanel() {
  const g = data.groups.find((x) => x.id === panelGroup);
  if (!g) return;
  $('#panelTitle').textContent = `${g.icon} ${g.name}`;
  const box = $('#panelLinks');
  box.replaceChildren();
  const links = data.links.filter((l) => l.groupId === g.id);
  const target = data.settings.openInNewTab ? '_blank' : '_self';
  for (const l of links) {
    const img = h('img', { alt: '', src: ctx.faviconFor(l) });
    img.onerror = () => { img.style.visibility = 'hidden'; };
    const a = h('a', { class: 'plink', href: l.url, target, title: l.url, draggable: true, style: { '--c': l.color } },
      img,
      h('span', { class: 't' }, l.title),
      h('span', { class: 'tools' },
        h('button', { title: 'Editar', onclick: (e) => { e.preventDefault(); e.stopPropagation(); editLink(l); } }, '✎'),
        h('button', { title: 'Excluir', onclick: (e) => { e.preventDefault(); e.stopPropagation(); deleteLink(l); } }, '✕'),
      ),
    );
    a.addEventListener('contextmenu', (e) => showCtx(e, [
      ['↗ Abrir em nova aba', () => window.open(l.url, '_blank')],
      ['✎ Editar', () => editLink(l)],
      ['⧉ Duplicar', () => duplicateLink(l)],
      ['🎨 Atualizar ícone e cor', () => refreshFavicon(l)],
      ['🧠 Salvar no cérebro', async () => { await ctx.capture({ type: 'page', title: l.title, url: l.url }); toast('Salvo no cérebro'); }],
      '-',
      ['🗑 Excluir', () => deleteLink(l), 'danger'],
    ]));
    a.addEventListener('dragstart', (e) => {
      drag = { type: 'link', id: l.id };
      a.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-neurotab', l.id);
    });
    a.addEventListener('dragend', () => { drag = null; a.classList.remove('dragging'); clearDropMarks(); });
    a.addEventListener('dragover', (e) => {
      if (drag?.type !== 'link' || drag.id === l.id) return;
      e.preventDefault();
      const r = a.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      clearDropMarks();
      a.classList.add(after ? 'drop-after' : 'drop-before');
    });
    a.addEventListener('drop', async (e) => {
      if (drag?.type !== 'link') return;
      e.preventDefault();
      e.stopPropagation();
      const after = a.classList.contains('drop-after');
      clearDropMarks();
      const moving = data.links.find((x) => x.id === drag.id);
      if (moving) moving.groupId = l.groupId;
      moveItem(data.links, drag.id, l.id, after);
      drag = null;
      await commit();
    });
    box.appendChild(a);
  }
  $('#panelEmpty').hidden = links.length > 0;
}

// ---------- Ações de atalhos e grupos ----------
async function commit() {
  await saveData(data);
  renderDock();
}

function moveItem(arr, fromId, toId, after) {
  const from = arr.findIndex((x) => x.id === fromId);
  if (from < 0) return;
  const [item] = arr.splice(from, 1);
  let to = arr.findIndex((x) => x.id === toId);
  if (to < 0) { arr.push(item); return; }
  if (after) to += 1;
  arr.splice(to, 0, item);
}

function clearDropMarks() {
  $$('.drop-before,.drop-after,.drop-target').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-target'));
}

async function deleteLink(l) {
  const idx = data.links.indexOf(l);
  data.links.splice(idx, 1);
  await commit();
  toast(`"${l.title}" excluído`, 'Desfazer', async () => { data.links.splice(idx, 0, l); await commit(); });
}

async function duplicateLink(l) {
  data.links.splice(data.links.indexOf(l) + 1, 0, { ...l, id: uid(), title: l.title + ' (cópia)' });
  await commit();
}

async function refreshFavicon(l) {
  Object.assign(l, await inspectFavicon(l.url));
  await commit();
  toast('Ícone e cor atualizados');
}

async function deleteGroup(g) {
  if (data.groups.length === 1) return toast('É preciso ter pelo menos um grupo.');
  const count = data.links.filter((l) => l.groupId === g.id).length;
  if (!confirm(`Excluir o grupo "${g.name}"${count ? ` e seus ${count} atalhos` : ''}?`)) return;
  const snapshot = structuredClone({ groups: data.groups, links: data.links });
  data.groups = data.groups.filter((x) => x.id !== g.id);
  data.links = data.links.filter((l) => l.groupId !== g.id);
  if (panelGroup === g.id) closePanel(true);
  await commit();
  toast(`Grupo "${g.name}" excluído`, 'Desfazer', async () => { Object.assign(data, snapshot); await commit(); });
}

function editLink(link, preset = {}) {
  const dlg = $('#linkDlg');
  const f = $('#linkForm');
  $('#linkDlgTitle').textContent = link ? 'Editar atalho' : 'Novo atalho';
  f.groupId.replaceChildren(...data.groups.map((g) => new Option(`${g.icon} ${g.name}`, g.id)));
  f.url.value = link?.url || preset.url || '';
  f.title.value = link?.title || preset.title || '';
  f.groupId.value = link?.groupId || panelGroup || activeId;
  f.color.value = cssColorToHex(link?.color || '#3fa0a8');
  let favicon = link?.favicon || '';
  let colorTouched = !!link;
  const preview = () => {
    const p = $('#preview');
    p.style.setProperty('--c', f.color.value);
    const url = normalizeUrl(f.url.value);
    p.querySelector('.pill span').textContent = f.title.value || hostOf(url) || 'Título';
    const img = p.querySelector('img');
    img.style.display = '';
    img.src = favicon || (url ? faviconUrl(url) : '../icons/icon32.png');
  };
  const autoColor = async () => {
    const url = normalizeUrl(f.url.value);
    if (!url) return;
    const info = await inspectFavicon(url);
    favicon = info.favicon;
    f.color.value = info.color;
    preview();
  };
  f.oninput = (e) => {
    if (e.target === f.color) colorTouched = true;
    if (e.target === f.url) favicon = '';
    preview();
  };
  f.url.onchange = () => { if (!colorTouched) autoColor(); };
  $('#autoColor').onclick = () => { colorTouched = true; autoColor(); };
  preview();
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const url = normalizeUrl(f.url.value);
    if (!url) return;
    if (!favicon || (link && url !== link.url)) favicon = (await inspectFavicon(url)).favicon;
    const values = { url, title: f.title.value.trim() || hostOf(url), groupId: f.groupId.value, color: f.color.value, favicon };
    if (link) {
      const moved = link.groupId !== values.groupId;
      Object.assign(link, values);
      if (moved) { data.links.splice(data.links.indexOf(link), 1); data.links.push(link); }
    } else data.links.push({ id: uid(), ...values });
    await commit();
  };
  dlg.returnValue = '';
  dlg.showModal();
  f.url.focus();
}

function editGroup(group) {
  const dlg = $('#groupDlg');
  const f = $('#groupForm');
  $('#groupDlgTitle').textContent = group ? 'Editar grupo' : 'Novo grupo';
  f.name.value = group?.name || '';
  f.icon.value = group?.icon || '📁';
  $('#emojiPick').replaceChildren(...EMOJIS.map((em) => h('button', { type: 'button', onclick: () => { f.icon.value = em; } }, em)));
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const name = f.name.value.trim();
    if (!name) return;
    const icon = f.icon.value.trim() || '📁';
    if (group) Object.assign(group, { name, icon });
    else {
      const g = { id: uid(), name, icon };
      data.groups.push(g);
      sticky = true;
      panelGroup = g.id;
    }
    await commit();
    if (panelGroup) openPanel(panelGroup);
  };
  dlg.returnValue = '';
  dlg.showModal();
  f.name.focus();
}

function setupExternalDrop() {
  const panel = $('#panel');
  panel.addEventListener('dragover', (e) => {
    if (!drag && [...e.dataTransfer.types].includes('text/uri-list')) e.preventDefault();
  });
  panel.addEventListener('drop', async (e) => {
    if (drag) return;
    const url = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find((x) => x && !x.startsWith('#'));
    if (!url) return;
    e.preventDefault();
    data.links.push({ id: uid(), groupId: panelGroup || activeId, title: hostOf(url), url, ...(await inspectFavicon(url)) });
    await commit();
    toast('Atalho adicionado');
  });
}

// =====================================================================
// BUSCA UNIVERSAL (Ctrl+K)
// =====================================================================
function setupOmni() {
  const input = $('#omni');
  const box = $('#omniResults');
  $('#omniMicSlot').append(micButton(input, { lang: data.settings.voiceLang, title: 'Falar' }));
  let results = [];
  let sel = 0;

  const run = (r) => {
    box.hidden = true;
    input.blur();
    r.action();
  };

  const render = () => {
    const q = input.value.trim();
    if (!q) { box.hidden = true; return; }
    const fq = Brain.fold(q);
    const links = data.links.filter((l) => Brain.fold(l.title + ' ' + l.url).includes(fq)).slice(0, 6);
    const notes = Brain.searchItems(items, q, 5);
    const eng = SEARCH_ENGINES[data.settings.searchEngine] || SEARCH_ENGINES.google;
    results = [];
    const sections = [];
    if (links.length) sections.push(['Atalhos', links.map((l) => ({ icon: h('img', { src: ctx.faviconFor(l), alt: '' }), label: l.title, sub: hostOf(l.url), action: () => { location.href = l.url; } }))]);
    if (notes.length) sections.push(['Cérebro', notes.map((it) => ({ icon: Brain.TYPES[it.type]?.icon, label: Brain.displayTitle(it), sub: Brain.relTime(it.createdAt), action: () => openItemDialog(it) }))]);
    const acts = [];
    if (/^(https?:\/\/|www\.)|^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(q) && !/\s/.test(q)) acts.push({ icon: '↗', label: `Abrir ${q}`, action: () => { location.href = normalizeUrl(q); } });
    acts.push({ icon: '🔎', label: `Pesquisar "${q}" no ${eng.name}`, action: () => { location.href = eng.url + encodeURIComponent(q); } });
    acts.push({ icon: '🤖', label: `Perguntar ao cérebro: "${q}"`, action: () => askBrain(q) });
    acts.push({ icon: '📝', label: `Salvar como nota`, sub: 'Shift+Enter', action: async () => { await ctx.capture({ text: q, source: 'manual' }); input.value = ''; toast('Salvo no cérebro 🧠'); } });
    sections.push(['Ações', acts]);
    box.replaceChildren();
    for (const [title, list] of sections) {
      box.append(h('div', { class: 'sec' }, title));
      for (const r of list) {
        const i = results.length;
        results.push(r);
        box.append(h('div', { class: 'omni-item', 'data-i': i, onmousedown: (e) => { e.preventDefault(); run(r); } },
          typeof r.icon === 'string' ? h('span', {}, r.icon) : r.icon,
          h('span', {}, r.label),
          r.sub && h('span', { class: 'sub' }, r.sub)));
      }
    }
    // Sem atalhos/notas, a ação padrão é pesquisar na web.
    sel = links.length || notes.length ? 0 : results.findIndex((r) => r.icon === '🔎' || r.icon === '↗');
    if (results[0]?.icon === '↗') sel = results.findIndex((r) => r.icon === '↗');
    highlight();
    box.hidden = false;
  };
  const highlight = () => $$('.omni-item', box).forEach((el, i) => el.classList.toggle('sel', i === sel));

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, results.length - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const q = input.value.trim();
      if (q) { await ctx.capture({ text: q }); input.value = ''; box.hidden = true; toast('Salvo no cérebro 🧠'); }
    } else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); run(results[sel]); }
    else if (e.key === 'Escape') { input.value = ''; box.hidden = true; input.blur(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
    else if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) { e.preventDefault(); input.focus(); }
  });
}

function askBrain(q) {
  if (!data.settings.widgets.some((w) => w.id === 'ask')) {
    data.settings.widgets.unshift({ id: 'ask', size: 'l' });
    saveData(data).then(() => { renderWidgets(); setTimeout(() => listeners.ask.forEach((fn) => fn(q)), 50); });
    return;
  }
  listeners.ask.forEach((fn) => fn(q));
}

// =====================================================================
// WIDGETS
// =====================================================================
function renderWidgets() {
  mounted.forEach((m) => { try { m.destroy?.(); } catch {} });
  mounted = [];
  const box = $('#widgets');
  box.replaceChildren();
  const list = data.settings.widgets.filter((w) => WIDGETS[w.id]);
  list.forEach((w, idx) => {
    const def = WIDGETS[w.id];
    const actions = h('div', { class: 'wact' });
    const body = h('div', { class: 'wbody' });
    const sizeBtn = (s, label) => h('button', { class: w.size === s ? 'sel' : '', title: { s: 'Pequeno', m: 'Médio', l: 'Largo' }[s], onclick: () => setWidget(idx, { size: s }) }, label);
    const card = h('article', { class: `widget size-${w.size || def.defaultSize || 'm'}`, 'data-id': w.id, draggable: editing },
      h('header', {},
        h('span', { class: 'wt' }, def.icon, ' ', def.title),
        actions,
        h('div', { class: 'wtools' },
          sizeBtn('s', 'P'), sizeBtn('m', 'M'), sizeBtn('l', 'G'),
          h('button', { title: 'Remover', onclick: () => removeWidget(idx) }, '✕'),
        ),
      ),
      body,
    );
    card.addEventListener('dragstart', (e) => { if (!editing) return e.preventDefault(); drag = { type: 'widget', id: idx }; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { drag = null; card.classList.remove('dragging'); clearDropMarks(); });
    card.addEventListener('dragover', (e) => { if (drag?.type === 'widget' && drag.id !== idx) { e.preventDefault(); card.classList.add('drop-target'); } });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', async (e) => {
      if (drag?.type !== 'widget') return;
      e.preventDefault();
      const arr = data.settings.widgets;
      const [moved] = arr.splice(drag.id, 1);
      arr.splice(idx, 0, moved);
      drag = null;
      await saveData(data);
      renderWidgets();
    });
    box.append(card);
    try {
      const wctx = Object.assign(Object.create(ctx), { actions, widget: w, saveWidget: (patch) => setWidget(idx, patch, true) });
      const inst = def.mount(body, wctx);
      mounted.push({ id: w.id, destroy: inst?.destroy });
    } catch (err) {
      console.error(err);
      body.append(h('p', { class: 'muted' }, 'Erro ao carregar este widget.'));
    }
  });
  if (!list.length) {
    box.append(h('p', { class: 'muted', style: { gridColumn: 'span 12', textAlign: 'center' } }, 'Nenhum widget. Clique em 🧩 na barra para adicionar.'));
  }
}

async function setWidget(idx, patch, silent) {
  Object.assign(data.settings.widgets[idx], patch);
  await saveData(data);
  if (!silent) renderWidgets();
}

async function removeWidget(idx) {
  data.settings.widgets.splice(idx, 1);
  await saveData(data);
  renderWidgets();
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  $('#editBar').hidden = !on;
  $('#editLayout').classList.toggle('on', on);
  $$('.widget').forEach((w) => { w.draggable = on; });
}

function openWidgetPicker() {
  const dlg = $('#widgetDlg');
  const used = new Set(data.settings.widgets.map((w) => w.id));
  const list = $('#widgetList');
  list.replaceChildren(...Object.values(WIDGETS).map((def) => h('button', {
    type: 'button',
    disabled: used.has(def.id) && !def.multiple,
    onclick: async () => {
      data.settings.widgets.push({ id: def.id, size: def.defaultSize || 'm' });
      await saveData(data);
      renderWidgets();
      dlg.close();
    },
  }, h('span', { class: 'wi' }, def.icon), h('span', {}, h('b', {}, def.title), h('small', {}, used.has(def.id) ? 'Já está na tela' : def.description)))));
  dlg.showModal();
}

// =====================================================================
// ITEM DO CÉREBRO (editar/criar)
// =====================================================================
function openItemDialog(item, preset = {}) {
  const dlg = $('#itemDlg');
  const f = $('#itemForm');
  const it = item || Brain.makeItem(preset);
  f.type.replaceChildren(...Object.entries(Brain.TYPES).map(([k, t]) => new Option(`${t.icon} ${t.label}`, k)));
  const fill = (x) => {
    f.type.value = x.type;
    f.title.value = x.title || '';
    f.text.value = x.text || '';
    f.tags.value = (x.tags || []).join(', ');
    f.remindAt.value = toLocalInput(x.remindAt);
    f.url.value = x.url || '';
    f.done.checked = !!x.done;
    f.pinned.checked = !!x.pinned;
    $('#itemDlgTitle').textContent = item ? 'Editar' : 'Novo item';
    $('#itemMeta').textContent = item
      ? `Criado ${Brain.relTime(x.createdAt)} · origem: ${({ manual: 'digitado', voice: 'voz', context: 'botão direito', popup: 'página', keep: 'Google Keep' })[x.source] || x.source}${x.summary ? ' · Resumo: ' + x.summary : ''}`
      : '';
  };
  fill(it);
  $('#itemDelete').hidden = !item;
  const read = () => ({
    type: f.type.value,
    title: f.title.value.trim(),
    text: f.text.value.trim(),
    tags: f.tags.value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
    remindAt: fromLocalInput(f.remindAt.value),
    url: f.url.value.trim(),
    done: f.done.checked,
    pinned: f.pinned.checked,
  });
  $('#itemAi').onclick = async () => {
    if (!isConfigured(data.settings)) { toast('Configure a IA em Configurações → IA'); return; }
    const btn = $('#itemAi');
    btn.disabled = true;
    btn.textContent = '✨ Organizando…';
    try {
      const cur = { ...it, ...read(), title: '' };
      const patch = await enrich(data.settings, cur);
      fill({ ...cur, ...patch, title: patch.title || read().title, type: patch.type || cur.type });
      if (patch.summary) $('#itemMeta').textContent = 'Resumo: ' + patch.summary;
      it.summary = patch.summary || it.summary;
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Organizar com IA';
    }
  };
  $('#itemDelete').onclick = async () => {
    dlg.close('cancel');
    const r = await Brain.deleteItem(it.id);
    if (r) toast('Item excluído', 'Desfazer', () => Brain.restoreItem(r.removed, r.idx));
  };
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const v = read();
    if (!v.text && !v.title && !v.url) return;
    if (item) await Brain.updateItem(it.id, { ...v, summary: it.summary });
    else await ctx.capture({ ...preset, ...v });
  };
  dlg.returnValue = '';
  dlg.showModal();
  (item ? f.text : f.text).focus();
}
