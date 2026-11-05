// Widget: notícias — feeds RSS/Atom de qualquer site.
import { h } from '../lib/ui.js';
import { relTime } from '../lib/brain.js';

const CACHE = 'nt_cache_news';
const SUGGESTED = [
  { title: 'g1', url: 'https://g1.globo.com/rss/g1/' },
  { title: 'BBC Brasil', url: 'https://feeds.bbci.co.uk/portuguese/rss.xml' },
  { title: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml' },
  { title: 'Tecnoblog', url: 'https://tecnoblog.net/feed/' },
  { title: 'Olhar Digital', url: 'https://olhardigital.com.br/feed/' },
  { title: 'Nexo', url: 'https://www.nexojornal.com.br/rss.xml' },
];

const originOf = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.hostname}/*`; } catch { return null; } };

function parseFeed(xml, feed) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const txt = (el, sel) => el.querySelector(sel)?.textContent?.trim() || '';
  const items = [...doc.querySelectorAll('item')].map((it) => ({
    title: txt(it, 'title'), link: txt(it, 'link') || it.querySelector('guid')?.textContent, date: Date.parse(txt(it, 'pubDate') || txt(it, 'date')) || 0,
  }));
  const entries = [...doc.querySelectorAll('entry')].map((it) => ({
    title: txt(it, 'title'), link: it.querySelector('link[rel=alternate]')?.getAttribute('href') || it.querySelector('link')?.getAttribute('href'), date: Date.parse(txt(it, 'updated') || txt(it, 'published')) || 0,
  }));
  const name = feed.title || txt(doc, 'channel > title') || txt(doc, 'feed > title') || new URL(feed.url).hostname;
  return [...items, ...entries].filter((x) => x.title && x.link).map((x) => ({ ...x, source: name }));
}

export default {
  id: 'news',
  title: 'Notícias',
  icon: '📰',
  description: 'Manchetes dos seus sites e blogs favoritos (RSS), atualizadas sozinhas.',
  defaultW: 4,
  mount(el, ctx) {
    let filter = 'all';
    let managing = false;
    const feeds = () => ctx.widget.feeds || [];
    const body = h('div');
    const gear = h('button', { title: 'Escolher fontes', onclick: () => { managing = !managing; gear.classList.toggle('sel', managing); render(); } }, '⚙');
    ctx.actions.append(h('button', { title: 'Atualizar', onclick: () => load(true) }, '↻'), gear);
    el.append(body);
    let items = [];

    async function addFeed(feed) {
      const origin = originOf(feed.url);
      if (!origin) return ctx.toast('Endereço inválido');
      if (!(await chrome.permissions.contains({ origins: [origin] })) && !(await chrome.permissions.request({ origins: [origin] }))) {
        return ctx.toast('Permissão negada para ' + new URL(feed.url).hostname);
      }
      if (feeds().some((f) => f.url === feed.url)) return;
      await ctx.saveWidget({ feeds: [...feeds(), feed] });
      load(true);
    }

    function manage() {
      const url = h('input', { type: 'text', placeholder: 'Endereço do feed RSS (ex.: https://site.com/feed)' });
      return [
        h('p', { class: 'muted small' }, 'Suas fontes:'),
        ...feeds().map((f) => h('div', { class: 'item' }, h('span', { class: 'ic' }, '📰'), h('div', { class: 'body' }, h('div', { class: 'tt' }, f.title || f.url), h('div', { class: 'tx' }, f.url)),
          h('button', { class: 'chip danger', onclick: async () => { await ctx.saveWidget({ feeds: feeds().filter((x) => x.url !== f.url) }); render(); } }, '✕'))),
        h('p', { class: 'muted small' }, 'Sugestões (clique para adicionar):'),
        h('div', { class: 'toolbar' }, ...SUGGESTED.filter((s) => !feeds().some((f) => f.url === s.url)).map((s) => h('button', { class: 'chip', onclick: () => addFeed(s) }, '＋ ' + s.title))),
        h('div', { class: 'row-input', style: { marginTop: '8px' } }, url, h('button', { class: 'btn', onclick: () => url.value.trim() && addFeed({ url: url.value.trim() }) }, 'Adicionar')),
      ];
    }

    function list() {
      if (!feeds().length) return [h('p', { class: 'muted' }, 'Escolha de onde vêm as notícias.'), h('button', { class: 'btn primary', onclick: () => { managing = true; render(); } }, 'Escolher fontes')];
      const sources = [...new Set(items.map((i) => i.source))];
      const shown = (filter === 'all' ? items : items.filter((i) => i.source === filter)).slice(0, 25);
      return [
        sources.length > 1 ? h('div', { class: 'toolbar' }, ...['all', ...sources].map((s) => h('button', { class: 'chip' + (s === filter ? ' sel' : ''), onclick: () => { filter = s; render(); } }, s === 'all' ? 'Todas' : s))) : null,
        h('div', { class: 'items' }, ...shown.map((n) => h('a', { class: 'item nav-item', href: n.link, target: '_blank' },
          h('div', { class: 'body' }, h('div', { class: 'tt wrap' }, n.title), h('div', { class: 'mt' }, `${n.source}${n.date ? ' · ' + relTime(n.date) : ''}`))))),
        !shown.length ? h('p', { class: 'muted' }, 'Carregando manchetes…') : null,
      ].filter(Boolean);
    }

    function render() { body.replaceChildren(...(managing ? manage() : list())); }

    async function load(force) {
      const cache = (await chrome.storage.local.get(CACHE))[CACHE] || {};
      const all = [];
      await Promise.all(feeds().map(async (f) => {
        const c = cache[f.url];
        if (!force && c && Date.now() - c.at < 20 * 60e3) { all.push(...c.items); return; }
        try {
          const xml = await (await fetch(f.url)).text();
          const its = parseFeed(xml, f).slice(0, 20);
          cache[f.url] = { at: Date.now(), items: its };
          all.push(...its);
        } catch (e) {
          if (c) all.push(...c.items);
        }
      }));
      await chrome.storage.local.set({ [CACHE]: cache });
      items = all.sort((a, b) => b.date - a.date);
      render();
    }
    render();
    load();
    const t = setInterval(load, 20 * 60e3);
    return { destroy: () => clearInterval(t) };
  },
};
