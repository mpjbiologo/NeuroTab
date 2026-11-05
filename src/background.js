// NeuroTab — service worker: menus do botão direito, lembretes e notificações.
import { DATA_KEY, BRAIN_KEY, loadData, saveData, uid, hostOf, inspectFavicon } from './lib/store.js';
import { loadItems, addItem, updateItem, displayTitle, purgeOldTrash } from './lib/brain.js';
import { enrich, isConfigured } from './lib/ai.js';
import { K as CK, loadAlarms, saveAlarms, nextOccurrence, getTimer, getPomo, nextPhase, phaseMinutes } from './lib/clock.js';
import { checkForUpdate, UPDATE_KEY, WHATSNEW_KEY } from './lib/update.js';
import { setLang, t } from './lib/i18n.js';
import { createPlayer } from './lib/sounds.js';

const NEWTAB = chrome.runtime.getURL('src/newtab.html');
loadData().then((d) => setLang(d.settings.lang)).catch(() => {});

// ---------- Menus ----------
async function rebuildMenus() {
  await chrome.contextMenus.removeAll();
  const data = await loadData();
  setLang(data.settings.lang);
  if (!data.settings.showContextMenu) return;
  const all = ['page', 'link', 'selection', 'image'];
  chrome.contextMenus.create({ id: 'nt-root', title: 'NeuroTab', contexts: all });
  chrome.contextMenus.create({ id: 'nt-clip', parentId: 'nt-root', title: t('✂️ Salvar trecho no cérebro'), contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'nt-page', parentId: 'nt-root', title: t('🔖 Salvar página no cérebro (ler depois)'), contexts: ['page'] });
  chrome.contextMenus.create({ id: 'nt-link', parentId: 'nt-root', title: t('🔗 Salvar link no cérebro'), contexts: ['link'] });
  chrome.contextMenus.create({ id: 'nt-add', parentId: 'nt-root', title: t('➕ Adicionar aos atalhos'), contexts: ['page', 'link'] });
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
  if (alarm.name.startsWith('clock-')) return fireClockAlarm(alarm.name.slice(6));
  if (alarm.name === 'timer') return fireTimer();
  if (alarm.name === 'pomo') return firePomo();
  if (alarm.name === 'update-check') return runUpdateCheck();
  if (alarm.name === 'daily') return purgeOldTrash();
  if (!alarm.name.startsWith('rem-')) return;
  const id = alarm.name.slice(4);
  const it = (await loadItems()).find((x) => x.id === id);
  if (!it || it.done) return;
  const late = Date.now() - it.remindAt > 5 * 60e3;
  chrome.notifications.create(alarm.name, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: (late ? t('⏰ Lembrete atrasado —') + ' ' : '⏰ ') + displayTitle(it),
    message: (it.text && it.text !== it.title ? it.text : it.summary || '').slice(0, 250) || 'NeuroTab',
    contextMessage: new Date(it.remindAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
    buttons: [{ title: t('✅ Concluir') }, { title: t('😴 Adiar 10 min') }],
    requireInteraction: true,
    priority: 2,
  });
  await updateItem(id, { notifiedAt: Date.now() });
});

chrome.notifications.onButtonClicked.addListener(async (nid, btn) => {
  if (nid.startsWith('clock-')) {
    await stopSound();
    if (btn === 1) {
      const id = nid.slice(6);
      const a = await loadAlarms();
      const al = a.find((x) => x.id === id);
      if (al) { al.snoozeUntil = Date.now() + 10 * 60e3; al.enabled = true; await saveAlarms(a); }
    }
    chrome.notifications.clear(nid);
    return;
  }
  if (nid === 'timer' || nid === 'pomo') {
    await stopSound();
    if (nid === 'timer' && btn === 0) {
      const tm = await getTimer();
      await chrome.storage.local.set({ [CK.timer]: { ...tm, endAt: Date.now() + (tm.duration || 60e3), pausedLeft: null } });
    }
    chrome.notifications.clear(nid);
    return;
  }
  if (nid === 'update') {
    const u = (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY];
    if (u) chrome.tabs.create({ url: btn === 0 ? u.zip : u.url });
    chrome.notifications.clear(nid);
    return;
  }
  if (!nid.startsWith('rem-')) return;
  const id = nid.slice(4);
  if (btn === 0) await updateItem(id, { done: true });
  else await updateItem(id, { remindAt: Date.now() + 10 * 60e3 });
  chrome.notifications.clear(nid);
});

