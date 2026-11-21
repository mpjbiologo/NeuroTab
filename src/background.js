// NeuroTab — service worker: menus do botão direito, lembretes e notificações.
import { DATA_KEY, BRAIN_KEY, loadData, saveData, uid, hostOf, inspectFavicon } from './lib/store.js';
import { loadItems, addItem, updateItem, displayTitle, purgeOldTrash } from './lib/brain.js';
import { enrich, isConfigured } from './lib/ai.js';
import { K as CK, loadAlarms, saveAlarms, nextOccurrence, getTimer, getPomo, nextPhase, phaseMinutes } from './lib/clock.js';
import { checkForUpdate, isStoreInstall, UPDATE_KEY, WHATSNEW_KEY } from './lib/update.js';
import { setLang, t } from './lib/i18n.js';
import { createPlayer } from './lib/sounds.js';
import { saveCapture, downloadAndSave } from './lib/captures.js';
import { grabAndSave } from './lib/page-image.js';
import { findAddress } from './lib/address.js';
import { discardTempCapture } from './lib/captures.js';
import { loadCalendar, eventsBetween, refreshFeeds, CAL_KEY, CAL_CACHE_KEY, GOOGLE_REFRESH_MIN } from './lib/calendar.js';
import { syncNow, syncConfig, WATCHED_KEYS } from './lib/sync.js';
import { addClip, clipConfig, pruneClips, CLIP_CFG_KEY, CLIP_KEY } from './lib/clipboard.js';
import { shareConfig, canReceive, cleanPayload, NATIVE_HOST } from './lib/clipboard-share.js';
import { checkMail, mailConfig, notificationsFor, MAIL_CFG_KEY, GMAIL_ORIGIN } from './lib/mail.js';
import { dispatchShares, pollShares, receivePayload, patchState, me as shareMe } from './lib/clipboard-sync.js';

// Janela de análise aberta com uma imagem temporária: quando ela fecha (a conexão cai), o fundo apaga a
// imagem se ninguém a guardou. Mais confiável que apagar de dentro da janela, que pode fechar antes de terminar.
chrome.runtime.onConnect.addListener((port) => {
  const m = /^analyze-temp:(.+)$/.exec(port.name);
  if (m) port.onDisconnect.addListener(() => { discardTempCapture(m[1]).catch(() => {}); });
});

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
  chrome.contextMenus.create({ id: 'nt-image', parentId: 'nt-root', title: t('🖼️ Salvar imagem na biblioteca'), contexts: ['image'] });
  chrome.contextMenus.create({ id: 'nt-analyze', parentId: 'nt-root', title: t('🔍 Analisar imagem'), contexts: ['image'] });
  chrome.contextMenus.create({ id: 'nt-route', parentId: 'nt-root', title: t('🧭 Traçar rota até "%s"'), contexts: ['selection'] });
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


// Salvar imagem na biblioteca (menu de contexto).
// 1) Download direto pelo endereço da imagem (qualidade original). Precisa de permissão para o domínio dela:
//    o pedido é feito aqui, no clique do menu; se o navegador não aceitar o pedido no service worker,
//    abre uma janelinha onde a pessoa autoriza com um clique.
// 2) Se não der (login, blob:, http:, bloqueio do site, permissão negada), pega a imagem de dentro da
//    própria página (lib/page-image.js), usando a permissão que o clique no menu já dá (activeTab).
/** Janela de análise de uma imagem da biblioteca (src/analyze.html). */
async function openAnalyzer(id) {
  await chrome.windows.create({ url: chrome.runtime.getURL('src/analyze.html?id=' + encodeURIComponent(id)), type: 'popup', width: 560, height: 760 });
}

/** Abre uma nova aba com a rota até o endereço no widget Trânsito (o destino pode ser corrigido lá). */
async function openRouteTo(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const dest = (findAddress(text) || clean).slice(0, 160);
  if (!dest) throw new Error('Selecione um endereço.');
  await chrome.tabs.create({ url: NEWTAB + '?route=' + encodeURIComponent(dest) });
}

