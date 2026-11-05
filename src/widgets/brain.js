// Widget: meu cérebro — tudo o que foi salvo, com busca, filtros, seleção múltipla e lixeira.
import { h } from '../lib/ui.js';
import {
  TYPES, displayTitle, relTime, searchItems, updateItem, fmtDateTime, toMarkdown,
  trashItems, loadTrash, restoreFromTrash, purgeTrash, TRASH_DAYS,
} from '../lib/brain.js';
import { hostOf } from '../lib/store.js';

const FILTERS = [
  ['all', 'Tudo'], ['note', '📝 Notas'], ['task', '☑️ Tarefas'], ['clip', '✂️ Trechos'], ['page', '🔖 Páginas'], ['idea', '💡 Ideias'], ['pinned', '📌'], ['trash', '🗑'],
];

export function itemRow(it, ctx, { checkbox = false, select = null, semantic = false } = {}) {
  const tags = (it.tags || []).slice(0, 4).map((t) => h('span', { class: 'tag' }, '#' + t));
  const meta = [h('span', {}, it.deletedAt ? `apagado ${relTime(it.deletedAt)}` : relTime(it.createdAt))];
  if (semantic) meta.unshift(h('span', { class: 'sem-hit', title: 'Encontrado pelo significado' }, '✨'));
  if (it.url) meta.push(h('span', {}, '· ' + hostOf(it.url)));
  if (it.remindAt && !it.done && !it.deletedAt) {
    const late = it.remindAt < Date.now();
    const today = new Date(it.remindAt).toDateString() === new Date().toDateString();
    meta.push(h('span', { class: 'when' + (late ? ' late' : today ? ' today' : '') }, '⏰ ' + fmtDateTime(it.remindAt)));
  }
  let lead;
  if (select) {
    lead = h('input', { type: 'checkbox', class: 'sel-box', checked: select.has(it.id), onclick: (e) => e.stopPropagation(), onchange: (e) => select.toggle(it.id, e.target.checked) });
  } else if (checkbox) {
    lead = h('input', { type: 'checkbox', checked: it.done, onclick: (e) => e.stopPropagation(), onchange: (e) => updateItem(it.id, { done: e.target.checked }) });
  } else {
    lead = h('span', { class: 'ic' }, it.pinned ? '📌' : TYPES[it.type]?.icon || '📝');
  }
  return h('div', {
    class: 'item' + (it.done ? ' done' : '') + (select?.has(it.id) ? ' picked' : ''),
    onclick: () => (select ? select.toggle(it.id) : it.deletedAt ? null : ctx.openItem(it)),
  },
  lead,
  h('div', { class: 'body' },
    h('div', { class: 'tt' }, displayTitle(it)),
    (it.summary || (it.title && it.text)) && h('div', { class: 'tx' }, it.summary || it.text),
    h('div', { class: 'mt' }, ...meta, ...tags)));
}

