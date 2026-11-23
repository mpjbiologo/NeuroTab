// NeuroTab — navegação das configurações (#46): categorias na lateral esquerda, cada uma com sub-abas,
// conteúdo ocupando a tela, busca, links antigos (#ia, #contas…) e gaveta em telas estreitas.
//
// O HTML continua com as seções de antes; cada <h2 data-page="…"> começa uma sub-aba. Aqui as seções viram
// páginas (.pane), e o menu é montado a partir de NAV.
import { h } from './lib/ui.js';
import { t } from './lib/i18n.js';

export const NAV = [
  { id: 'aparencia', icon: '🎨', label: 'Aparência', pages: ['tema', 'editor', 'layout', 'estilo-atalhos', 'fundo', 'slides'] },
  { id: 'novaaba', icon: '🏠', label: 'Nova aba', pages: ['pesquisa', 'atalhos', 'relogio', 'timer'] },
  { id: 'ia', icon: '🤖', label: 'Inteligência artificial', pages: ['ia', 'ia-tarefas', 'ia-organizar'] },
  { id: 'voz', icon: '🎙️', label: 'Voz', pages: ['voz', 'voz-leitura', 'voz-ativacao', 'voz-conversa', 'voz-comandos'] },
  { id: 'midia', icon: '🎞️', label: 'Mídia', pages: ['imagens', 'salvar-midia'] },
  { id: 'notas', icon: '📝', label: 'Notas', pages: ['keep', 'exportar-notas', 'limpeza', 'integracoes'] },
  { id: 'contas', icon: '☁️', label: 'Contas e sincronização', pages: ['contas', 'sync'] },
  { id: 'privacidade', icon: '🔒', label: 'Privacidade', pages: ['permissoes'] },
  { id: 'backup', icon: '💾', label: 'Backup', pages: ['importar', 'exportar'] },
  { id: 'sistema', icon: '⚙️', label: 'Sistema', pages: ['armazenamento', 'atualizacoes', 'apps', 'creditos'] },
  { id: 'apoie', icon: '❤', label: 'Apoie', pages: ['apoie'], heart: true },
];

// Endereços das abas antigas (#ia, #contas…) continuam funcionando.
export const LEGACY = { geral: 'tema', fundo: 'fundo', ia: 'ia', midia: 'imagens', notas: 'keep', contas: 'contas', backup: 'importar', apoie: 'apoie', 'reset-tema': 'editor', videos: 'salvar-midia', sobre: 'creditos', ponte: 'apps', 'apps-externos': 'apps', aparencia: 'editor', tarefas: 'ia-tarefas' };
const FIRST = 'tema';

