// NeuroTab — service worker: menu de contexto e botão da barra de ferramentas.
import { DATA_KEY, ACTIVE_KEY, loadData, saveData, uid, hostOf, inspectFavicon } from './lib/store.js';

const ROOT = 'nt-root';

async function rebuildMenus() {
  await chrome.contextMenus.removeAll();
  const data = await loadData();
  if (!data.settings.showContextMenu) return;
  const contexts = ['page', 'link'];
  chrome.contextMenus.create({ id: ROOT, title: 'Adicionar à NeuroTab', contexts });
  for (const g of data.groups) {
    chrome.contextMenus.create({ id: 'nt-g-' + g.id, parentId: ROOT, title: `${g.icon} ${g.name}`, contexts });
  }
}

async function addLink({ url, title, groupId }) {
  if (!url || !/^https?:|^file:|^ftp:/i.test(url)) return false;
  const data = await loadData();
  const gid = data.groups.some((g) => g.id === groupId) ? groupId : data.groups[0].id;
  const { favicon, color } = await inspectFavicon(url);
  data.links.push({ id: uid(), groupId: gid, title: (title || hostOf(url)).slice(0, 80), url, color, favicon });
  await saveData(data);
  return true;
}

async function flashBadge(tabId, ok) {
  await chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e9d4f' : '#c62828', tabId });
  await chrome.action.setBadgeText({ text: ok ? '✓' : '!', tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 2000);
}

chrome.runtime.onInstalled.addListener(rebuildMenus);
chrome.runtime.onStartup.addListener(rebuildMenus);

let rebuildTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[DATA_KEY]) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildMenus, 300);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!String(info.menuItemId).startsWith('nt-g-')) return;
  const groupId = String(info.menuItemId).slice(5);
  const isLink = !!info.linkUrl;
  const ok = await addLink({
    url: isLink ? info.linkUrl : info.pageUrl,
    title: isLink ? info.selectionText || hostOf(info.linkUrl) : tab?.title,
    groupId,
  });
  if (tab?.id) flashBadge(tab.id, ok);
});

// Clique no ícone da extensão: adiciona a aba atual ao grupo aberto por último.
chrome.action.onClicked.addListener(async (tab) => {
  const r = await chrome.storage.local.get(ACTIVE_KEY);
  const ok = await addLink({ url: tab.url, title: tab.title, groupId: r[ACTIVE_KEY] });
  flashBadge(tab.id, ok);
});