async function captureImage(info, tab, { then = '' } = {}) {
  const sourceUrl = info.srcUrl || '';
  const pageUrl = info.pageUrl || tab?.url || '';
  const meta = { url: sourceUrl, pageUrl, pageTitle: tab?.title || '', source: 'context' };
  const where = { tabId: tab?.id, frameId: info.frameId ?? 0, windowId: tab?.windowId };
  // Só para analisar: guarda na biblioteca conforme Configurações → Mídia (sem await aqui, por causa do pedido de permissão).
  const tempP = then === 'analyze' ? loadData().then((d) => d.settings.media?.save !== 'auto').catch(() => true) : Promise.resolve(false);
  if (sourceUrl.startsWith('data:image/')) {
    meta.temp = await tempP;
    const blob = await (await fetch(sourceUrl)).blob();
    return saveCapture({ ...meta, blob, url: '', fileName: 'imagem' });
  }
  let parsed = null;
  try { parsed = new URL(sourceUrl); } catch { /* endereço estranho: tenta pela página */ }
  if (!parsed || parsed.protocol !== 'https:') { meta.temp = await tempP; return grabAndSave(sourceUrl, meta, where); }

  const permission = { origins: [parsed.origin + '/*'] };
  // IMPORTANTE: nenhum await antes deste pedido, para não perder o gesto do usuário.
  let granted;
  try {
    granted = await chrome.permissions.request(permission);
  } catch {
    granted = null; // o navegador não deixou pedir aqui
  }
  meta.temp = await tempP;
  if (granted === null) {
    const q = new URLSearchParams({ temp: meta.temp ? '1' : '', src: sourceUrl, page: pageUrl, title: meta.pageTitle.slice(0, 300), tab: String(where.tabId ?? ''), frame: String(where.frameId), win: String(where.windowId ?? ''), then });
    await chrome.windows.create({ url: chrome.runtime.getURL('src/grant.html?' + q), type: 'popup', width: 460, height: 300 });
    return null;
  }
  if (!granted) return grabAndSave(sourceUrl, meta, where);
  try {
    return await downloadAndSave(sourceUrl, meta);
  } catch (e) {
    if (/12 MB/.test(e?.message || '')) throw e;
    console.info('NeuroTab: download direto falhou, tentando pela página', e?.message);
    return grabAndSave(sourceUrl, meta, where);
  }
}

async function flashBadge(tabId, ok, detail = '') {
  if (!tabId) return;
  await chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e9d4f' : '#c62828', tabId });
  await chrome.action.setBadgeText({ text: ok ? '✓' : '!', tabId });
  await chrome.action.setTitle({ title: ok ? 'NeuroTab: ação concluída' : `NeuroTab: ${detail || 'falha ao salvar imagem'}`, tabId });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.action.setTitle({ title: 'NeuroTab', tabId });
  }, 6000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  let ok = true;
  let failure = '';
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
    } else if (id === 'nt-image') {
      await captureImage(info, tab);
    } else if (id === 'nt-analyze') {
      // Salva na biblioteca e abre a janela de análise (texto lido no computador; IA só com autorização).
      const rec = await captureImage(info, tab, { then: 'analyze' });
      if (rec) await openAnalyzer(rec.id);
    } else if (id === 'nt-route') {
      await openRouteTo(info.selectionText || '');
    }
  } catch (e) {
    console.error('NeuroTab: falha na captura', e);
    ok = false;
    failure = e?.message || String(e);
  }
  flashBadge(tab?.id, ok, failure);
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

// ---------- Agenda: avisos antes dos compromissos (#26) ----------
const CAL_SENT = 'nt_calendar_sent'; // { "agenda|evento|ocorrência": quando avisou }
const calName = (o) => `cal-${o.calendar.id}|${o.ev.id}|${o.key}`;

async function syncCalAlarms() {
  try {
    const cal = await loadCalendar();
    const now = Date.now();
    const sent = (await chrome.storage.local.get(CAL_SENT))[CAL_SENT] || {};
    const want = new Map();
    for (const o of eventsBetween(cal, now - 864e5, now + 2 * 864e5)) {
      if (o.ev.alarm == null) continue;
      const when = o.start - o.ev.alarm * 60e3;
      const name = calName(o);
      if (sent[name] || when < now - 60e3 || o.start < now) continue;
      want.set(name, Math.max(when, now + 1000));
    }
    for (const a of await chrome.alarms.getAll()) {
      if (!a.name.startsWith('cal-')) continue;
      if (!want.has(a.name) || Math.abs(a.scheduledTime - want.get(a.name)) > 1500) await chrome.alarms.clear(a.name);
      else want.delete(a.name);
    }
    for (const [name, when] of want) chrome.alarms.create(name, { when });
  } catch (e) {
    console.warn('NeuroTab: avisos da agenda', e);
  }
}