chrome.notifications.onClosed.addListener((nid) => {
  if (nid.startsWith('clock-') || nid === 'timer') stopSound();
});

chrome.notifications.onClicked.addListener(async (nid) => {
  chrome.notifications.clear(nid);
  if (nid.startsWith('clock-') || nid === 'timer' || nid === 'pomo') { stopSound(); return; }
  await chrome.tabs.create({ url: NEWTAB + (nid.startsWith('rem-') ? '#item=' + nid.slice(4) : '') });
});

// ---------- Som (documento offscreen) ----------
async function ensureOffscreen() {
  const has = chrome.offscreen.hasDocument
    ? await chrome.offscreen.hasDocument()
    : (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
  if (has) return;
  try {
    await chrome.offscreen.createDocument({ url: 'src/offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Tocar o som de despertadores e timers da NeuroTab' });
  } catch (e) {
    if (!String(e).includes('single offscreen')) console.warn(e);
  }
}

// Firefox: o "background" é um documento, então toca o som direto aqui.
const directPlayer = !chrome.offscreen && typeof AudioContext !== 'undefined' ? createPlayer() : null;

async function playSound(kind, opts) {
  if (directPlayer) {
    directPlayer.play(kind, opts || {});
    await chrome.storage.local.set({ [CK.sound]: { playing: !!opts?.loop, kind, at: Date.now() } });
    return;
  }
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'play', kind, opts }).catch(() => {});
  await chrome.storage.local.set({ [CK.sound]: { playing: !!opts?.loop, kind, at: Date.now() } });
}

async function stopSound() {
  directPlayer?.stop();
  if (chrome.offscreen) await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
  await chrome.storage.local.set({ [CK.sound]: { playing: false } });
}

// ---------- Despertadores, timer e pomodoro ----------
async function syncClock() {
  const existing = await chrome.alarms.getAll();
  const want = new Map();
  for (const al of await loadAlarms()) {
    if (!al.enabled) continue;
    const when = al.snoozeUntil && al.snoozeUntil > Date.now() ? al.snoozeUntil : nextOccurrence(al);
    if (when) want.set('clock-' + al.id, when);
  }
  const tm = await getTimer();
  if (tm.endAt) want.set('timer', Math.max(tm.endAt, Date.now() + 500));
  const p = await getPomo();
  if (p.running && p.endAt) want.set('pomo', Math.max(p.endAt, Date.now() + 500));
  for (const a of existing) {
    if (!(a.name.startsWith('clock-') || a.name === 'timer' || a.name === 'pomo')) continue;
    if (!want.has(a.name) || Math.abs(a.scheduledTime - want.get(a.name)) > 1500) await chrome.alarms.clear(a.name);
    else want.delete(a.name);
  }
  for (const [name, when] of want) chrome.alarms.create(name, { when });
}

async function fireClockAlarm(id) {
  const a = await loadAlarms();
  const al = a.find((x) => x.id === id);
  if (!al || !al.enabled) return;
  al.snoozeUntil = null;
  if (!al.days?.length) al.enabled = false;
  await saveAlarms(a);
  chrome.notifications.create('clock-' + id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '⏰ ' + (al.label || t('Despertador')),
    message: t(`São ${al.time}.`),
    buttons: [{ title: t('⏹ Parar') }, { title: t('😴 Soneca 10 min') }],
    requireInteraction: true,
    priority: 2,
  });
  playSound(al.sound, { loop: true, maxSec: 180, crescendo: true });
}

