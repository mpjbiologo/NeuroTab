// NeuroTab — Modo grade: widgets organizados em colunas responsivas.
import { $, h } from '../lib/ui.js';
import { WIDGETS } from '../widgets/index.js';
import { S } from './state.js';
import { applyWidgetSize, saveWidgets, setupResize } from './free.js';
import { clearDropMarks } from './rail.js';
import { buildCard, layoutCols, mountCard, renderWidgets } from './widgets.js';

// =====================================================================
// GRADE
// =====================================================================
export function renderGrid() {
  const center = $('#center');
  const box = $('#widgets');
  box.replaceChildren();
  box.style.height = '';
  S.gridCols = layoutCols();
  box.style.gridTemplateColumns = `repeat(${S.gridCols}, minmax(0, 1fr))`;
  const list = S.data.settings.widgets;
  list.forEach((w, idx) => {
    if (!WIDGETS[w.id]) return;
    const parts = buildCard(w, idx);
    const { card, grip } = parts;
    card.draggable = S.editing;
    applyWidgetSize(card, w);
    setupResize(card, grip, idx);
    card.addEventListener('dragstart', (e) => { if (!S.editing || e.target !== card) return e.preventDefault(); S.drag = { type: 'widget', id: idx }; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { S.drag = null; card.classList.remove('dragging'); clearDropMarks(); });
    card.addEventListener('dragover', (e) => { if (S.drag?.type === 'widget' && S.drag.id !== idx) { e.preventDefault(); card.classList.add('drop-target'); } });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', async (e) => {
      if (S.drag?.type !== 'widget') return;
      e.preventDefault();
      const arr = S.data.settings.widgets;
      const [moved] = arr.splice(S.drag.id, 1);
      arr.splice(idx, 0, moved);
      S.drag = null;
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
