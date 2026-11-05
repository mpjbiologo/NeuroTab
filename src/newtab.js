// NeuroTab — nova aba: barra de atalhos + centro com o segundo cérebro.
import {
  DATA_KEY, BG_KEY, ACTIVE_KEY, BRAIN_KEY, SEARCH_ENGINES,
  loadData, saveData, loadBg, uid, hostOf, normalizeUrl, faviconUrl, inspectFavicon, cssColorToHex,
} from './lib/store.js';
import * as Brain from './lib/brain.js';
import { isConfigured, enrich } from './lib/ai.js';
import { $, $$, h, toast, showCtx, micButton, toLocalInput, fromLocalInput, startDictation, hasDictation, speak } from './lib/ui.js';
import { runCommand, tasksSummary } from './lib/assistant.js';
import { ask as aiAsk } from './lib/ai.js';
import { looksLikeMath, smartCalc } from './lib/calc.js';
import { UPDATE_KEY, WHATSNEW_KEY, cmpVersion } from './lib/update.js';
import { WHATS_NEW } from './whatsnew.js';
import { WIDGETS } from './widgets/index.js';

const EMOJIS = ['🏠','⭐','📁','🚀','🎓','💲','💼','🤖','🎮','📚','🍺','🥗','🎬','🎵','🛒','💻','🔗','🧪','🧬','📰','✈️','⚙️','❤️','📷'];

let data;
let items = [];
let activeId;
let bgCache = null;
// Relógio e busca: referências fixas (no modo livre eles mudam de lugar no DOM).
const heroEl = document.getElementById('hero');
const omniEl = document.getElementById('omniWrap');
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
  openLinkDialog: (link, preset) => editLink(link, preset),
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
      data = await loadData();
      if (!data.groups.some((g) => g.id === activeId)) activeId = data.groups[0].id;
      applySettings();
      renderDock();
      if (layoutSig() !== widgetsSig) renderWidgets();
      if (editing) renderLayoutPicker();
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
  setupLayouts();
  setupPanelBehaviour();
  let rz;
  let lastNarrow = innerWidth < 700;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const narrow = innerWidth < 700;
      if (narrow !== lastNarrow) { lastNarrow = narrow; applySettings(); renderDock(); }
      const freeNow = isFree();
      if (freeNow !== document.body.classList.contains('free')) renderWidgets();
      else if (freeNow) repositionFree();
      else if (layoutCols() !== gridCols) renderWidgets();
    }, 150);
  });
  setupUpdates();
  setupVoice();
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
  const pos = dockPos();
  ['left', 'right', 'top', 'bottom'].forEach((p) => b.toggle('dock-' + p, pos === p));
  b.toggle('narrow', innerWidth < 700);
  const lateral = pos === 'left' || pos === 'right';
  b.toggle('pinned', lateral && s.dockPinned);
  $('#pinDock').classList.toggle('on', s.dockPinned);
  heroEl.hidden = !s.showClock;
  omniEl.hidden = !s.showSearch;
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
  const horizontal = ['top', 'bottom'].includes(dockPos());
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

// Em janelas estreitas a barra vai para o rodapé.
const dockPos = () => (innerWidth < 700 ? 'bottom' : data.settings.dockPosition);
const isPinned = () => data.settings.dockPinned && ['left', 'right'].includes(dockPos());

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
    if (looksLikeMath(q) || /^-?[\d.,]+\s*\S+(\s\S+)?\s+(em|para)\s+\S+$/i.test(q) || /^dias?\s(ate|até|desde)\s/i.test(q)) {
      const calcItem = { icon: '🧮', label: `${q} = …`, sub: 'Enter copia', action: async () => { if (calcItem.value != null) { await navigator.clipboard.writeText(String(calcItem.value)); toast('Resultado copiado'); } } };
      acts.push(calcItem);
      smartCalc(q).then((r) => {
        calcItem.value = Number.isFinite(r.value) ? String(r.value).replace('.', ',') : r.text;
        calcItem.label = r.text.includes('=') || /faltam|dias/i.test(r.text) ? r.text : `${q} = ${r.text}`;
        const el = box.querySelector(`[data-i="${results.indexOf(calcItem)}"] span:nth-child(2)`);
        if (el && input.value.trim() === q) el.textContent = calcItem.label;
      }).catch(() => { calcItem.label = `${q} = ?`; });
    }
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
    sel = links.length || notes.length ? 0 : results.findIndex((r) => ['🧮', '↗', '🔎'].includes(r.icon));
    if (results.some((r) => r.icon === '🧮') && !links.length) sel = results.findIndex((r) => r.icon === '🧮');
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
// WIDGETS (redimensionáveis, responsivos, layouts salvos)
// =====================================================================
let widgetsSig = '';
let gridCols = 12;

