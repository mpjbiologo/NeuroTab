// NeuroTab — página de nova aba.
import {
  DATA_KEY, BG_KEY, ACTIVE_KEY, SEARCH_ENGINES,
  loadData, saveData, loadBg, uid, hostOf, normalizeUrl, faviconUrl, inspectFavicon, cssColorToHex,
} from './lib/store.js';

const $ = (s) => document.querySelector(s);
const EMOJIS = ['🏠','⭐','📁','🚀','🎓','💲','💼','🤖','🎮','📚','🍺','🥗','🎬','🎵','🛒','💻','🔗','🧪','🧬','📰','✈️','⚙️','❤️','📷'];

let data;
let activeId;
let drag = null; // { type: 'link'|'group', id }
let bgCache = null;

// ---------- Inicialização ----------
init();

async function init() {
  data = await loadData();
  const r = await chrome.storage.local.get(ACTIVE_KEY);
  activeId = data.groups.some((g) => g.id === r[ACTIVE_KEY]) ? r[ACTIVE_KEY] : data.groups[0].id;
  bgCache = await loadBg();
  render();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes[DATA_KEY]) {
      data = await loadData();
      if (!data.groups.some((g) => g.id === activeId)) activeId = data.groups[0].id;
      render();
    }
    if (changes[BG_KEY]) { bgCache = changes[BG_KEY].newValue || null; applyBackground(); }
  });

  $('#addGroup').addEventListener('click', () => editGroup());
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q) return;
    const eng = SEARCH_ENGINES[data.settings.searchEngine] || SEARCH_ENGINES.google;
    location.href = eng.url + encodeURIComponent(q);
  });
  document.addEventListener('click', hideCtx);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hideCtx());
  window.addEventListener('blur', hideCtx);
  setupExternalDrop();
}

// ---------- Renderização ----------
function render() {
  const s = data.settings;
  const root = document.documentElement.style;
  root.setProperty('--cols', s.columns);
  root.setProperty('--radius', s.tileRadius + 'px');
  root.setProperty('--dim', s.bgDim);
  root.setProperty('--bg-color', s.bgColor);
  document.body.classList.toggle('bar-bottom', s.barPosition === 'bottom');
  document.body.classList.toggle('gs-icon', s.groupStyle === 'icon');
  document.body.classList.toggle('gs-text', s.groupStyle === 'text');
  $('#search').hidden = !s.showSearch;
  $('#q').placeholder = `Pesquisar no ${(SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.google).name}…`;
  $('#addGroup').hidden = !s.showAddButtons;
  $('#groups').hidden = !s.showGroups;
  renderGroups();
  renderGrid();
  applyBackground();
}

function renderGroups() {
  const box = $('#groups');
  box.replaceChildren();
  for (const g of data.groups) {
    const b = document.createElement('button');
    b.className = 'chip' + (g.id === activeId ? ' active' : '');
    b.draggable = true;
    b.title = g.name;
    b.innerHTML = '<span class="ico"></span><span class="lbl"></span>';
    b.querySelector('.ico').textContent = g.icon;
    b.querySelector('.lbl').textContent = g.name;
    b.addEventListener('click', () => setActive(g.id));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCtx(e, [
        ['✎ Editar grupo', () => editGroup(g)],
        ['＋ Adicionar atalho aqui', () => { setActive(g.id); editLink(); }],
        '-',
        ['🗑 Excluir grupo', () => deleteGroup(g), 'danger'],
      ]);
    });
    // Arrastar grupos (reordenar) e soltar atalhos sobre um grupo (mover).
    b.addEventListener('dragstart', (e) => {
      drag = { type: 'group', id: g.id };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-neurotab', g.id);
    });
    b.addEventListener('dragend', () => { drag = null; clearDropMarks(); });
    b.addEventListener('dragover', (e) => {
      if (!drag) return;
      e.preventDefault();
      clearDropMarks();
      b.classList.add('drop-target');
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
        moveItem(data.groups, drag.id, g.id, e.offsetX > b.offsetWidth / 2);
        await commit();
      }
      drag = null;
    });
    box.appendChild(b);
  }
}

function renderGrid() {
  const grid = $('#grid');
  grid.replaceChildren();
  const links = data.links.filter((l) => l.groupId === activeId);
  const target = data.settings.openInNewTab ? '_blank' : '_self';

  for (const l of links) {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = l.url;
    a.target = target;
    a.draggable = true;
    a.title = `${l.title}\n${l.url}`;
    a.style.setProperty('--c', l.color);
    a.innerHTML = '<span class="pill"><img alt=""><span></span></span><span class="tools"><button data-a="edit" title="Editar">✎</button><button data-a="del" title="Excluir">✕</button></span>';
    const img = a.querySelector('img');
    img.src = l.favicon || faviconUrl(l.url);
    img.onerror = () => { img.style.display = 'none'; };
    a.querySelector('.pill span').textContent = l.title;
    a.querySelector('.tools').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const act = e.target.dataset.a;
      if (act === 'edit') editLink(l);
      if (act === 'del') deleteLink(l);
    });
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCtx(e, [
        ['↗ Abrir em nova aba', () => window.open(l.url, '_blank')],
        ['✎ Editar', () => editLink(l)],
        ['⧉ Duplicar', () => duplicateLink(l)],
        ['🎨 Atualizar ícone e cor', () => refreshFavicon(l)],
        '-',
        ['🗑 Excluir', () => deleteLink(l), 'danger'],
      ]);
    });
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
      const after = e.offsetX > a.offsetWidth / 2;
      clearDropMarks();
      a.classList.add(after ? 'drop-after' : 'drop-before');
    });
    a.addEventListener('drop', async (e) => {
      if (drag?.type !== 'link') return;
      e.preventDefault();
      e.stopPropagation();
      const after = a.classList.contains('drop-after');
      clearDropMarks();
      moveItem(data.links, drag.id, l.id, after);
      drag = null;
      await commit();
    });
    grid.appendChild(a);
  }

  if (data.settings.showAddButtons) {
    const add = document.createElement('button');
    add.className = 'tile add';
    add.title = 'Adicionar atalho';
    add.textContent = '＋';
    add.addEventListener('click', () => editLink());
    grid.appendChild(add);
  }
  $('#empty').hidden = links.length > 0 || data.settings.showAddButtons;
}

