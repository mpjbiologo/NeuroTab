// NeuroTab — Janela de editar/criar um item do cérebro (nota, tarefa, lembrete, link).
import * as Brain from '../lib/brain.js';
import { isConfigured, enrich } from '../lib/ai.js';
import { confirmReserve } from '../lib/ai-ui.js';
import { $, h, toast, toLocalInput, fromLocalInput } from '../lib/ui.js';
import { S } from './state.js';
import { ctx } from './context.js';
import { mediaPanel } from './media-panel.js';
import { SOURCE_KINDS, SOURCE_TYPES, cleanSrc, sourceMeta, linkedItems, projectsOf, findSourceByUrl, listSources, fmtSize } from '../lib/sources.js';
import { t } from '../lib/i18n.js';

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
    $('#itemDlgTitle').textContent = item ? 'Editar' : x.type === 'source' ? 'Nova fonte' : 'Novo item';
    $('#itemMeta').textContent = item
      ? `Criado ${Brain.relTime(x.createdAt)} · origem: ${({ manual: 'digitado', voice: 'voz', context: 'botão direito', popup: 'página', keep: 'Google Keep' })[x.source] || x.source}${x.summary ? ' · Resumo: ' + x.summary : ''}`
      : '';
  };
  fill(it);
  // Fonte (0.9.3): metadados para páginas, mídias e fontes; nos outros itens, a fonte a que pertencem.
  f.srcKind.replaceChildren(...Object.entries(SOURCE_KINDS).map(([k, x]) => new Option(`${x.icon} ${t(x.label)}`, k)));
  $('#srcProjects').replaceChildren(...projectsOf(S.items).map((p) => new Option(p)));
  const sources = listSources(S.items).filter((x) => x.id !== it.id).slice(0, 300);
  f.sourceId.replaceChildren(new Option(`— ${t('nenhuma')} —`, ''), ...sources.map((x) => new Option(Brain.displayTitle(x).slice(0, 90), x.id)));
  const fillSrc = () => {
    const m = sourceMeta(it);
    f.srcKind.value = m.kind;
    f.srcAuthor.value = m.author;
    f.srcPublished.value = m.published;
    f.srcPublisher.value = m.publisher;
    f.srcProject.value = m.project;
    f.srcIdent.value = m.ident;
    f.sourceId.value = it.sourceId || '';
    const file = it.src?.file;
    $('#itemSrcFile').hidden = !file;
    if (file) $('#itemSrcFile').textContent = `📎 ${file.name}${file.size ? ' · ' + fmtSize(file.size) : ''}${file.pages ? ` · ${file.pages} ${t(file.pages === 1 ? 'página' : 'páginas')}` : ''}${file.textChars ? ` · ${t('texto lido para a busca')}` : ` · ${t('só os dados do arquivo (o arquivo não é copiado)')}`}`;
    const linked = item ? linkedItems(it, S.items) : [];
    const box = $('#itemSrcLinked');
    box.hidden = !linked.length;
    box.replaceChildren(h('small', { class: 'muted' }, `${linked.length} ${t('ligado(s) a esta fonte')}:`), ...linked.slice(0, 12).map((x) => h('button', { type: 'button', class: 'chip', onclick: () => { dlg.close('cancel'); setTimeout(() => openItemDialog(x), 0); } }, `${Brain.TYPES[x.type]?.icon || '📝'} ${Brain.displayTitle(x).slice(0, 48)}`)));
  };
  const paintSrc = () => {
    const isSrc = SOURCE_TYPES.includes(f.type.value);
    $('#itemSrc').hidden = !isSrc;
    $('#itemSrcPick').hidden = isSrc || !sources.length;
  };
  fillSrc();
  paintSrc();
  f.type.onchange = paintSrc;
  mediaPanel($('#itemMedia'), item && it.type === 'media' ? it : null, () => dlg.close('cancel'));
  $('#itemDelete').hidden = !item;
  // Item lido de uma imagem da biblioteca: botão para abrir a imagem (e analisar de novo).
  const img = $('#itemImage');
  img.parentElement.hidden = !it.captureId;
  img.onclick = () => chrome.windows.create({ url: chrome.runtime.getURL('src/analyze.html?id=' + encodeURIComponent(it.captureId)), type: 'popup', width: 560, height: 760 });
  const read = () => ({
    type: f.type.value,
    title: f.title.value.trim(),
    text: f.text.value.trim(),
    tags: f.tags.value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
    remindAt: fromLocalInput(f.remindAt.value),
    url: f.url.value.trim(),
    done: f.done.checked,
    pinned: f.pinned.checked,
    ...(SOURCE_TYPES.includes(f.type.value)
      ? { src: cleanSrc({ ...(it.src || {}), kind: f.srcKind.value, author: f.srcAuthor.value, published: f.srcPublished.value, publisher: f.srcPublisher.value, project: f.srcProject.value, ident: f.srcIdent.value, file: it.src?.file }) }
      : { sourceId: f.sourceId.value || undefined }),
  });
  $('#itemAi').onclick = async () => {
    if (!isConfigured(S.data.settings, 'organize')) { toast('Configure a IA em Configurações → IA'); return; }
    const btn = $('#itemAi');
    btn.disabled = true;
    btn.textContent = '✨ Organizando…';
    try {
      const cur = { ...it, ...read(), title: '' };
      let patch;
      try { patch = await enrich(S.data.settings, cur); } catch (e) { if (!confirmReserve(e)) throw e; patch = await enrich(S.data.settings, cur, { allowCloudReserve: true }); }
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
    if (SOURCE_TYPES.includes(it.type)) {
      const n = linkedItems(it, S.items).length;
      if (!confirm(`${t('Apagar a fonte')} "${Brain.displayTitle(it)}"? ${t('Ela fica 30 dias na lixeira.')}${n ? ` ${n} ${t('trecho(s) ou nota(s) ligados continuam no cérebro.')}` : ''}`)) return;
    }
    dlg.close('cancel');
    const r = await Brain.deleteItem(it.id);
    if (r) toast('Movido para a lixeira', 'Desfazer', () => Brain.restoreItem(r.removed));
  };
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const v = read();
    if (!v.text && !v.title && !v.url) return;
    if (!v.sourceId) delete v.sourceId;
    if (v.type === 'source' || SOURCE_TYPES.includes(v.type)) {
      const dup = v.url && findSourceByUrl(S.items.filter((x) => x.id !== it.id), v.url);
      if (dup && !item) {
        if (confirm(`${t('Já existe uma fonte com este link')}: "${Brain.displayTitle(dup)}". ${t('Abrir a que já existe?')}`)) setTimeout(() => openItemDialog(dup), 0);
        return;
      }
    }
    if (item) await Brain.updateItem(it.id, { ...v, summary: it.summary, ...(it.sourceId && !v.sourceId && !SOURCE_TYPES.includes(v.type) ? { sourceId: '' } : {}) });
    else await ctx.capture({ ...preset, ...v });
  };
  dlg.returnValue = '';
  dlg.showModal();
  (item ? f.text : f.text).focus();
}
