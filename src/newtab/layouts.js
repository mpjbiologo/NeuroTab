// NeuroTab — Layouts salvos e o seletor de widgets para adicionar ao painel.
import { uid } from '../lib/store.js';
import { $, h, toast } from '../lib/ui.js';
import { WIDGETS } from '../widgets/index.js';
import { S } from './state.js';
import { autoPlace, rearrangeFree, saveWidgets, setLayoutMode } from './free.js';
import { isFree, renderWidgets } from './widgets.js';

// ---------- Layouts salvos ----------
export function renderLayoutPicker() {
  const s = S.data.settings;
  const sel = $('#layoutSel');
  const opts = [new Option('— Layout atual —', '')];
  for (const l of s.layouts) opts.push(new Option(l.name, l.id));
  sel.replaceChildren(...opts);
  sel.value = s.layouts.some((l) => l.id === s.activeLayout) ? s.activeLayout : '';
  $('#layoutDel').hidden = !sel.value;
}

export function setupLayouts() {
  $('#layoutSel').addEventListener('change', async (e) => {
    const s = S.data.settings;
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
    const s = S.data.settings;
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
    const s = S.data.settings;
    const l = s.layouts.find((x) => x.id === s.activeLayout);
    if (!l || !confirm(`Excluir o layout "${l.name}"? Os widgets na tela continuam.`)) return;
    s.layouts = s.layouts.filter((x) => x !== l);
    s.activeLayout = '';
    await saveWidgets();
    renderLayoutPicker();
  });
}

export function openWidgetPicker() {
  const dlg = $('#widgetDlg');
  const used = new Set(S.data.settings.widgets.map((w) => w.id));
  const list = $('#widgetList');
  list.replaceChildren(...Object.values(WIDGETS).map((def) => h('button', {
    type: 'button',
    disabled: used.has(def.id) && !def.multiple,
    onclick: async () => {
      const nw = { id: def.id, w: def.defaultW || 6 };
      if (isFree()) Object.assign(nw, autoPlace(nw, $('#widgets').clientWidth), { fz: ++S.zTop });
      S.data.settings.widgets.push(nw);
      await saveWidgets();
      renderWidgets();
      dlg.close();
      $(`.widget[data-idx="${S.data.settings.widgets.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  }, h('span', { class: 'wi' }, def.icon), h('span', {}, h('b', {}, def.title), h('small', {}, used.has(def.id) ? 'Já está na tela' : def.description)))));
  dlg.showModal();
}
