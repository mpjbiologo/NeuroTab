// NeuroTab — Barra de atalhos: grupos, painel de links, arrastar e soltar, edição de grupos e links.
import { ACTIVE_KEY, saveData, uid, hostOf, normalizeUrl, faviconUrl, inspectFavicon, cssColorToHex } from '../lib/store.js';
import { $, $$, h, toast, showCtx } from '../lib/ui.js';
import { S, EMOJIS } from './state.js';
import { ctx } from './context.js';

// =====================================================================
// BARRA DE ATALHOS
// =====================================================================
let panelGroup = null;
let sticky = false;
let closeTimer;
let openTimer;

export function renderDock() {
  const box = $('#railGroups');
  box.replaceChildren();
  const horizontal = ['top', 'bottom'].includes(dockPos());
  for (const g of S.data.groups) {
    const n = S.data.links.filter((l) => l.groupId === g.id).length;
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
    b.addEventListener('dragstart', (e) => { S.drag = { type: 'group', id: g.id }; e.dataTransfer.setData('text/x-neurotab', g.id); });
    b.addEventListener('dragend', () => { S.drag = null; clearDropMarks(); });
    b.addEventListener('dragover', (e) => {
      if (!S.drag || S.drag.type === 'widget') return;
      e.preventDefault();
      clearDropMarks();
      b.classList.add('drop-target');
      if (S.drag.type === 'link') { clearTimeout(openTimer); openTimer = setTimeout(() => openPanel(g.id), 600); }
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop-target'));
    b.addEventListener('drop', async (e) => {
      e.preventDefault();
      clearDropMarks();
      if (!S.drag) return;
      if (S.drag.type === 'link') {
        const l = S.data.links.find((x) => x.id === S.drag.id);
        if (l && l.groupId !== g.id) {
          S.data.links.splice(S.data.links.indexOf(l), 1);
          l.groupId = g.id;
          S.data.links.push(l);
          await commit();
          toast(`Movido para ${g.icon} ${g.name}`);
        }
      } else if (S.drag.type === 'group' && S.drag.id !== g.id) {
        const r = b.getBoundingClientRect();
        const after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
        moveItem(S.data.groups, S.drag.id, g.id, after);
        await commit();
      }
      S.drag = null;
    });
    box.appendChild(b);
  }
  if (panelGroup) renderPanel();
}

// Em janelas estreitas a barra vai para o rodapé.
export const dockPos = () => (innerWidth < 700 ? 'bottom' : S.data.settings.dockPosition);
const isPinned = () => S.data.settings.dockPinned && ['left', 'right'].includes(dockPos());

export function openPanel(groupId, quiet) {
  clearTimeout(closeTimer);
  if (!S.data.groups.some((g) => g.id === groupId)) groupId = S.data.groups[0].id;
  panelGroup = groupId;
  if (S.activeId !== groupId) {
    S.activeId = groupId;
    if (!quiet) chrome.storage.local.set({ [ACTIVE_KEY]: groupId });
  }
  $('#panel').hidden = false;
  $$('#railGroups .rail-btn').forEach((b, i) => b.classList.toggle('active', S.data.groups[i]?.id === groupId));
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

export function setupPanelBehaviour() {
  const dock = $('#dock');
  dock.addEventListener('mouseleave', () => {
    clearTimeout(openTimer);
    if (S.drag || isPinned() || sticky) return;
    closeTimer = setTimeout(() => closePanel(), 350);
  });
  dock.addEventListener('mouseenter', () => clearTimeout(closeTimer));
  document.addEventListener('click', (e) => {
    if (!dock.contains(e.target) && !e.target.closest('dialog, .ctx')) closePanel(true);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) closePanel(true); });
}

function renderPanel() {
  const g = S.data.groups.find((x) => x.id === panelGroup);
  if (!g) return;
  $('#panelTitle').textContent = `${g.icon} ${g.name}`;
  const box = $('#panelLinks');
  box.replaceChildren();
  const links = S.data.links.filter((l) => l.groupId === g.id);
  const target = S.data.settings.openInNewTab ? '_blank' : '_self';
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
      S.drag = { type: 'link', id: l.id };
      a.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-neurotab', l.id);
    });
    a.addEventListener('dragend', () => { S.drag = null; a.classList.remove('dragging'); clearDropMarks(); });
    a.addEventListener('dragover', (e) => {
      if (S.drag?.type !== 'link' || S.drag.id === l.id) return;
      e.preventDefault();
      const r = a.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      clearDropMarks();
      a.classList.add(after ? 'drop-after' : 'drop-before');
    });
    a.addEventListener('drop', async (e) => {
      if (S.drag?.type !== 'link') return;
      e.preventDefault();
      e.stopPropagation();
      const after = a.classList.contains('drop-after');
      clearDropMarks();
      const moving = S.data.links.find((x) => x.id === S.drag.id);
      if (moving) moving.groupId = l.groupId;
      moveItem(S.data.links, S.drag.id, l.id, after);
      S.drag = null;
      await commit();
    });
    box.appendChild(a);
  }
  $('#panelEmpty').hidden = links.length > 0;
}

