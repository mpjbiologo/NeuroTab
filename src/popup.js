// NeuroTab — popup do ícone: anotar a página, salvar trecho, adicionar atalho.
import { loadData, saveData, uid, hostOf, inspectFavicon, faviconUrl, ACTIVE_KEY } from './lib/store.js';
import { addItem, loadItems, displayTitle, relTime, parseReminder, TYPES } from './lib/brain.js';
import { isConfigured } from './lib/ai.js';
import { micButton, toLocalInput, fromLocalInput, h } from './lib/ui.js';

const $ = (s) => document.querySelector(s);
let tab;
let data;

init();

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  data = await loadData();
  const url = tab?.url || '';
  const web = /^(https?|file):/i.test(url);
  $('#ptitle').textContent = tab?.title || 'Página';
  $('#phost').textContent = web ? hostOf(url) : 'Página interna do navegador';
  $('#fav').src = tab?.favIconUrl || (web ? faviconUrl(url) : '../icons/icon32.png');
  $('#micSlot').append(micButton($('#note'), { lang: data.settings.voiceLang }));

  // Grupos
  const r = await chrome.storage.local.get(ACTIVE_KEY);
  $('#group').replaceChildren(...data.groups.map((g) => new Option(`${g.icon} ${g.name}`, g.id)));
  if (data.groups.some((g) => g.id === r[ACTIVE_KEY])) $('#group').value = r[ACTIVE_KEY];
  const exists = data.links.some((l) => l.url === url);
  $('#already').hidden = !exists;
  if (!web) { $('#addShortcut').disabled = true; $('#savePage').disabled = true; $('#grab').disabled = true; }

  // Seleção atual entra automaticamente como citação
  if (web) {
    const sel = await getSelection();
    if (sel) $('#note').value = `“${sel}”\n\n`;
  }
  $('#note').focus();
  $('#note').setSelectionRange($('#note').value.length, $('#note').value.length);

  await renderExisting();

  $('#grab').onclick = async () => {
    const sel = await getSelection();
    if (!sel) return flash('Selecione um texto na página primeiro');
    $('#note').value = `“${sel}”\n\n` + $('#note').value.replace(/^“[\s\S]*?”\n\n/, '');
    $('#note').focus();
  };
  $('#remind').onclick = () => {
    const w = $('#when');
    w.hidden = !w.hidden;
    if (!w.hidden && !w.value) w.value = toLocalInput(Date.now() + 3600e3);
  };
  $('#saveNote').onclick = saveNote;
  $('#note').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNote(); });
  $('#savePage').onclick = async () => {
    await capture({ type: 'page', title: tab.title, url, pageTitle: tab.title, source: 'popup' });
    flash('Página salva 🔖');
    renderExisting();
  };
  $('#addShortcut').onclick = async () => {
    const { favicon, color } = await inspectFavicon(url);
    data.links.push({ id: uid(), groupId: $('#group').value, title: (tab.title || hostOf(url)).slice(0, 80), url, color, favicon });
    await saveData(data);
    $('#already').hidden = false;
    flash('Atalho adicionado ✓');
  };
  $('#openTab').onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('src/newtab.html') }); window.close(); };
}

async function getSelection() {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(window.getSelection() || '').trim() });
    return (res?.result || '').slice(0, 5000);
  } catch {
    return '';
  }
}

async function capture(p) {
  const it = await addItem(p);
  if (data.settings.ai.autoEnrich && isConfigured(data.settings)) chrome.runtime.sendMessage({ type: 'enrich', id: it.id }).catch(() => {});
  return it;
}

async function saveNote() {
  const text = $('#note').value.trim();
  if (!text) return $('#note').focus();
  const url = /^(https?|file):/i.test(tab?.url || '') ? tab.url : '';
  const remindAt = $('#when').hidden ? parseReminder(text) : fromLocalInput($('#when').value);
  const isClip = /^“/.test(text) && text.replace(/^“[\s\S]*?”\s*/, '').length === 0;
  await capture({ type: remindAt ? 'task' : isClip ? 'clip' : 'note', text, url, pageTitle: url ? tab.title : '', remindAt, source: 'popup' });
  $('#note').value = '';
  $('#when').hidden = true;
  flash(remindAt ? 'Salvo com lembrete ⏰' : 'Anotação salva 🧠');
  renderExisting();
}

async function renderExisting() {
  const url = tab?.url;
  if (!url) return;
  const mine = (await loadItems()).filter((i) => i.url === url).slice(0, 10);
  $('#existing').hidden = !mine.length;
  $('#list').replaceChildren(...mine.map((it) => h('div', { class: 'li' },
    h('div', {}, `${TYPES[it.type]?.icon || '📝'} ${displayTitle(it)}`),
    h('small', {}, relTime(it.createdAt)))));
}

let t;
function flash(msg) {
  $('#msg').textContent = msg;
  clearTimeout(t);
  t = setTimeout(() => { $('#msg').textContent = ''; }, 2500);
}