async function fireCalAlarm(name) {
  const cal = await loadCalendar();
  const now = Date.now();
  const o = eventsBetween(cal, now - 864e5, now + 2 * 864e5).find((x) => calName(x) === name);
  if (!o) return;
  const store = (await chrome.storage.local.get(CAL_SENT))[CAL_SENT] || {};
  if (store[name]) return;
  for (const [k, v] of Object.entries(store)) if (now - v > 4 * 864e5) delete store[k];
  store[name] = now;
  await chrome.storage.local.set({ [CAL_SENT]: store });
  const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mins = Math.round((o.start - now) / 60e3);
  chrome.notifications.create(name, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '📅 ' + o.ev.title,
    message: [o.allDay ? t('Dia todo') : `${fmt(o.start)}–${fmt(o.end)}${mins > 0 ? ` · ${t('em')} ${mins} min` : ''}`, o.ev.location].filter(Boolean).join(' · '),
    contextMessage: o.calendar.name,
    priority: 2,
  });
}

// ---------- Sincronização entre aparelhos (#27) ----------
// Alguns segundos depois de cada mudança, a cada 5 minutos e ao abrir o navegador. Nunca abre janela de login
// sozinha: se a sessão do Google saiu, a situação fica na aba Contas, esperando a pessoa entrar de novo.
let syncTimer;
let syncQuietUntil = 0; // as gravações da própria sincronização não disparam outra
async function backgroundSync() {
  const c = await syncConfig();
  if (!c.enabled || c.paused) return;
  syncQuietUntil = Date.now() + 10 * 60e3; // durante a sincronização
  try { await syncNow(); } catch (e) { console.info('NeuroTab: sincronização adiada', e?.message); }
  syncQuietUntil = Date.now() + 4000;
}
function scheduleSync(ms = 15000) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(backgroundSync, ms);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'ntsync') return backgroundSync();
  if (alarm.name === 'clipwatch') return syncClipboard().catch(() => {});
  if (alarm.name === 'clipprune') return pruneClips().catch(() => {});
  if (alarm.name === 'mail') return runMailCheck().catch((e) => console.warn('NeuroTab: e-mail', e));
  if (alarm.name === 'clipshare') return Promise.all([pollShares(), syncPonte()]).catch(() => {});
  if (alarm.name.startsWith('cal-')) return fireCalAlarm(alarm.name);
  if (alarm.name === 'calfeeds') return refreshFeeds().then(syncCalAlarms).catch(() => {});
  if (alarm.name === 'calsync') return syncCalAlarms();
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
  if (nid.startsWith('mail:')) {
    // e-mail: abre a mensagem no Gmail (ou a nova aba, no aviso resumido)
    const links = (await chrome.storage.session.get('nt_mail_links')).nt_mail_links || {};
    await chrome.tabs.create({ url: links[nid] || NEWTAB });
    return;
  }
  if (nid.startsWith('clock-') || nid === 'timer' || nid === 'pomo') { stopSound(); return; }
  await chrome.tabs.create({ url: NEWTAB + (nid.startsWith('rem-') ? '#item=' + nid.slice(4) : '') }); // aviso da agenda: abre a nova aba
});