const $ = (s) => document.querySelector(s);
const fold = (x) => String(x || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Transforma as seções em páginas: cada h2[data-page] e o que vem depois dele, até o próximo. */
export function buildPanes(main = $('main')) {
  const panes = new Map();
  for (const sec of [...main.querySelectorAll(':scope > section')]) {
    let pane = null;
    for (const node of [...sec.childNodes]) {
      if (node.nodeType === 1 && node.matches('h2[data-page]')) {
        const id = node.dataset.page;
        pane = h('section', { class: 'pane', id: 'page-' + id, 'data-page': id, hidden: true, tabindex: '-1' });
        node.classList.add('pane-title');
        main.append(pane);
        panes.set(id, pane);
      }
      if (pane) pane.append(node);
      else if (node.nodeType === 1 || node.textContent.trim()) {
        // conteúdo antes do primeiro título: vai para a primeira página dessa seção (se houver)
        sec.dataset.orphan = '1';
      }
    }
    if (!sec.dataset.orphan) sec.remove();
  }
  // opções com campo de texto ou vários botões ocupam a linha toda; as simples ficam lado a lado
  for (const pane of panes.values()) {
    for (const opt of pane.querySelectorAll(':scope > .opt')) {
      const fields = opt.querySelectorAll('input:not([type]), input[type=text], input[type=url], input[type=password], input[type=search], textarea').length;
      if (fields || opt.querySelectorAll('button, .btn').length > 1) opt.classList.add('wide');
    }
  }
  return panes;
}

export function setupNav() {
  const panes = buildPanes();
  const nav = $('#sideNav');
  const crumb = $('#crumb');
  const side = $('#side');
  const scrim = $('#sideScrim');
  const menuBtn = $('#menuBtn');
  const search = $('#setSearch');
  const catOf = (page) => NAV.find((c) => c.pages.includes(page));
  const title = (page) => panes.get(page)?.querySelector('.pane-title')?.textContent.trim() || page;
  let current = null;

  const links = new Map();
  const groups = [];
  nav.replaceChildren(...NAV.map((cat) => {
    const list = h('ul', { class: 'side-sub', id: 'sub-' + cat.id });
    const head = h('button', { class: 'side-cat' + (cat.heart ? ' heart' : ''), type: 'button', 'aria-expanded': 'false', 'aria-controls': list.id,
      onclick: () => { const open = head.getAttribute('aria-expanded') !== 'true'; if (cat.pages.length === 1 || !open) { go(cat.pages[0]); } else toggle(cat, true); } },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, cat.icon), h('span', { class: 'lbl' }, cat.label),
      cat.pages.length > 1 ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : null);
    for (const page of cat.pages) {
      if (!panes.has(page)) continue;
      const a = h('a', { href: '#' + page, class: 'side-link', 'data-page': page, onclick: (e) => { e.preventDefault(); go(page); } }, title(page));
      links.set(page, a);
      list.append(h('li', {}, a));
    }
    const g = h('div', { class: 'side-group', 'data-cat': cat.id }, head, cat.pages.length > 1 ? list : null);
    groups.push({ cat, g, head, list });
    return g;
  }));

  function toggle(cat, open) {
    const gr = groups.find((x) => x.cat === cat);
    if (!gr) return;
    gr.head.setAttribute('aria-expanded', String(open));
    gr.g.classList.toggle('open', open);
  }

  function go(page, { focus = true, replace = false } = {}) {
    if (!panes.has(page)) page = FIRST;
    current = page;
    const cat = catOf(page);
    for (const [id, pane] of panes) pane.hidden = id !== page;
    for (const [id, a] of links) { if (id === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    // só a categoria atual fica aberta (as outras recolhem), a menos que haja uma busca
    for (const gr of groups) { gr.g.classList.toggle('active', gr.cat === cat); if (!search.value.trim()) toggle(gr.cat, gr.cat === cat); }
    crumb.replaceChildren(...[h('span', {}, `${cat.icon} ${t(cat.label)}`), cat.pages.length > 1 && h('span', { class: 'sep' }, ' › '), cat.pages.length > 1 && h('b', {}, title(page))].filter(Boolean));
    (replace ? history.replaceState : history.pushState).call(history, null, '', '#' + page);
    setDrawer(false);
    document.querySelector('.content')?.scrollTo?.({ top: 0 });
    scrollTo({ top: 0 });
    if (focus) panes.get(page).focus({ preventScroll: true });
    dispatchEvent(new CustomEvent('nt-page', { detail: page })); // páginas que calculam algo ao abrir (Armazenamento)
  }

  // ---------- busca ----------
  const texts = new Map([...panes].map(([id, pane]) => [id, fold(`${title(id)} ${catOf(id)?.label || ''} ${pane.textContent} ${[...pane.querySelectorAll('[placeholder],[title],[aria-label]')].map((e) => e.getAttribute('placeholder') || e.title || e.getAttribute('aria-label')).join(' ')}`)]));
  const empty = h('p', { class: 'side-empty hint', hidden: true }, 'Nada encontrado.');
  nav.append(empty);
  function filter() {
    const q = fold(search.value.trim());
    let first = null;
    let any = false;
    for (const gr of groups) {
      let shown = 0;
      for (const page of gr.cat.pages) {
        const a = links.get(page);
        const ok = !q || texts.get(page)?.includes(q);
        if (a) a.parentElement.hidden = !ok;
        if (ok) { shown++; first ??= page; }
      }
      gr.g.hidden = !shown;
      if (q && shown) toggle(gr.cat, true);
      any ||= shown > 0;
    }
    if (!q) for (const gr of groups) toggle(gr.cat, gr.cat === catOf(current));
    empty.hidden = any;
    return first;
  }
  search.addEventListener('input', filter);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const f = filter(); if (f) go(f); }
    if (e.key === 'Escape') { search.value = ''; filter(); }
  });
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); setDrawer(true); search.focus(); search.select(); }
  });

  // ---------- gaveta (telas estreitas) ----------
  function setDrawer(open) {
    side.classList.toggle('open', open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  menuBtn.addEventListener('click', () => setDrawer(!side.classList.contains('open')));
  scrim.addEventListener('click', () => setDrawer(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && side.classList.contains('open')) setDrawer(false); });

  // ---------- endereço ----------
  const fromHash = () => {
    const hsh = decodeURIComponent(location.hash.slice(1));
    go(panes.has(hsh) ? hsh : LEGACY[hsh] || FIRST, { focus: false, replace: true });
  };
  addEventListener('popstate', fromHash);
  addEventListener('hashchange', fromHash);
  fromHash();
  $('#donateBtn')?.addEventListener('click', () => go('apoie'));
  return { go, panes };
}
