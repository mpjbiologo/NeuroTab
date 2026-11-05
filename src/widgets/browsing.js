// Widget: navegação — sites mais visitados e abas fechadas recentemente.
import { h, showCtx } from '../lib/ui.js';
import { hostOf, faviconUrl } from '../lib/store.js';

const PERMS = { permissions: ['topSites', 'sessions', 'tabs'] };

export default {
  id: 'browsing',
  title: 'Navegação',
  icon: '🕘',
  description: 'Sites mais visitados e abas fechadas recentemente, para reabrir com um clique.',
  defaultW: 4,
  mount(el, ctx) {
    let tab = ctx.widget.tab || 'top';
    const tabs = h('div', { class: 'toolbar tabs-row' });
    const body = h('div', { class: 'items' });
    el.append(tabs, body);

    const paintTabs = () => tabs.replaceChildren(...[['top', '⭐ Mais visitados'], ['closed', '↩ Fechadas']].map(([k, l]) =>
      h('button', { class: 'chip' + (k === tab ? ' sel' : ''), onclick: () => { tab = k; ctx.saveWidget({ tab: k }); paintTabs(); render(); } }, l)));

    const row = (url, title, sub, onclick) => {
      const img = h('img', { src: faviconUrl(url), alt: '', width: 16, height: 16 });
      const r = h('a', { class: 'item nav-item', href: url, onclick },
        h('span', { class: 'ic' }, img),
        h('div', { class: 'body' }, h('div', { class: 'tt' }, title || hostOf(url)), h('div', { class: 'mt' }, sub || hostOf(url))));
      r.addEventListener('contextmenu', (e) => showCtx(e, [
        ['↗ Abrir em nova aba', () => window.open(url, '_blank')],
        ['➕ Adicionar aos atalhos', () => ctx.openLinkDialog(null, { url, title })],
        ['🧠 Salvar no cérebro', async () => { await ctx.capture({ type: 'page', title, url }); ctx.toast('Salvo no cérebro'); }],
      ]));
      return r;
    };

    async function render() {
      const ok = await chrome.permissions.contains(PERMS);
      if (!ok) {
        body.replaceChildren(
          h('p', { class: 'muted' }, 'Para mostrar seus sites mais visitados e as abas fechadas, o navegador precisa da sua permissão. Nada sai do seu computador.'),
          h('button', { class: 'btn primary', onclick: async () => { if (await chrome.permissions.request(PERMS)) render(); } }, 'Permitir'));
        return;
      }
      if (tab === 'top') {
        const sites = await chrome.topSites.get();
        body.replaceChildren(...sites.slice(0, 10).map((s) => row(s.url, s.title, hostOf(s.url))));
        if (!sites.length) body.append(h('p', { class: 'muted' }, 'Ainda não há histórico suficiente.'));
      } else {
        const sess = await chrome.sessions.getRecentlyClosed({ maxResults: 12 });
        const list = [];
        for (const s of sess) {
          if (s.tab?.url && !s.tab.url.startsWith('chrome') && !s.tab.url.startsWith('edge')) {
            list.push(row(s.tab.url, s.tab.title, `fechada ${new Date((s.lastModified || 0) * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, (e) => { e.preventDefault(); chrome.sessions.restore(s.tab.sessionId); }));
          } else if (s.window) {
            list.push(h('div', { class: 'item', onclick: () => chrome.sessions.restore(s.window.sessionId) }, h('span', { class: 'ic' }, '🗔'), h('div', { class: 'body' }, h('div', { class: 'tt' }, `Janela com ${s.window.tabs?.length || 0} abas`), h('div', { class: 'mt' }, 'clique para reabrir'))));
          }
        }
        body.replaceChildren(...(list.length ? list : [h('p', { class: 'muted' }, 'Nenhuma aba fechada recentemente.')]));
      }
    }
    paintTabs();
    render();
    const onFocus = () => render();
    window.addEventListener('focus', onFocus);
    return { destroy: () => window.removeEventListener('focus', onFocus) };
  },
};