// ---------- Som (documento offscreen) ----------
const OFF_URL = 'src/offscreen.html';
async function offscreenExists() {
  const offscreen = globalThis.chrome?.offscreen;
  if (!offscreen) return false;
  return offscreen.hasDocument
    ? offscreen.hasDocument()
    : (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
}
async function ensureOffscreen({ clipboard = false } = {}) {
  // Só existe no Chrome/Edge (no Firefox o som toca direto aqui, ver directPlayer).
  // Um documento só: com a área de transferência ligada, ele é criado com o motivo CLIPBOARD (e não fecha
  // sozinho depois de 30 s sem som, como acontece com AUDIO_PLAYBACK).
  const offscreen = globalThis.chrome?.offscreen;
  if (!offscreen) return;
  if (!clipboard) { const c = await clipConfig(); clipboard = !!(c.monitor && !c.paused && (await hasClipRead())); }
  const KEY = 'nt_offscreen_clip';
  const hadClip = !!(await chrome.storage.session.get(KEY))[KEY];
  if (await offscreenExists()) {
    if (!clipboard || hadClip) return;
    const snd = (await chrome.storage.local.get(CK.sound))[CK.sound];
    if (snd?.playing) return; // não corta um despertador tocando; tenta de novo no próximo minuto
    await offscreen.closeDocument().catch(() => {});
  }
  try {
    await offscreen.createDocument(clipboard
      ? { url: OFF_URL, reasons: ['CLIPBOARD', 'AUDIO_PLAYBACK'], justification: 'Acompanhar a área de transferência (opção ligada pela pessoa) e tocar o som de despertadores e timers' }
      : { url: OFF_URL, reasons: ['AUDIO_PLAYBACK'], justification: 'Tocar o som de despertadores e timers da NeuroTab' });
    await chrome.storage.session.set({ [KEY]: clipboard });
    if (clipboard) await chrome.runtime.sendMessage({ target: 'offscreen', type: 'clip-start' }).catch(() => {});
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
    if (await isStoreInstall()) return; // a loja já atualiza a extensão sozinha
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

// ---------- Área de transferência (#51) ----------
const CLIP_SCRIPT = 'nt-clip';
const CLIP_SITES = ['https://*/*'];
const hasClipRead = () => chrome.permissions.contains({ permissions: ['clipboardRead'] }).catch(() => false);

async function clipBadge(on) {
  try {
    const cur = await chrome.action.getBadgeText({});
    if (cur === 'NEW') return; // o aviso de versão nova tem prioridade
    if (on) {
      await chrome.action.setBadgeBackgroundColor({ color: '#22b8c9' });
      await chrome.action.setBadgeText({ text: '●' });
      await chrome.action.setTitle({ title: t('NeuroTab · acompanhando a área de transferência') });
    } else if (cur === '●') {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: 'NeuroTab' });
    }
  } catch { /* sem ícone de ação */ }
}

/** Liga ou desliga cada nível conforme a configuração e as permissões concedidas. */
async function syncClipboard({ injectOpenTabs = false } = {}) {
  const cfg = await clipConfig();
  // nível 2: captura nos sites
  let sitesOn = false;
  try {
    sitesOn = cfg.sites && !cfg.paused && (await chrome.permissions.contains({ origins: CLIP_SITES }));
    const reg = await chrome.scripting.getRegisteredContentScripts({ ids: [CLIP_SCRIPT] });
    if (sitesOn && !reg.length) {
      const def = { id: CLIP_SCRIPT, matches: CLIP_SITES, js: ['src/clip-content.js'], runAt: 'document_start', allFrames: true };
      await chrome.scripting.registerContentScripts([{ ...def, persistAcrossSessions: true }]).catch(() => chrome.scripting.registerContentScripts([def]));
    }
    if (!sitesOn && reg.length) await chrome.scripting.unregisterContentScripts({ ids: [CLIP_SCRIPT] });
    if (sitesOn && injectOpenTabs) {
      // abas já abertas passam a capturar sem precisar recarregar
      for (const tab of await chrome.tabs.query({ url: CLIP_SITES })) {
        if (!tab.incognito) chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/clip-content.js'] }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('NeuroTab: captura nos sites', e);
  }
  // nível 3: acompanhamento contínuo (Chrome/Edge)
  const monitorOn = !!(cfg.monitor && !cfg.paused && chrome.offscreen && (await hasClipRead()));
  if (monitorOn) {
    await ensureOffscreen({ clipboard: true });
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'clip-start' }).catch(() => {});
    chrome.alarms.create('clipwatch', { periodInMinutes: 1 }); // reabre o documento se o navegador o fechar
  } else {
    chrome.alarms.clear('clipwatch');
    if (await offscreenExists()) await chrome.runtime.sendMessage({ target: 'offscreen', type: 'clip-stop' }).catch(() => {});
  }
  await clipBadge(monitorOn || sitesOn);
}

// ---------- Compartilhar com outros aparelhos (0.7.7.2) ----------
let ponte = null; // conexão com a NeuroTab Ponte (rede local)
const lanTransport = { images: true, async send(p) { if (!ponte) throw new Error('A Ponte não está conectada.'); ponte.postMessage({ type: 'item', payload: p }); return {}; } };

async function syncPonte() {
  const share = shareConfig(await clipConfig());
  const allowed = await chrome.permissions.contains({ permissions: ['nativeMessaging'] }).catch(() => false);
  if (!(share.enabled && share.lan.on && allowed && share.lan.token)) {
    if (ponte) { ponte.disconnect(); ponte = null; }
    await patchState('lan', { status: 'off', urls: [] });
    return;
  }
  if (ponte) return;
  try {
    ponte = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    await patchState('lan', { status: 'off', error: String(e.message || e) });
    return;
  }
  ponte.onMessage.addListener(async (m) => {
    if (m?.type === 'ready') await patchState('lan', { status: 'on', urls: (m.urls || []).slice(0, 8), port: m.port, version: m.version || '', error: '' });
    if (m?.type === 'incoming' && canReceive(shareConfig(await clipConfig()))) await receivePayload(cleanPayload(m.payload), 'Rede local');
    if (m?.type === 'error') await patchState('lan', { error: String(m.message || '') });
  });
  ponte.onDisconnect.addListener(async () => {
    const err = chrome.runtime.lastError?.message || '';
    ponte = null;
    await patchState('lan', { status: 'off', urls: [], error: /not found|no such native|not registered/i.test(err) ? 'A NeuroTab Ponte não está instalada neste computador.' : err || 'A Ponte foi fechada.' });
  });
  const who = await shareMe(share);
  ponte.postMessage({ type: 'hello', token: share.lan.token, port: share.lan.port, name: who.name, deviceId: who.id });
}

async function syncShareAlarm() {
  const share = shareConfig(await clipConfig());
  const polls = canReceive(share) && (share.cloud.on || share.ntfy.on || share.telegram.on);
  if (polls) chrome.alarms.create('clipshare', { periodInMinutes: 0.5 });
  else chrome.alarms.clear('clipshare');
}

let dispatchTimer = null;
function scheduleDispatch() {
  clearTimeout(dispatchTimer);
  dispatchTimer = setTimeout(() => dispatchShares({ lan: ponte ? lanTransport : null }).catch((e) => console.warn('NeuroTab: compartilhar', e)), 400);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab?.url?.startsWith('http')) return;
  if (msg?.type === 'clipshare:poll') { pollShares({ only: msg.only || null }).then((got) => reply({ got: got.length }), (e) => reply({ error: e.message })); return true; }
  if (msg?.type === 'clipshare:sync') { Promise.all([syncPonte(), syncShareAlarm()]).then(() => reply({ ok: true })); return true; }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'clip:copy') {
    // do content script, numa aba normal (nunca anônima)
    if (!sender.tab || sender.tab.incognito || sender.id !== chrome.runtime.id) return;
    clipConfig().then((cfg) => {
      if (!cfg.sites || cfg.paused) return;
      return addClip({ text: msg.text, via: 'site', source: { url: sender.url || sender.tab.url || msg.url, title: sender.tab.title || msg.title } });
    }).catch((e) => console.warn('NeuroTab: área de transferência', e));
  }
  if (msg?.type === 'clip:monitor') {
    // só do documento oculto da própria extensão
    if (sender.tab || sender.id !== chrome.runtime.id || !String(sender.url || '').includes('/src/offscreen.html')) return;
    clipConfig().then((cfg) => {
      if (!cfg.monitor || cfg.paused) return;
      return addClip({ text: msg.text || '', image: msg.image || null, via: 'monitor' });
    }).catch((e) => console.warn('NeuroTab: área de transferência', e));
  }
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[CLIP_CFG_KEY]) {
    const before = changes[CLIP_CFG_KEY].oldValue || {};
    const after = changes[CLIP_CFG_KEY].newValue || {};
    syncClipboard({ injectOpenTabs: after.sites && !before.sites }).catch(() => {});
    if (JSON.stringify(before.share || {}) !== JSON.stringify(after.share || {})) { syncPonte().catch(() => {}); syncShareAlarm().catch(() => {}); }
  }
  if (changes[CLIP_KEY]) scheduleDispatch();
});
chrome.permissions.onAdded?.addListener(() => { syncClipboard().catch(() => {}); syncMailAlarm().catch(() => {}); });
chrome.permissions.onRemoved?.addListener(() => { syncClipboard().catch(() => {}); syncMailAlarm().catch(() => {}); });