function layoutCols() {
  const w = $('#widgets').clientWidth || innerWidth;
  return w >= 1000 ? 12 : w >= 620 ? 6 : 1;
}

function spanFor(w) {
  if (gridCols === 12) return w;
  if (gridCols === 6) return w >= 7 ? 6 : 3;
  return 1;
}

// ---------- Modo de layout ----------
const isFree = () => data.settings.layoutMode === 'free' && innerWidth >= 700;
const layoutSig = (s = data.settings) => JSON.stringify([s.widgets, s.freeFixed, s.layoutMode]);
let zTop = 10;

function buildCard(w, idx) {
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

function mountCard({ def, body, actions }, w, idx) {
  try {
    const wctx = Object.assign(Object.create(ctx), { actions, saveWidget: (patch) => setWidget(idx, patch, true) });
    Object.defineProperty(wctx, 'widget', { get: () => data.settings.widgets[idx] || w });
    const inst = def.mount(body, wctx);
    mounted.push({ id: w.id, destroy: inst?.destroy });
  } catch (err) {
    console.error(err);
    body.append(h('p', { class: 'muted' }, 'Erro ao carregar este widget.'));
  }
}

function renderWidgets() {
  mounted.forEach((m) => { try { m.destroy?.(); } catch {} });
  mounted = [];
  $('#center').prepend(heroEl, omniEl); // tira de dentro dos quadros antes de redesenhar
  widgetsSig = layoutSig();
  const free = isFree();
  document.body.classList.toggle('free', free);
  if (editing) paintModeButtons();
  if (free) renderFree();
  else renderGrid();
}

// =====================================================================
// GRADE
// =====================================================================
function renderGrid() {
  const center = $('#center');
  const box = $('#widgets');
  box.replaceChildren();
  box.style.height = '';
  gridCols = layoutCols();
  box.style.gridTemplateColumns = `repeat(${gridCols}, minmax(0, 1fr))`;
  const list = data.settings.widgets;
  list.forEach((w, idx) => {
    if (!WIDGETS[w.id]) return;
    const parts = buildCard(w, idx);
    const { card, grip } = parts;
    card.draggable = editing;
    applyWidgetSize(card, w);
    setupResize(card, grip, idx);
    card.addEventListener('dragstart', (e) => { if (!editing || e.target !== card) return e.preventDefault(); drag = { type: 'widget', id: idx }; card.classList.add('dragging'); });
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
      await saveWidgets();
      renderWidgets();
    });
    box.append(card);
    mountCard(parts, w, idx);
  });
  if (!list.length) {
    box.append(h('p', { class: 'muted', style: { gridColumn: '1 / -1', textAlign: 'center' } }, 'Nenhum widget. Clique em 🧩 na barra para adicionar.'));
  }
}

// =====================================================================
// LIVRE — widgets em qualquer lugar da tela
// =====================================================================
const FIXED = {
  _hero: { el: () => heroEl, label: '🕐 Relógio', def: { fx: 0.3, fy: 10, fw: 0.4 }, show: () => data.settings.showClock },
  _search: { el: () => omniEl, label: '🔎 Busca', def: { fx: 0.22, fy: 170, fw: 0.56 }, show: () => data.settings.showSearch },
};

function renderFree() {
  const box = $('#widgets');
  box.replaceChildren();
  box.style.gridTemplateColumns = '';
  const W = box.clientWidth;
  const s = data.settings;
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
      save: async (p) => { data.settings.freeFixed = { ...(data.settings.freeFixed || {}), [key]: p }; await saveWidgets(); },
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
    zTop = Math.max(zTop, w.fz || 0);
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
  fitCanvas();
}

function placeFrame(frame, p, W, fixedHeight) {
  frame.style.left = Math.round(p.fx * W) + 'px';
  frame.style.top = Math.round(p.fy) + 'px';
  frame.style.width = Math.round(Math.min(W, p.fw * W)) + 'px';
  if (fixedHeight) frame.style.height = Math.round(p.fh || 320) + 'px';
  if (p.fz) frame.style.zIndex = p.fz;
}

