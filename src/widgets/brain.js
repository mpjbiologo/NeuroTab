// Widget: meu cérebro — tudo o que foi salvo, com busca e filtros.
import { h } from '../lib/ui.js';
import { TYPES, displayTitle, relTime, searchItems, updateItem, fmtDateTime } from '../lib/brain.js';
import { hostOf } from '../lib/store.js';

const FILTERS = [
  ['all', 'Tudo'], ['note', '📝 Notas'], ['task', '☑️ Tarefas'], ['clip', '✂️ Trechos'], ['page', '🔖 Páginas'], ['idea', '💡 Ideias'], ['pinned', '📌'],
];

export function itemRow(it, ctx, { checkbox = false } = {}) {
  const tags = (it.tags || []).slice(0, 4).map((t) => h('span', { class: 'tag' }, '#' + t));
  const meta = [h('span', {}, relTime(it.createdAt))];
  if (it.url) meta.push(h('span', {}, '· ' + hostOf(it.url)));
  if (it.remindAt && !it.done) {
    const late = it.remindAt < Date.now();
    const today = new Date(it.remindAt).toDateString() === new Date().toDateString();
    meta.push(h('span', { class: 'when' + (late ? ' late' : today ? ' today' : '') }, '⏰ ' + fmtDateTime(it.remindAt)));
  }
  const row = h('div', { class: 'item' + (it.done ? ' done' : ''), onclick: () => ctx.openItem(it) },
    checkbox
      ? h('input', { type: 'checkbox', checked: it.done, onclick: (e) => e.stopPropagation(), onchange: (e) => updateItem(it.id, { done: e.target.checked }) })
      : h('span', { class: 'ic' }, it.pinned ? '📌' : TYPES[it.type]?.icon || '📝'),
    h('div', { class: 'body' },
      h('div', { class: 'tt' }, displayTitle(it)),
      (it.summary || (it.title && it.text)) && h('div', { class: 'tx' }, it.summary || it.text),
      h('div', { class: 'mt' }, ...meta, ...tags),
    ),
  );
  return row;
}

export default {
  id: 'brain',
  title: 'Meu cérebro',
  icon: '🧠',
  description: 'Notas, trechos, páginas e ideias salvas — com busca e filtros.',
  defaultSize: 'm',
  mount(el, ctx) {
    let filter = 'all';
    let q = '';
    let limit = 25;
    const search = h('input', { type: 'search', placeholder: 'Buscar no cérebro…' });
    const chips = FILTERS.map(([k, label]) => h('button', { class: 'chip' + (k === filter ? ' sel' : ''), type: 'button', onclick: () => { filter = k; limit = 25; chips.forEach((c, i) => c.classList.toggle('sel', FILTERS[i][0] === k)); render(); } }, label));
    const list = h('div', { class: 'items' });
    ctx.actions.append(h('button', { title: 'Nova nota', onclick: () => ctx.newItem({}) }, '＋'));
    search.addEventListener('input', () => { q = search.value; limit = 25; render(); });

    function render() {
      let arr = ctx.items;
      if (filter === 'pinned') arr = arr.filter((i) => i.pinned);
      else if (filter !== 'all') arr = arr.filter((i) => i.type === filter);
      arr = q.trim() ? searchItems(arr, q, 200) : [...arr].sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
      list.replaceChildren();
      if (!arr.length) {
        list.append(h('p', { class: 'muted' }, ctx.items.length
          ? 'Nada encontrado.'
          : 'Seu cérebro está vazio. Use a Captura rápida, o botão direito em qualquer página (NeuroTab → Salvar trecho) ou o ícone da extensão.'));
        return;
      }
      arr.slice(0, limit).forEach((it) => list.append(itemRow(it, ctx)));
      if (arr.length > limit) list.append(h('button', { class: 'btn more', onclick: () => { limit += 50; render(); } }, `Ver mais (${arr.length - limit})`));
    }
    el.append(search, h('div', { class: 'toolbar' }, ...chips), list);
    render();
    const off = ctx.on('brain', render);
    return { destroy: off };
  },
};