// ---------- E-mail (#20) ----------
async function syncMailAlarm() {
  const cfg = await mailConfig();
  const ok = cfg.enabled && (await chrome.permissions.contains({ origins: [GMAIL_ORIGIN] }).catch(() => false));
  if (ok) chrome.alarms.create('mail', { delayInMinutes: 0.5, periodInMinutes: Math.max(1, +cfg.interval || 5) });
  else chrome.alarms.clear('mail');
}
async function runMailCheck(opts = {}) {
  const { fresh, cfg } = await checkMail(opts);
  const notes = notificationsFor(fresh, cfg);
  if (!notes.length) return fresh.length;
  const links = (await chrome.storage.session.get('nt_mail_links')).nt_mail_links || {};
  for (const n of notes) {
    links[n.id] = n.url;
    chrome.notifications.create(n.id, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: t(n.title), message: n.message, contextMessage: n.context || '', priority: 0 });
  }
  await chrome.storage.session.set({ nt_mail_links: Object.fromEntries(Object.entries(links).slice(-50)) });
  return fresh.length;
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'mail:check' || sender.id !== chrome.runtime.id || sender.tab?.url?.startsWith('http')) return;
  runMailCheck({ rediscover: !!msg.rediscover }).then((n) => reply({ fresh: n }), (e) => reply({ error: e.message }));
  return true;
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[MAIL_CFG_KEY]) return;
  const a = changes[MAIL_CFG_KEY].oldValue || {};
  const b = changes[MAIL_CFG_KEY].newValue || {};
  if (a.enabled !== b.enabled || a.interval !== b.interval) syncMailAlarm().catch(() => {});
});