function repositionFree() {
  const box = $('#widgets');
  const W = box.clientWidth;
  for (const frame of $$('.free-item', box)) {
    if (frame.dataset.fixed) placeFrame(frame, { ...FIXED[frame.dataset.fixed].def, ...(data.settings.freeFixed?.[frame.dataset.fixed] || {}) }, W, false);
    else {
      const w = data.settings.widgets[+frame.dataset.idx];
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
function autoPlace(w, W) {
  const fw = Math.min(1, (w.w || WIDGETS[w.id]?.defaultW || 6) / 12);
  const fh = w.fh || 340;
  const rects = $$('#widgets .free-item').map((f) => ({ l: f.offsetLeft, t: f.offsetTop, r: f.offsetLeft + f.offsetWidth, b: f.offsetTop + f.offsetHeight }));
  const width = fw * W;
  for (let y = 0; y < 6000; y += 20) {
    for (let x = 0; x + width <= W + 1; x += Math.max(20, W / 48)) {
      const r = { l: x, t: y, r: x + width, b: y + fh };
      if (!rects.some((o) => r.l < o.r + 12 && r.r > o.l - 12 && r.t < o.b + 12 && r.b > o.t - 12)) return { fx: x / W, fy: y, fw, fh };
    }
  }
  return { fx: 0, fy: 0, fw, fh };
}

let guides = [];
function guide(dir, at) {
  const g = h('div', { class: 'guide guide-' + dir });
  if (dir === 'v') g.style.left = at + 'px'; else g.style.top = at + 'px';
  $('#widgets').append(g);
  guides.push(g);
}
function clearGuides() { guides.forEach((g) => g.remove()); guides = []; }

function snapAxis(cands, targets, th = 8) {
  let best = null;
  for (const c of cands) for (const t of targets) {
    const d = t - c;
    if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
  }
  return best;
}

function attachFree(frame, { handles, grip, fixedHeight, minW = 200, minH = 110, save }) {
  const box = $('#widgets');
  const begin = (e, mode) => {
    if (e.button !== 0) return;
    if (mode === 'move' && e.target.closest('button, input, select, textarea, a, label, .wact, .wtools')) return;
    if (mode === 'move' && frame.classList.contains('free-fixed') && !editing) return;
    e.preventDefault();
    const W = box.clientWidth;
    const r = { x: frame.offsetLeft, y: frame.offsetTop, w: frame.offsetWidth, h: frame.offsetHeight };
    const sx = e.clientX;
    const sy = e.clientY;
    frame.style.zIndex = ++zTop;
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
      const p = { fx: cur.x / W, fy: cur.y, fw: cur.w / W, fz: zTop };
      if (fixedHeight) p.fh = cur.h;
      await save(p);
      fitCanvas();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };
  handles.forEach((hd) => hd.addEventListener('pointerdown', (e) => begin(e, 'move')));
  grip?.addEventListener('pointerdown', (e) => { e.stopPropagation(); begin(e, 'resize'); });
  frame.addEventListener('pointerdown', () => { if (+frame.style.zIndex < zTop) frame.style.zIndex = ++zTop; });
}

/** Converte a grade atual em posições livres, preservando o que se vê. */
function captureGridPositions() {
  const center = $('#center');
  const cs = getComputedStyle(center);
  const c = center.getBoundingClientRect();
  const ox = c.left + parseFloat(cs.paddingLeft);
  const oy = c.top + parseFloat(cs.paddingTop);
  const W = center.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const s = data.settings;
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

async function setLayoutMode(mode) {
  const s = data.settings;
  if (mode === s.layoutMode) return;
  if (mode === 'free') {
    if (s.widgets.some((w) => w.fx == null) || !s.freeFixed?._hero) captureGridPositions();
  }
  s.layoutMode = mode;
  await saveWidgets();
  renderWidgets();
  toast(mode === 'free' ? 'Modo livre: arraste pelo título para qualquer lugar ✨' : 'Modo grade');
}

async function rearrangeFree() {
  if (!confirm('Reorganizar todos os widgets em grade (você pode mover de novo depois)?')) return;
  const s = data.settings;
  s.layoutMode = 'grid';
  document.body.classList.remove('free');
  renderGrid();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  captureGridPositions();
  s.layoutMode = 'free';
  await saveWidgets();
  renderWidgets();
}

function paintModeButtons() {
  const free = data.settings.layoutMode === 'free';
  $('#modeGrid').classList.toggle('sel', !free);
  $('#modeFree').classList.toggle('sel', free);
  $('#rearrange').hidden = !free;
}

function applyWidgetSize(card, w) {
  card.style.gridColumn = `span ${spanFor(w.w || 6)}`;
  if (w.hpx && gridCols > 1) { card.style.height = w.hpx + 'px'; card.style.maxHeight = 'none'; card.classList.add('fixed-h'); }
  else { card.style.height = ''; card.style.maxHeight = ''; card.classList.remove('fixed-h'); }
  const ws = card.querySelector('.wsize');
  if (ws) ws.textContent = `${w.w}/12`;
}

function setupResize(card, grip, idx) {
  grip.addEventListener('dblclick', () => setWidget(idx, { hpx: null }));
  grip.addEventListener('pointerdown', (e) => {
    if (gridCols === 1) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const box = $('#widgets');
    const gap = parseFloat(getComputedStyle(box).columnGap) || 16;
    const colW = (box.clientWidth - gap * (gridCols - 1)) / gridCols;
    const r0 = card.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: r0.width, h: r0.height };
    const w = { ...data.settings.widgets[idx] };
    card.classList.add('resizing');
    const move = (ev) => {
      const width = start.w + (ev.clientX - start.x);
      let span = Math.round((width + gap) / (colW + gap));
      span = Math.max(gridCols === 12 ? 3 : 3, Math.min(gridCols, span));
      w.w = gridCols === 12 ? span : span >= 6 ? 12 : 6;
      w.hpx = Math.max(140, Math.min(1200, Math.round((start.h + (ev.clientY - start.y)) / 10) * 10));
      applyWidgetSize(card, w);
    };
    const up = async () => {
      grip.removeEventListener('pointermove', move);
      card.classList.remove('resizing');
      if (Math.abs(w.hpx - start.h) < 12) w.hpx = data.settings.widgets[idx].hpx || null;
      await setWidget(idx, { w: w.w, hpx: w.hpx }, true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
    grip.addEventListener('pointercancel', up, { once: true });
  });
}

async function saveWidgets() {
  widgetsSig = layoutSig();
  await saveData(data);
}

async function setWidget(idx, patch, silent) {
  const w = data.settings.widgets[idx];
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

async function removeWidget(idx) {
  data.settings.widgets.splice(idx, 1);
  await saveWidgets();
  renderWidgets();
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  $('#editBar').hidden = !on;
  $('#editLayout').classList.toggle('on', on);
  $$('.widget:not(.free-item)').forEach((w) => { w.draggable = on; });
  if (on) { renderLayoutPicker(); paintModeButtons(); }
}

// ---------- Layouts salvos ----------
function renderLayoutPicker() {
  const s = data.settings;
  const sel = $('#layoutSel');
  const opts = [new Option('— Layout atual —', '')];
  for (const l of s.layouts) opts.push(new Option(l.name, l.id));
  sel.replaceChildren(...opts);
  sel.value = s.layouts.some((l) => l.id === s.activeLayout) ? s.activeLayout : '';
  $('#layoutDel').hidden = !sel.value;
}

function setupLayouts() {
  $('#layoutSel').addEventListener('change', async (e) => {
    const s = data.settings;
    const cur = s.layouts.find((l) => l.id === s.activeLayout);
    if (cur) Object.assign(cur, { widgets: structuredClone(s.widgets), mode: s.layoutMode, freeFixed: structuredClone(s.freeFixed || {}) }); // guarda o layout que estava aberto
    const next = s.layouts.find((l) => l.id === e.target.value);
    if (next) {
      s.widgets = structuredClone(next.widgets);
      if (next.mode) s.layoutMode = next.mode;
      if (next.freeFixed) s.freeFixed = structuredClone(next.freeFixed);
    }
    s.activeLayout = next ? next.id : '';
    await saveWidgets();
    renderWidgets();
    renderLayoutPicker();
    if (next) toast(`Layout "${next.name}"`);
  });
  $('#layoutSave').addEventListener('click', async () => {
    const s = data.settings;
    const name = prompt('Nome do layout (ex.: Trabalho, Casa, Estudos):', s.layouts.find((l) => l.id === s.activeLayout)?.name || '');
    if (!name?.trim()) return;
    let l = s.layouts.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    const snap = { widgets: structuredClone(s.widgets), mode: s.layoutMode, freeFixed: structuredClone(s.freeFixed || {}) };
    if (l) Object.assign(l, snap);
    else { l = { id: uid(), name: name.trim(), ...snap }; s.layouts.push(l); }
    s.activeLayout = l.id;
    await saveWidgets();
    renderLayoutPicker();
    toast(`Layout "${l.name}" salvo`);
  });
  $('#modeGrid').addEventListener('click', () => setLayoutMode('grid'));
  $('#modeFree').addEventListener('click', () => setLayoutMode('free'));
  $('#rearrange').addEventListener('click', rearrangeFree);
  $('#layoutDel').addEventListener('click', async () => {
    const s = data.settings;
    const l = s.layouts.find((x) => x.id === s.activeLayout);
    if (!l || !confirm(`Excluir o layout "${l.name}"? Os widgets na tela continuam.`)) return;
    s.layouts = s.layouts.filter((x) => x !== l);
    s.activeLayout = '';
    await saveWidgets();
    renderLayoutPicker();
  });
}

function openWidgetPicker() {
  const dlg = $('#widgetDlg');
  const used = new Set(data.settings.widgets.map((w) => w.id));
  const list = $('#widgetList');
  list.replaceChildren(...Object.values(WIDGETS).map((def) => h('button', {
    type: 'button',
    disabled: used.has(def.id) && !def.multiple,
    onclick: async () => {
      const nw = { id: def.id, w: def.defaultW || 6 };
      if (isFree()) Object.assign(nw, autoPlace(nw, $('#widgets').clientWidth), { fz: ++zTop });
      data.settings.widgets.push(nw);
      await saveWidgets();
      renderWidgets();
      dlg.close();
      $(`.widget[data-idx="${data.settings.widgets.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    if (r) toast('Movido para a lixeira', 'Desfazer', () => Brain.restoreItem(r.removed));
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

// =====================================================================
// ATUALIZAÇÕES E NOVIDADES
// =====================================================================
async function setupUpdates() {
  const paint = async () => {
    const u = (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY];
    const bar = $('#updateBar');
    const cur = chrome.runtime.getManifest().version;
    if (!u || !u.latest || cmpVersion(u.latest, cur) <= 0 || u.dismissed === u.latest || data.settings.checkUpdates === false) { bar.hidden = true; return; }
    bar.replaceChildren(
      h('span', {}, '🎉'),
      h('b', {}, `NeuroTab ${u.latest} disponível`),
      h('span', { class: 'muted' }, `(você usa a ${cur})`),
      h('span', { class: 'grow' }),
      h('a', { class: 'btn', href: u.url, target: '_blank' }, '📄 Novidades'),
      h('a', { class: 'btn primary', href: u.zip, target: '_blank' }, '⬇ Baixar'),
      h('button', { class: 'btn', title: 'Como atualizar', onclick: () => alert('Como atualizar:\n\n1. Baixe e descompacte o neurotab.zip.\n2. Substitua os arquivos na pasta onde a NeuroTab está instalada.\n3. Abra edge://extensions e clique em ↻ (Recarregar) na NeuroTab.\n\nSeus atalhos, notas e configurações são mantidos.') }, '❓'),
      h('button', { class: 'btn', title: 'Dispensar', onclick: async () => { await chrome.storage.local.set({ [UPDATE_KEY]: { ...u, dismissed: u.latest } }); bar.hidden = true; } }, '✕'),
    );
    bar.hidden = false;
  };
  paint();
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c[UPDATE_KEY]) paint(); });

  // Novidades após atualizar
  const v = (await chrome.storage.local.get(WHATSNEW_KEY))[WHATSNEW_KEY];
  const news = v && WHATS_NEW[v];
  if (news) {
    $('#newsTitle').textContent = news.title;
    $('#newsList').replaceChildren(...news.items.map(([i, t, d]) => h('div', {}, h('span', { class: 'ni' }, i), h('div', {}, h('b', {}, t), h('span', {}, d)))));
    $('#newsDlg').showModal();
    await chrome.storage.local.remove(WHATSNEW_KEY);
  }
}

// =====================================================================
// ASSISTENTE DE VOZ
// =====================================================================
let voiceSession = null;

function voiceApi() {
  const eng = SEARCH_ENGINES[data.settings.searchEngine] || SEARCH_ENGINES.google;
  return {
    capture: (p) => ctx.capture(p),
    aiReady: () => isConfigured(data.settings),
    ask: (q) => aiAsk(data.settings, items, q, []),
    open: (url) => { location.href = url; },
    searchUrl: (q) => eng.url + encodeURIComponent(q),
    findLink: (name) => {
      const f = Brain.fold(name).replace(/\s+/g, '');
      return data.links.find((l) => Brain.fold(l.title).replace(/\s+/g, '') === f)
        || data.links.find((l) => Brain.fold(l.title).replace(/\s+/g, '').includes(f))
        || data.links.find((l) => Brain.fold(hostOf(l.url)).includes(f));
    },
    tasksText: () => tasksSummary(items),
    weatherText: async () => {
      const c = (await chrome.storage.local.get('nt_cache_weather')).nt_cache_weather;
      const w = data.settings.weather;
      if (!c?.d || !w) return 'Adicione o widget de clima e escolha sua cidade primeiro.';
      const d = c.d;
      return `Em ${w.name}, agora faz ${Math.round(d.current.temperature_2m)} graus, sensação de ${Math.round(d.current.apparent_temperature)}. Hoje: máxima de ${Math.round(d.daily.temperature_2m_max[0])} e mínima de ${Math.round(d.daily.temperature_2m_min[0])}, com ${d.daily.precipitation_probability_max[0] ?? 0}% de chance de chuva.`;
    },
    quotesText: async (t) => {
      const c = (await chrome.storage.local.get('nt_cache_quotes')).nt_cache_quotes;
      if (!c?.rows?.length) return 'Adicione o widget de cotações para eu saber os valores.';
      let rows = c.rows.filter((r) => !r.err);
      const want = /dolar/.test(t) ? 'USD' : /euro/.test(t) ? 'EUR' : /bitcoin/.test(t) ? 'BTC' : null;
      if (want) rows = rows.filter((r) => r.name === want);
      if (!rows.length) return 'Não tenho essa cotação no widget.';
      return rows.slice(0, 4).map((r) => `${r.sub || r.name}: ${Number(r.price).toLocaleString('pt-BR', { style: 'currency', currency: r.cur || 'BRL' })}, ${r.pct >= 0 ? 'alta' : 'queda'} de ${Math.abs(r.pct || 0).toFixed(1).replace('.', ',')}%`).join('. ') + '.';
    },
  };
}

function setupVoice() {
  const fab = $('#voiceFab');
  fab.hidden = !hasDictation();
  fab.addEventListener('click', () => startVoice());
  $('#voiceClose').addEventListener('click', () => stopVoice(true));
  $('#voice').addEventListener('click', (e) => { if (e.target.id === 'voice') stopVoice(true); });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'm') { e.preventDefault(); voiceSession ? stopVoice() : startVoice(); }
    if (e.key === 'Escape' && !$('#voice').hidden) stopVoice(true);
  });
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'startVoice' && document.visibilityState === 'visible') startVoice(); });
  if (location.hash === '#voice') { history.replaceState(null, '', location.pathname); setTimeout(startVoice, 300); }
}

function startVoice() {
  if (voiceSession) return;
  const ov = $('#voice');
  const heard = $('#voiceHeard');
  const reply = $('#voiceReply');
  ov.hidden = false;
  ov.classList.add('listening');
  heard.textContent = 'Pode falar…';
  heard.classList.add('interim');
  reply.textContent = '';
  speechSynthesis?.cancel();
  let finalText = '';
  let silence;
  voiceSession = startDictation({
    lang: data.settings.voiceLang,
    onText: (fin, interim) => {
      finalText = fin;
      heard.textContent = (fin + ' ' + interim).trim() || 'Pode falar…';
      heard.classList.toggle('interim', !fin);
      clearTimeout(silence);
      silence = setTimeout(() => voiceSession?.stop(), 1600); // termina após pausa
    },
    onEnd: async (fin) => {
      clearTimeout(silence);
      voiceSession = null;
      ov.classList.remove('listening');
      const said = (fin || finalText).trim();
      if (!said) { heard.textContent = 'Não ouvi nada. Toque em 🎙 para tentar de novo.'; setTimeout(() => { if (!voiceSession) ov.hidden = true; }, 2500); return; }
      heard.textContent = `“${said}”`;
      heard.classList.remove('interim');
      reply.textContent = 'Processando…';
      try {
        const r = await runCommand(said, voiceApi());
        reply.textContent = r.reply;
        await speak(r.reply, data.settings);
        setTimeout(() => { if (!voiceSession) ov.hidden = true; }, r.long ? 6000 : 1800);
      } catch (e) {
        reply.textContent = e.message;
        setTimeout(() => { if (!voiceSession) ov.hidden = true; }, 4000);
      }
    },
    onError: (msg) => { reply.textContent = msg; },
  });
  if (!voiceSession) { ov.hidden = true; toast('Reconhecimento de voz indisponível neste navegador.'); }
}

function stopVoice(close) {
  if (voiceSession) voiceSession.stop();
  if (close) { voiceSession = null; $('#voice').hidden = true; speechSynthesis?.cancel(); }
}