async function fireTimer() {
  const tm = await getTimer();
  if (!tm.endAt) return;
  await chrome.storage.local.set({ [CK.timer]: { ...tm, endAt: null, pausedLeft: null, finishedAt: Date.now() } });
  chrome.notifications.create('timer', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '⏱ ' + (tm.label || t('Timer concluído')),
    message: t('O tempo acabou.'),
    buttons: [{ title: t('🔁 Repetir') }, { title: t('⏹ Parar') }],
    requireInteraction: true,
    priority: 2,
  });
  const { settings } = await loadData();
  playSound(settings.timerSound || 'sino', { loop: true, maxSec: 60 });
}

async function firePomo() {
  const p = await getPomo();
  if (!p.running) return;
  const n = { ...p, ...nextPhase(p) };
  n.endAt = Date.now() + phaseMinutes(n) * 60e3;
  await chrome.storage.local.set({ [CK.pomo]: n });
  const msg = n.phase === 'focus'
    ? { t: t(`🍅 Foco ${n.cycle}`), m: t(`Pausa terminou. Hora de focar por ${n.focusMin} min.`) }
    : { t: t(n.phase === 'long' ? '🌿 Pausa longa' : '☕ Pausa'), m: t(`Bom trabalho! Descanse ${phaseMinutes(n)} min.`) };
  chrome.notifications.create('pomo', { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: msg.t, message: msg.m, priority: 1 });
  playSound(n.phase === 'focus' ? 'digital' : 'suave', { loop: false });
}

// ---------- Atualizações ----------
async function runUpdateCheck() {
  try {
    const { settings } = await loadData();
    if (settings.checkUpdates === false) return;
    const u = await checkForUpdate();
    if (u.available) {
      await chrome.action.setBadgeBackgroundColor({ color: '#7c5cff' });
      await chrome.action.setBadgeText({ text: 'NEW' });
      if (u.notifiedVersion !== u.latest) {
        chrome.notifications.create('update', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: t(`NeuroTab ${u.latest} disponível`),
          message: t('Uma nova versão foi lançada. Veja as novidades e baixe.'),
          buttons: [{ title: t('⬇ Baixar') }, { title: t('📄 Ver novidades') }],
        });
        await chrome.storage.local.set({ [UPDATE_KEY]: { ...u, notifiedVersion: u.latest } });
      }
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    console.warn('NeuroTab: verificação de atualização falhou', e);
  }
}

// ---------- Eventos ----------
function setupPeriodic() {
  chrome.alarms.create('update-check', { delayInMinutes: 1, periodInMinutes: 12 * 60 });
  chrome.alarms.create('daily', { delayInMinutes: 2, periodInMinutes: 24 * 60 });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  rebuildMenus();
  syncAlarms();
  syncClock();
  setupPeriodic();
  if (details.reason === 'update') {
    await chrome.storage.local.set({ [WHATSNEW_KEY]: chrome.runtime.getManifest().version });
    await chrome.action.setBadgeText({ text: '' });
  }
});
chrome.runtime.onStartup.addListener(() => { rebuildMenus(); syncAlarms(); syncClock(); setupPeriodic(); });

// Comando de teclado global: abrir a NeuroTab ouvindo um comando de voz.
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'voice-command') return;
  const url = chrome.runtime.getURL('src/newtab.html');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith(url) || tab?.url === 'chrome://newtab/' || tab?.url === 'edge://newtab/') {
    chrome.runtime.sendMessage({ type: 'startVoice' }).catch(() => {});
  } else {
    chrome.tabs.create({ url: url + '#voice' });
  }
});

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
  if (changes[CK.alarms] || changes[CK.timer] || changes[CK.pomo]) syncClock();
});

// Mensagens da página/popup (ex.: organizar com IA em segundo plano).
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target === 'offscreen') return false;
  if (msg?.type === 'stopSound') { stopSound().then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'previewSound') { playSound(msg.kind, { loop: false }).then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'checkUpdate') {
    checkForUpdate()
      .then(async () => { await runUpdateCheck(); reply({ ok: true, u: (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY] }); })
      .catch((e) => reply({ ok: false, error: e.message }));
    return true;
  }
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