export default {
  id: 'brain',
  title: 'Meu cérebro',
  icon: '🧠',
  description: 'Notas, trechos, páginas e ideias salvas — com busca, filtros, seleção e lixeira.',
  defaultW: 6,
  mount(el, ctx) {
    let filter = 'all';
    let q = '';
    let limit = 25;
    let selecting = false;
    let trash = [];
    let sem = null; // { key, list, semIds } — resultado da busca por significado
    let semTimer;
    const picked = new Set();
    const select = {
      has: (id) => picked.has(id),
      toggle: (id, on) => { (on ?? !picked.has(id)) ? picked.add(id) : picked.delete(id); render(); },
    };

    const search = h('input', { type: 'search', placeholder: 'Buscar no cérebro…' });
    const chips = FILTERS.map(([k, label]) => h('button', { class: 'chip' + (k === filter ? ' sel' : ''), type: 'button', title: k === 'trash' ? `Lixeira (${TRASH_DAYS} dias)` : '', onclick: () => setFilter(k) }, label));
    const bar = h('div', { class: 'sel-bar', hidden: true });
    const list = h('div', { class: 'items' });
    const selBtn = h('button', { title: 'Selecionar vários', onclick: () => { selecting = !selecting; picked.clear(); render(); } }, '☑');
    ctx.actions.append(selBtn, h('button', { title: 'Nova nota', onclick: () => ctx.newItem({}) }, '＋'));
    search.addEventListener('input', () => { q = search.value; limit = 25; render(); askSemantic(); });

    // Busca por significado: roda depois de uma pausa na digitação e reordena a lista.
    function askSemantic() {
      clearTimeout(semTimer);
      const query = q.trim();
      if (!ctx.semanticOn() || filter === 'trash' || query.length < 3) return;
      const key = filter + '|' + query;
      if (sem?.key === key) return;
      semTimer = setTimeout(async () => {
        try {
          const res = await ctx.smartSearch(query, 200, base());
          if (q.trim() !== query) return;
          sem = { key, list: res.map((x) => x.it), semIds: new Set(res.filter((x) => x.sem && !x.kw).map((x) => x.it.id)) };
          render();
        } catch (e) { console.warn(e); }
      }, 450);
    }

    function setFilter(k) {
      if ((k === 'trash') !== (filter === 'trash')) selecting = false;
      filter = k;
      limit = 25;
      picked.clear();
      chips.forEach((c, i) => c.classList.toggle('sel', FILTERS[i][0] === k));
      if (k === 'trash') loadTrash().then((t) => { trash = t; render(); });
      else { render(); askSemantic(); }
    }

    function base() {
      let arr = filter === 'trash' ? trash : ctx.items;
      if (filter === 'pinned') arr = arr.filter((i) => i.pinned);
      else if (filter !== 'all' && filter !== 'trash') arr = arr.filter((i) => i.type === filter);
      return arr;
    }

    function visible() {
      const arr = base();
      if (q.trim() && sem?.key === filter + '|' + q.trim()) {
        const live = new Map(arr.map((i) => [i.id, i]));
        return sem.list.map((i) => live.get(i.id)).filter(Boolean);
      }
      return q.trim() ? searchItems(arr, q, 500) : [...arr].sort((a, b) => filter === 'trash' ? b.deletedAt - a.deletedAt : (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
    }

    function renderBar(arr) {
      const inTrash = filter === 'trash';
      bar.hidden = !(selecting || inTrash);
      selBtn.classList.toggle('sel', selecting);
      if (bar.hidden) return;
      const n = picked.size;
      const ids = () => [...picked];
      const all = h('button', { class: 'chip', onclick: () => { if (picked.size === arr.length) picked.clear(); else arr.forEach((i) => picked.add(i.id)); render(); } }, picked.size && picked.size === arr.length ? 'Nenhum' : 'Todos');
      if (inTrash) {
        bar.replaceChildren(
          h('span', { class: 'muted' }, `🗑 Itens apagados ficam ${TRASH_DAYS} dias aqui.`),
          h('span', { class: 'grow' }),
          all,
          h('button', { class: 'chip', disabled: !n, onclick: async () => { const c = await restoreFromTrash(ids()); picked.clear(); trash = await loadTrash(); ctx.toast(`${c} item(ns) restaurado(s)`); render(); } }, `↩ Restaurar${n ? ` (${n})` : ''}`),
          h('button', { class: 'chip danger', disabled: !trash.length, onclick: async () => {
            const target = n ? ids() : null;
            if (!confirm(target ? `Apagar definitivamente ${n} item(ns)?` : `Esvaziar a lixeira (${trash.length} itens)? Não dá para desfazer.`)) return;
            await purgeTrash(target);
            picked.clear();
            trash = await loadTrash();
            render();
          } }, n ? `Apagar de vez (${n})` : 'Esvaziar lixeira'));
        return;
      }
      bar.replaceChildren(
        h('span', { class: 'muted' }, n ? `${n} selecionado(s)` : 'Toque nos itens para selecionar'),
        h('span', { class: 'grow' }),
        all,
        h('button', { class: 'chip', disabled: !n, onclick: async () => { for (const id of ids()) await updateItem(id, { done: true }); ctx.toast('Marcados como concluídos'); } }, '✓ Concluir'),
        h('button', { class: 'chip', disabled: !n, onclick: async () => {
          const tag = prompt('Adicionar qual tag aos itens selecionados?');
          if (!tag) return;
          const t = tag.trim().replace(/^#/, '').toLowerCase();
          for (const it of ctx.items.filter((i) => picked.has(i.id))) await updateItem(it.id, { tags: [...new Set([...(it.tags || []), t])] });
          ctx.toast(`Tag #${t} adicionada`);
        } }, '#️⃣ Tag'),
        h('button', { class: 'chip', disabled: !n, onclick: () => {
          const md = toMarkdown(ctx.items.filter((i) => picked.has(i.id)));
          const a = h('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: `neurotab-selecao-${new Date().toISOString().slice(0, 10)}.md` });
          a.click();
        } }, '⬇ .md'),
        h('button', { class: 'chip danger', disabled: !n, onclick: async () => {
          const moved = await trashItems(ids());
          picked.clear();
          ctx.toast(`${moved.length} item(ns) na lixeira`, 'Desfazer', () => restoreFromTrash(moved.map((m) => m.id)));
        } }, '🗑 Excluir'),
        h('button', { class: 'chip', onclick: () => { selecting = false; picked.clear(); render(); } }, 'Fechar'));
    }

    function render() {
      const arr = visible();
      renderBar(arr);
      list.replaceChildren();
      if (!arr.length) {
        list.append(h('p', { class: 'muted' }, filter === 'trash' ? 'A lixeira está vazia.' : ctx.items.length
          ? 'Nada encontrado.'
          : 'Seu cérebro está vazio. Use a Captura rápida, o botão direito em qualquer página (NeuroTab → Salvar trecho) ou o ícone da extensão.'));
        return;
      }
      arr.slice(0, limit).forEach((it) => list.append(itemRow(it, ctx, { select: selecting || filter === 'trash' ? select : null, semantic: !!sem?.semIds.has(it.id) && sem.key === filter + '|' + q.trim() })));
      if (arr.length > limit) list.append(h('button', { class: 'btn more', onclick: () => { limit += 50; render(); } }, `Ver mais (${arr.length - limit})`));
    }

    el.append(search, h('div', { class: 'toolbar' }, ...chips), bar, list);
    render();
    const off = ctx.on('brain', async () => {
      if (filter === 'trash') trash = await loadTrash();
      for (const id of [...picked]) if (!(filter === 'trash' ? trash : ctx.items).some((i) => i.id === id)) picked.delete(id);
      sem = null;
      render();
      askSemantic();
    });
    return { destroy: off };
  },
};