// ---------- Eventos ----------
function setupPeriodic() {
  chrome.alarms.create('update-check', { delayInMinutes: 1, periodInMinutes: 12 * 60 });
  chrome.alarms.create('daily', { delayInMinutes: 2, periodInMinutes: 24 * 60 });
  chrome.alarms.create('calfeeds', { delayInMinutes: 3, periodInMinutes: GOOGLE_REFRESH_MIN }); // agendas por link (30 min) e do Google (10 min)
  chrome.alarms.create('calsync', { delayInMinutes: 5, periodInMinutes: 6 * 60 }); // avisos das próximas 48 h
  chrome.alarms.create('ntsync', { delayInMinutes: 1, periodInMinutes: 5 }); // sincronização entre aparelhos
  chrome.alarms.create('clipprune', { delayInMinutes: 10, periodInMinutes: 30 }); // prazo dos itens copiados
}

chrome.runtime.onInstalled.addListener(async (details) => {
  rebuildMenus();
  syncAlarms();
  syncCalAlarms();
  syncClock();
  setupPeriodic();
  syncClipboard().catch(() => {});
  syncPonte().catch(() => {});
  syncShareAlarm().catch(() => {});
  syncMailAlarm().catch(() => {});
  if (details.reason === 'update') {
    await chrome.storage.local.set({ [WHATSNEW_KEY]: chrome.runtime.getManifest().version });
    await chrome.action.setBadgeText({ text: '' });
  }
});
chrome.runtime.onStartup.addListener(async () => {
  rebuildMenus(); syncAlarms(); syncCalAlarms(); syncClock(); setupPeriodic(); scheduleSync(5000);
  // "apagar quando o computador desligar": o navegador abriu de novo, o histórico (menos os fixados) começa vazio
  await pruneClips({ startup: true }).catch(() => {});
  syncClipboard().catch(() => {});
  syncPonte().catch(() => {});
  syncShareAlarm().catch(() => {});
  syncMailAlarm().catch(() => {});
});

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
let calTimer;
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
  if (Date.now() > syncQuietUntil && WATCHED_KEYS.some((k) => changes[k])) scheduleSync();
  if (changes[CAL_KEY] || changes[CAL_CACHE_KEY]) {
    clearTimeout(calTimer);
    calTimer = setTimeout(syncCalAlarms, 500);
  }
});

// Mensagens da página/popup (ex.: organizar com IA em segundo plano).
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target === 'offscreen') return false;
  if (msg?.type === 'stopSound') { stopSound().then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'previewSound') { playSound(msg.kind, { loop: false }).then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'grabImage') {
    // Pedido da janelinha de permissão (grant.html) quando o download direto falhou.
    grabAndSave(msg.src, msg.meta || {}, { tabId: msg.tabId, frameId: msg.frameId || 0, windowId: msg.windowId })
      .then((rec) => { flashBadge(msg.tabId, true); reply({ ok: true, id: rec?.id }); })
      .catch((e) => { flashBadge(msg.tabId, false, e?.message); reply({ ok: false, error: e?.message || String(e) }); });
    return true;
  }
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
