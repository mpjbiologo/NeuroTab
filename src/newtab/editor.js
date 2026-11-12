// NeuroTab — Janela de editar/criar um item do cérebro (nota, tarefa, lembrete, link).
import * as Brain from '../lib/brain.js';
import { isConfigured, enrich } from '../lib/ai.js';
import { $, toast, toLocalInput, fromLocalInput } from '../lib/ui.js';
import { S } from './state.js';
import { ctx } from './context.js';

// =====================================================================
// ITEM DO CÉREBRO (editar/criar)
// =====================================================================
export function openItemDialog(item, preset = {}) {
  const dlg = $('#itemDlg');
  const f = $('#itemForm');
  const it = item || Brain.makeItem(preset);
  f.type.replaceChildren(...Object.entries(Brain.TYPES).map(([k, t]) => new Option(`${t.icon} ${t.label}`, k)));
  const fill = (x) => {
    f.type.value = x.type;
    f.title.value = x.title || '';
    f.text.value = x.text || '';
    f.tags.value = (x.tags || []).join(', ');
    f.remindAt.value = toLocalInput(x.remindAt);
    f.url.value = x.url || '';
    f.done.checked = !!x.done;
    f.pinned.checked = !!x.pinned;
    $('#itemDlgTitle').textContent = item ? 'Editar' : 'Novo item';
    $('#itemMeta').textContent = item
      ? `Criado ${Brain.relTime(x.createdAt)} · origem: ${({ manual: 'digitado', voice: 'voz', context: 'botão direito', popup: 'página', keep: 'Google Keep' })[x.source] || x.source}${x.summary ? ' · Resumo: ' + x.summary : ''}`
      : '';
  };
  fill(it);
  $('#itemDelete').hidden = !item;
  const read = () => ({
    type: f.type.value,
    title: f.title.value.trim(),
    text: f.text.value.trim(),
    tags: f.tags.value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
    remindAt: fromLocalInput(f.remindAt.value),
    url: f.url.value.trim(),
    done: f.done.checked,
    pinned: f.pinned.checked,
  });
  $('#itemAi').onclick = async () => {
    if (!isConfigured(S.data.settings)) { toast('Configure a IA em Configurações → IA'); return; }
    const btn = $('#itemAi');
    btn.disabled = true;
    btn.textContent = '✨ Organizando…';
    try {
      const cur = { ...it, ...read(), title: '' };
      const patch = await enrich(S.data.settings, cur);
      fill({ ...cur, ...patch, title: patch.title || read().title, type: patch.type || cur.type });
      if (patch.summary) $('#itemMeta').textContent = 'Resumo: ' + patch.summary;
      it.summary = patch.summary || it.summary;
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Organizar com IA';
    }
  };
  $('#itemDelete').onclick = async () => {
    dlg.close('cancel');
    const r = await Brain.deleteItem(it.id);
    if (r) toast('Movido para a lixeira', 'Desfazer', () => Brain.restoreItem(r.removed));
  };
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const v = read();
    if (!v.text && !v.title && !v.url) return;
    if (item) await Brain.updateItem(it.id, { ...v, summary: it.summary });
    else await ctx.capture({ ...preset, ...v });
  };
  dlg.returnValue = '';
  dlg.showModal();
  (item ? f.text : f.text).focus();
}