function applyBackground() {
  const want = bgCache && data.settings.bgEnabled ? bgCache : null;
  if (want === applyBackground.last) return;
  applyBackground.last = want;
  $('#bg').style.backgroundImage = want ? `url("${want}")` : 'none';
}

// ---------- Ações ----------
async function commit() {
  await saveData(data);
  render();
}

async function setActive(id) {
  activeId = id;
  chrome.storage.local.set({ [ACTIVE_KEY]: id });
  render();
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
  document.querySelectorAll('.drop-before,.drop-after,.drop-target')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-target'));
}

async function deleteLink(l) {
  const idx = data.links.indexOf(l);
  data.links.splice(idx, 1);
  await commit();
  toast(`"${l.title}" excluído`, 'Desfazer', async () => {
    data.links.splice(idx, 0, l);
    await commit();
  });
}

async function duplicateLink(l) {
  const copy = { ...l, id: uid(), title: l.title + ' (cópia)' };
  data.links.splice(data.links.indexOf(l) + 1, 0, copy);
  await commit();
}

async function refreshFavicon(l) {
  const info = await inspectFavicon(l.url);
  Object.assign(l, info);
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
  if (activeId === g.id) activeId = data.groups[0].id;
  await commit();
  toast(`Grupo "${g.name}" excluído`, 'Desfazer', async () => {
    Object.assign(data, snapshot);
    await commit();
  });
}

// ---------- Diálogo de atalho ----------
function editLink(link) {
  const dlg = $('#linkDlg');
  const f = $('#linkForm');
  $('#linkDlgTitle').textContent = link ? 'Editar atalho' : 'Novo atalho';
  f.groupId.replaceChildren(...data.groups.map((g) => new Option(`${g.icon} ${g.name}`, g.id)));
  f.url.value = link?.url || '';
  f.title.value = link?.title || '';
  f.groupId.value = link?.groupId || activeId;
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
    } else {
      data.links.push({ id: uid(), ...values });
    }
    await commit();
  };
  dlg.returnValue = '';
  dlg.showModal();
  f.url.focus();
}

// ---------- Diálogo de grupo ----------
function editGroup(group) {
  const dlg = $('#groupDlg');
  const f = $('#groupForm');
  $('#groupDlgTitle').textContent = group ? 'Editar grupo' : 'Novo grupo';
  f.name.value = group?.name || '';
  f.icon.value = group?.icon || '📁';
  $('#emojiPick').replaceChildren(...EMOJIS.map((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.onclick = () => { f.icon.value = em; };
    return b;
  }));
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const name = f.name.value.trim();
    if (!name) return;
    const icon = f.icon.value.trim() || '📁';
    if (group) Object.assign(group, { name, icon });
    else {
      const g = { id: uid(), name, icon };
      data.groups.push(g);
      activeId = g.id;
      chrome.storage.local.set({ [ACTIVE_KEY]: g.id });
    }
    await commit();
  };
  dlg.returnValue = '';
  dlg.showModal();
  f.name.focus();
}

// ---------- Soltar links vindos de fora (barra de favoritos, outra aba) ----------
function setupExternalDrop() {
  const main = document.querySelector('main');
  main.addEventListener('dragover', (e) => {
    if (drag) return;
    if ([...e.dataTransfer.types].includes('text/uri-list')) e.preventDefault();
  });
  main.addEventListener('drop', async (e) => {
    if (drag) return;
    const url = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find((x) => x && !x.startsWith('#'));
    if (!url) return;
    e.preventDefault();
    const info = await inspectFavicon(url);
    data.links.push({ id: uid(), groupId: activeId, title: hostOf(url), url, ...info });
    await commit();
    toast('Atalho adicionado');
  });
}

// ---------- Menu de contexto e avisos ----------
function showCtx(e, items) {
  const m = $('#ctx');
  m.replaceChildren();
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    const [label, fn, cls] = it;
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.onclick = (ev) => { ev.stopPropagation(); hideCtx(); fn(); };
    m.appendChild(b);
  }
  m.hidden = false;
  const { innerWidth: W, innerHeight: H } = window;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(e.clientX, W - r.width - 8) + 'px';
  m.style.top = Math.min(e.clientY, H - r.height - 8) + 'px';
}

function hideCtx() { $('#ctx').hidden = true; }

let toastTimer;
function toast(msg, actionLabel, action) {
  const t = $('#toast');
  t.replaceChildren(document.createTextNode(msg));
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { t.hidden = true; action(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, actionLabel ? 6000 : 2500);
}