// ---------- Ações de atalhos e grupos ----------
async function commit() {
  await saveData(S.data);
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

export function clearDropMarks() {
  $$('.drop-before,.drop-after,.drop-target').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-target'));
}

async function deleteLink(l) {
  const idx = S.data.links.indexOf(l);
  S.data.links.splice(idx, 1);
  await commit();
  toast(`"${l.title}" excluído`, 'Desfazer', async () => { S.data.links.splice(idx, 0, l); await commit(); });
}

async function duplicateLink(l) {
  S.data.links.splice(S.data.links.indexOf(l) + 1, 0, { ...l, id: uid(), title: l.title + ' (cópia)' });
  await commit();
}

async function refreshFavicon(l) {
  Object.assign(l, await inspectFavicon(l.url));
  await commit();
  toast('Ícone e cor atualizados');
}

async function deleteGroup(g) {
  if (S.data.groups.length === 1) return toast('É preciso ter pelo menos um grupo.');
  const count = S.data.links.filter((l) => l.groupId === g.id).length;
  if (!confirm(`Excluir o grupo "${g.name}"${count ? ` e seus ${count} atalhos` : ''}?`)) return;
  const snapshot = structuredClone({ groups: S.data.groups, links: S.data.links });
  S.data.groups = S.data.groups.filter((x) => x.id !== g.id);
  S.data.links = S.data.links.filter((l) => l.groupId !== g.id);
  if (panelGroup === g.id) closePanel(true);
  await commit();
  toast(`Grupo "${g.name}" excluído`, 'Desfazer', async () => { Object.assign(S.data, snapshot); await commit(); });
}

export function editLink(link, preset = {}) {
  const dlg = $('#linkDlg');
  const f = $('#linkForm');
  $('#linkDlgTitle').textContent = link ? 'Editar atalho' : 'Novo atalho';
  f.groupId.replaceChildren(...S.data.groups.map((g) => new Option(`${g.icon} ${g.name}`, g.id)));
  f.url.value = link?.url || preset.url || '';
  f.title.value = link?.title || preset.title || '';
  f.groupId.value = link?.groupId || panelGroup || S.activeId;
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
      if (moved) { S.data.links.splice(S.data.links.indexOf(link), 1); S.data.links.push(link); }
    } else S.data.links.push({ id: uid(), ...values });
    await commit();
  };
  dlg.returnValue = '';
  dlg.showModal();
  f.url.focus();
}

export function editGroup(group) {
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
      S.data.groups.push(g);
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

export function setupExternalDrop() {
  const panel = $('#panel');
  panel.addEventListener('dragover', (e) => {
    if (!S.drag && [...e.dataTransfer.types].includes('text/uri-list')) e.preventDefault();
  });
  panel.addEventListener('drop', async (e) => {
    if (S.drag) return;
    const url = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find((x) => x && !x.startsWith('#'));
    if (!url) return;
    e.preventDefault();
    S.data.links.push({ id: uid(), groupId: panelGroup || S.activeId, title: hostOf(url), url, ...(await inspectFavicon(url)) });
    await commit();
    toast('Atalho adicionado');
  });
}
