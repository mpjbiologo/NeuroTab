// NeuroTab — service worker: menus do botão direito, lembretes e notificações.
import { DATA_KEY, BRAIN_KEY, loadData, saveData, uid, hostOf, inspectFavicon } from './lib/store.js';
import { loadItems, addItem, updateItem, displayTitle } from './lib/brain.js';
import { enrich, isConfigured } from './lib/ai.js';

const NEWTAB = chrome.runtime.getURL('src/newtab.html');

// ---------- Menus ----------
async function rebuildMenus() {
  await chrome.contextMenus.removeAll();
  const data = await loadData();
  if (!data.settings.showContextMenu) return;
  const all = ['page', 'link', 'selection', 'image'];
  chrome.contextMenus.create({ id: 'nt-root', title: 'NeuroTab', contexts: all });
  chrome.contextMenus.create({ id: 'nt-clip', parentId: 'nt-root', title: '✂️ Salvar trecho no cérebro', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'nt-page', parentId: 'nt-root', title: '🔖 Salvar página no cérebro (ler depois)', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'nt-link', parentId: 'nt-root', title: '🔗 Salvar link no cérebro', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'nt-add', parentId: 'nt-root', title: '➕ Adicionar aos atalhos', contexts: ['page', 'link'] });
  for (const g of data.groups) {
    chrome.contextMenus.create({ id: 'nt-g-' + g.id, parentId: 'nt-add', title: `${g.icon} ${g.name}`, contexts: ['page', 'link'] });
  }
}

export async function addShortcut({ url, title, groupId }) {
  if (!url || !/^(https?|file|ftp):/i.test(url)) return false;
  const data = await loadData();
  const gid = data.groups.some((g) => g.id === groupId) ? groupId : data.groups[0].id;
  const { favicon, color } = await inspectFavicon(url);
  data.links.push({ id: uid(), groupId: gid, title: (title || hostOf(url)).slice(0, 80), url, color, favicon });
  await saveData(data);
  return true;
}

async function captureAndEnrich(p) {
  const item = await addItem(p);
  const { settings } = await loadData();
  if (settings.ai.autoEnrich && isConfigured(settings)) {
    try {
      await updateItem(item.id, await enrich(settings, item));
    } catch (e) {
      console.warn('NeuroTab: IA indisponível', e);
    }
  }
  return item;
}

async function flashBadge(tabId, ok) {
  if (!tabId) return;
  await chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e9d4f' : '#c62828', tabId });
  await chrome.action.setBadgeText({ text: ok ? '✓' : '!', tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 2000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  let ok = true;
  try {
    if (id.startsWith('nt-g-')) {
      const isLink = !!info.linkUrl;
      ok = await addShortcut({
        url: isLink ? info.linkUrl : info.pageUrl,
        title: isLink ? info.selectionText || hostOf(info.linkUrl) : tab?.title,
        groupId: id.slice(5),
      });
    } else if (id === 'nt-clip') {
      await captureAndEnrich({ type: 'clip', text: info.selectionText, url: info.pageUrl, pageTitle: tab?.title, source: 'context' });
    } else if (id === 'nt-page') {
      await captureAndEnrich({ type: 'page', title: tab?.title, url: info.pageUrl, pageTitle: tab?.title, source: 'context' });
    } else if (id === 'nt-link') {
      await captureAndEnrich({ type: 'page', title: info.selectionText || '', url: info.linkUrl, source: 'context' });
    }
  } catch (e) {
    console.error(e);
    ok = false;
  }
  flashBadge(tab?.id, ok);
});

// ---------- Lembretes ----------
async function syncAlarms() {
  const items = await loadItems();
  const now = Date.now();
  const existing = await chrome.alarms.getAll();
  const want = new Map();
  for (const it of items) {
    if (it.remindAt && !it.done && !it.notifiedAt) want.set('rem-' + it.id, Math.max(it.remindAt, now + 1000));
  }
  for (const a of existing) {
    if (!a.name.startsWith('rem-')) continue;
    if (!want.has(a.name) || Math.abs(a.scheduledTime - want.get(a.name)) > 1500) await chrome.alarms.clear(a.name);
    else want.delete(a.name);
  }
  for (const [name, when] of want) chrome.alarms.create(name, { when });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('rem-')) return;
  const id = alarm.name.slice(4);
  const it = (await loadItems()).find((x) => x.id === id);
  if (!it || it.done) return;
  const late = Date.now() - it.remindAt > 5 * 60e3;
  chrome.notifications.create(alarm.name, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: (late ? '⏰ Lembrete atrasado — ' : '⏰ ') + displayTitle(it),
    message: (it.text && it.text !== it.title ? it.text : it.summary || '').slice(0, 250) || 'NeuroTab',
    contextMessage: new Date(it.remindAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
    buttons: [{ title: '✅ Concluir' }, { title: '😴 Adiar 10 min' }],
    requireInteraction: true,
    priority: 2,
  });
  await updateItem(id, { notifiedAt: Date.now() });
});

chrome.notifications.onButtonClicked.addListener(async (nid, btn) => {
  if (!nid.startsWith('rem-')) return;
  const id = nid.slice(4);
  if (btn === 0) await updateItem(id, { done: true });
  else await updateItem(id, { remindAt: Date.now() + 10 * 60e3 });
  chrome.notifications.clear(nid);
});

chrome.notifications.onClicked.addListener(async (nid) => {
  chrome.notifications.clear(nid);
  await chrome.tabs.create({ url: NEWTAB + (nid.startsWith('rem-') ? '#item=' + nid.slice(4) : '') });
});

// ---------- Eventos ----------
chrome.runtime.onInstalled.addListener(() => { rebuildMenus(); syncAlarms(); });
chrome.runtime.onStartup.addListener(() => { rebuildMenus(); syncAlarms(); });

let menuTimer;
let alarmTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[DATA_KEY]) {
    clearTimeout(menuTimer);
    menuTimer = setTimeout(rebuildMenus, 300);
  }
  if (changes[BRAIN_KEY]) {
    clearTimeout(alarmTimer);
    alarmTimer = setTimeout(syncAlarms, 300);
  }
});

// Mensagens da página/popup (ex.: organizar com IA em segundo plano).
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'enrich' && msg.id) {
    (async () => {
      try {
        const { settings } = await loadData();
        const it = (await loadItems()).find((x) => x.id === msg.id);
        if (it && isConfigured(settings)) await updateItem(it.id, await enrich(settings, it));
        reply({ ok: true });
      } catch (e) {
        reply({ ok: false, error: e.message });
      }
    })();
    return true;
  }
  return false;
});
