// Widget: meu cérebro — tudo o que foi salvo, com busca, filtros, seleção múltipla e lixeira.
import { h } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { PLATFORMS } from '../lib/media-links.js';
import {
  TYPES, displayTitle, relTime, searchItems, updateItem, fmtDateTime, toMarkdown,
  trashItems, loadTrash, restoreFromTrash, purgeTrash, TRASH_DAYS,
} from '../lib/brain.js';
import { hostOf } from '../lib/store.js';
import { SOURCE_KINDS, sourceMeta, linkedItems, listSources, projectsOf, uncitedLinks, isSource } from '../lib/sources.js';
import { pickSourceFile } from '../lib/source-files.js';

const FILTERS = [
  ['all', 'Tudo'], ['sources', '📚 Fontes'], ['note', '📝 Notas'], ['task', '☑️ Tarefas'], ['clip', '✂️ Trechos'], ['page', '🔖 Páginas'], ['idea', '💡 Ideias'], ['image', '🖼️ Imagens'], ['media', '🎬 Mídia'], ['pinned', '📌'], ['trash', '🗑'],
];

export function itemRow(it, ctx, { checkbox = false, select = null, semantic = false, sources = null } = {}) {
  const tags = (it.tags || []).slice(0, 4).map((t) => h('span', { class: 'tag' }, '#' + t));
  const when = h('span', {}, it.deletedAt ? `apagado ${relTime(it.deletedAt)}` : relTime(it.createdAt));
  const meta = [when];
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
    lead = h('span', { class: 'ic' }, it.pinned ? '📌' : it.type === 'media' ? PLATFORMS[it.media?.platform]?.icon || '🎬' : TYPES[it.type]?.icon || '📝');
  }
  if (it.type === 'media') {
    if (it.media?.category) meta.push(h('span', { class: 'tag cat' }, it.media.category));
    else meta.push(h('span', { class: 'when' }, '⏳ ' + t('resumo pendente')));
  }
  if (sources && isSource(it)) {
    // Fonte (0.9.3): tipo, autor, ano, projeto e quantos trechos/notas estão ligados
    const m = sourceMeta(it);
    if (!select && !checkbox && !it.pinned) lead = h('span', { class: 'ic', title: t(SOURCE_KINDS[m.kind].label) }, SOURCE_KINDS[m.kind].icon);
    when.textContent = '· ' + when.textContent;
    meta.unshift(h('span', { class: 'src-kind' }, t(SOURCE_KINDS[m.kind].label)));
    if (m.author) meta.splice(1, 0, h('span', {}, '· ' + m.author));
    if (m.published) meta.splice(m.author ? 2 : 1, 0, h('span', {}, '· ' + m.published.slice(0, 4)));
    if (m.project) meta.push(h('span', { class: 'tag proj', title: t('Projeto') }, '📁 ' + m.project));
    const n = linkedItems(it, sources).length;
    if (n) meta.push(h('span', { class: 'tag', title: t('Trechos e notas ligados') }, `🔗 ${n}`));
    if (it.src?.file) meta.push(h('span', { title: it.src.file.name }, '· 📎'));
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
    let srcKind = '';
    let srcProject = '';
    let semTimer;
    const picked = new Set();
    const select = {
      has: (id) => picked.has(id),
      toggle: (id, on) => { (on ?? !picked.has(id)) ? picked.add(id) : picked.delete(id); render(); },
    };

    const search = h('input', { type: 'search', placeholder: 'Buscar no cérebro…' });
    const chips = FILTERS.map(([k, label]) => h('button', { class: 'chip' + (k === filter ? ' sel' : ''), type: 'button', title: k === 'trash' ? `Lixeira (${TRASH_DAYS} dias)` : k === 'pinned' ? 'Fixados' : null, onclick: () => setFilter(k) }, label));
    const bar = h('div', { class: 'sel-bar', hidden: true });
    // Fontes (0.9.3): filtros por tipo e projeto, nova fonte e fonte a partir de um arquivo
    const kindSel = h('select', { class: 'small', title: t('Tipo de fonte'), onchange: () => { srcKind = kindSel.value; sem = null; render(); askSemantic(); } },
      new Option(t('Todos os tipos'), ''), ...Object.entries(SOURCE_KINDS).map(([k, x]) => new Option(`${x.icon} ${t(x.label)}`, k)));
    const projSel = h('select', { class: 'small', title: t('Projeto'), onchange: () => { srcProject = projSel.value; sem = null; render(); askSemantic(); } });
    const srcBar = h('div', { class: 'toolbar src-bar', hidden: true },
      kindSel, projSel, h('span', { class: 'grow' }),
      h('button', { class: 'chip', type: 'button', title: t('Cadastrar uma fonte: link, livro, artigo…'), onclick: () => ctx.newItem({ type: 'source', src: { kind: 'link', project: srcProject && srcProject !== '-' ? srcProject : '' } }) }, `＋ ${t('Nova fonte')}`),
      h('button', { class: 'chip', type: 'button', title: t('PDF, texto, áudio, vídeo… Guarda os dados e, quando dá, o texto para a busca. O arquivo não é copiado.'), onclick: async () => {
        try {
          const preset = await pickSourceFile();
          if (!preset) return;
          const { note, ...p } = preset;
          if (note) ctx.toast(note);
          ctx.newItem({ ...p, src: { ...p.src, project: srcProject && srcProject !== '-' ? srcProject : '' } });
        } catch (e) { ctx.toast(e.message); }
      } }, `📎 ${t('De um arquivo')}`));
    const paintProjects = () => {
      const ps = projectsOf(ctx.items);
      if (srcProject && srcProject !== '-' && !ps.includes(srcProject)) srcProject = '';
      projSel.replaceChildren(new Option(t('Todos os projetos'), ''), ...ps.map((p) => new Option('📁 ' + p, p)), new Option(t('Sem projeto'), '-'));
      projSel.value = srcProject;
    };
    const list = h('div', { class: 'items' });
    const selBtn = h('button', { title: 'Selecionar vários', onclick: () => { selecting = !selecting; picked.clear(); render(); } }, '☑');
    ctx.actions.append(selBtn, h('button', { title: 'Nova nota', onclick: () => ctx.newItem({}) }, '＋'));
    search.addEventListener('input', () => { q = search.value; limit = 25; render(); askSemantic(); });

    // Busca por significado: roda depois de uma pausa na digitação e reordena a lista.
    function askSemantic() {
      clearTimeout(semTimer);
      const query = q.trim();
      if (!ctx.semanticOn() || filter === 'trash' || query.length < 3) return;
      const key = filter + srcKind + srcProject + '|' + query;
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
      srcBar.hidden = k !== 'sources';
      search.placeholder = t(k === 'sources' ? 'Buscar nas fontes (título, autor, projeto, DOI…)' : 'Buscar no cérebro…');
      if (k === 'sources') paintProjects();
      if (k === 'trash') loadTrash().then((t) => { trash = t; render(); });
      else { render(); askSemantic(); }
    }

    function base() {
      let arr = filter === 'trash' ? trash : ctx.items;
      if (filter === 'pinned') arr = arr.filter((i) => i.pinned);
      else if (filter === 'sources') arr = listSources(arr, { kind: srcKind, project: srcProject });
      else if (filter !== 'all' && filter !== 'trash') arr = arr.filter((i) => i.type === filter);
      return arr;
    }

    function visible() {
      const arr = base();
      if (q.trim() && sem?.key === filter + srcKind + srcProject + '|' + q.trim()) {
        const live = new Map(arr.map((i) => [i.id, i]));
        return sem.list.map((i) => live.get(i.id)).filter(Boolean);
      }
      if (filter === 'sources') return q.trim() ? listSources(arr, { q }) : arr;
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
          : h('span', { class: 'empty' }, '🧠 Tudo que você salvar aparece aqui: notas, trechos e páginas.')));
        if (filter === 'sources' && !q.trim()) {
          list.replaceChildren(h('p', { class: 'muted' }, t('📚 Páginas e mídias salvas aparecem aqui como fontes. Cadastre também livros, artigos, PDFs e arquivos em ＋ Nova fonte.')), ...uncitedBox());
        }
        return;
      }
      arr.slice(0, limit).forEach((it) => list.append(itemRow(it, ctx, { select: selecting || filter === 'trash' ? select : null, semantic: !!sem?.semIds.has(it.id) && sem.key === filter + srcKind + srcProject + '|' + q.trim(), sources: filter === 'sources' ? ctx.items : null })));
      if (arr.length > limit) list.append(h('button', { class: 'btn more', onclick: () => { limit += 50; render(); } }, `Ver mais (${arr.length - limit})`));
      if (filter === 'sources' && !q.trim()) list.append(...uncitedBox());
    }

    /** Links citados em trechos e notas sem fonte cadastrada: um clique vira fonte. */
    function uncitedBox() {
      const links = uncitedLinks(ctx.items);
      if (!links.length) return [];
      return [h('details', { class: 'src-uncited' },
        h('summary', {}, `🔗 ${t('Links citados sem fonte')} (${links.length})`),
        ...links.map((l) => h('div', { class: 'item' },
          h('span', { class: 'ic' }, '🔗'),
          h('div', { class: 'body' }, h('div', { class: 'tt' }, l.title || hostOf(l.url)), h('div', { class: 'mt' }, h('span', {}, hostOf(l.url)), h('span', {}, `· ${l.count} ${t('item(ns)')}`))),
          h('button', { class: 'chip', type: 'button', onclick: () => ctx.newItem({ type: 'source', url: l.url, title: l.title, src: { kind: 'link' } }) }, `＋ ${t('Fonte')}`))))];
    }

    el.append(search, h('div', { class: 'toolbar' }, ...chips), srcBar, bar, list);
    render();
    const off = ctx.on('brain', async () => {
      if (filter === 'trash') trash = await loadTrash();
      for (const id of [...picked]) if (!(filter === 'trash' ? trash : ctx.items).some((i) => i.id === id)) picked.delete(id);
      sem = null;
      if (filter === 'sources') paintProjects();
      render();
      askSemantic();
    });
    return { destroy: off };
  },
};
