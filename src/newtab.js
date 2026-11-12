// NeuroTab — nova aba: inicialização. Cada parte da tela fica em src/newtab/*.js (ver docs/dev/ARQUITETURA.md).
import { DATA_KEY, BG_KEY, ACTIVE_KEY, BRAIN_KEY, loadData, saveData, loadBg } from './lib/store.js';
import * as Brain from './lib/brain.js';
import { $ } from './lib/ui.js';
import { semanticOn, indexItems, embedConfig } from './lib/semantic.js';
import { initI18n } from './lib/i18n.js';
import { initWindowManager } from './lib/window-manager.js';
import { S, listeners } from './newtab/state.js';
import { applyBackground, applySettings } from './newtab/appearance.js';
import { openItemDialog } from './newtab/editor.js';
import { repositionFree, setEditing } from './newtab/free.js';
import { setupClock } from './newtab/hero.js';
import { openWidgetPicker, renderLayoutPicker, setupLayouts } from './newtab/layouts.js';
import { editGroup, editLink, renderDock, setupExternalDrop, setupPanelBehaviour } from './newtab/rail.js';
import { setupOmni } from './newtab/search.js';
import { setupUpdates } from './newtab/updates.js';
import { setupVoice } from './newtab/voice.js';
import { setupWake, updateWake } from './newtab/wake.js';
import { isFree, layoutCols, layoutSig, renderWidgets } from './newtab/widgets.js';

init();

// Busca por significado: indexa notas novas/alteradas em segundo plano.
let indexTimer;
function scheduleIndex(delay = 6000) {
  clearTimeout(indexTimer);
  if (!semanticOn(S.data.settings) || !embedConfig(S.data.settings).supported) return;
  indexTimer = setTimeout(() => {
    indexItems(S.data.settings, S.items).catch((e) => console.warn('NeuroTab: indexação por significado falhou', e.message));
  }, delay);
}

async function init() {
  initWindowManager();
  S.data = await loadData();
  initI18n(S.data.settings.lang);
  S.items = await Brain.loadItems();
  const r = await chrome.storage.local.get(ACTIVE_KEY);
  S.activeId = S.data.groups.some((g) => g.id === r[ACTIVE_KEY]) ? r[ACTIVE_KEY] : S.data.groups[0].id;
  S.bgCache = await loadBg();
  applySettings();
  renderDock();
  renderWidgets();
  setupOmni();
  setupClock();
  scheduleIndex(3000);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes[DATA_KEY]) {
      const prevLang = S.data.settings.lang;
      S.data = await loadData();
      if ((S.data.settings.lang || 'auto') !== (prevLang || 'auto')) { location.reload(); return; }
      if (!S.data.groups.some((g) => g.id === S.activeId)) S.activeId = S.data.groups[0].id;
      applySettings();
      renderDock();
      if (layoutSig() !== S.widgetsSig) renderWidgets();
      if (S.editing) renderLayoutPicker();
      listeners.data.forEach((fn) => fn(S.data));
      scheduleIndex();
      updateWake(true);
    }
    if (changes[BRAIN_KEY]) {
      S.items = changes[BRAIN_KEY].newValue || [];
      listeners.brain.forEach((fn) => fn(S.items));
      scheduleIndex();
    }
    if (changes[BG_KEY]) { S.bgCache = changes[BG_KEY].newValue || null; applyBackground(); }
  });

  $('#addGroup').addEventListener('click', () => editGroup());
  $('#panelAdd').addEventListener('click', () => editLink());
  $('#pinDock').addEventListener('click', async () => {
    S.data.settings.dockPinned = !S.data.settings.dockPinned;
    await saveData(S.data);
  });
  $('#editLayout').addEventListener('click', () => setEditing(!S.editing));
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
      else if (layoutCols() !== S.gridCols) renderWidgets();
    }, 150);
  });
  setupUpdates();
  setupVoice();
  setupWake();
  setupExternalDrop();

  const m = location.hash.match(/item=([\w]+)/);
  if (m) {
    const it = S.items.find((x) => x.id === m[1]);
    if (it) openItemDialog(it);
    history.replaceState(null, '', location.pathname);
  }
}
