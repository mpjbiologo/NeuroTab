// Widget: cotações — moedas/cripto (AwesomeAPI) e ações da B3 (brapi.dev).
import { h } from '../lib/ui.js';

const CACHE = 'nt_cache_quotes';
const fmt = (v, cur = 'BRL') => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: cur, maximumFractionDigits: v > 1000 ? 0 : 2 });

export default {
  id: 'quotes',
  title: 'Cotações',
  icon: '📈',
  description: 'Dólar, euro, bitcoin e ações da B3.',
  defaultW: 4,
  mount(el, ctx) {
    const body = h('div');
    const stamp = h('p', { class: 'muted', style: { margin: '8px 0 0', fontSize: '11.5px' } });
    ctx.actions.append(h('button', { title: 'Atualizar', onclick: () => load(true) }, '↻'), h('button', { title: 'Escolher ativos', onclick: () => config() }, '⚙'));
    el.append(body, stamp);

    function config() {
      const cur = h('input', { type: 'text', value: ctx.settings.quoteCurrencies });
      const stk = h('input', { type: 'text', value: ctx.settings.quoteStocks });
      const tok = h('input', { type: 'text', value: ctx.settings.brapiToken, placeholder: 'opcional' });
      body.replaceChildren(
        h('p', { class: 'muted' }, 'Moedas (ex.: USD-BRL, EUR-BRL, BTC-BRL, GBP-BRL):'), cur,
        h('p', { class: 'muted' }, 'Ações/FIIs da B3 (ex.: PETR4, VALE3, ITUB4, MGLU3):'), stk,
        h('p', { class: 'muted' }, h('span', {}, 'Token da brapi.dev — sem ele, só PETR4, VALE3, ITUB4 e MGLU3. '), h('a', { href: 'https://brapi.dev/dashboard', target: '_blank' }, 'Criar grátis')), tok,
        h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: async () => {
          await ctx.saveSettings({ quoteCurrencies: cur.value.toUpperCase().replace(/\s/g, ''), quoteStocks: stk.value.toUpperCase().replace(/\s/g, ''), brapiToken: tok.value.trim() });
          load(true);
        } }, 'Salvar'), h('button', { class: 'btn', onclick: () => load() }, 'Cancelar')));
      stamp.textContent = '';
    }

    async function fetchAll() {
      const out = [];
      const curs = ctx.settings.quoteCurrencies.split(',').filter(Boolean);
      if (curs.length) {
        try {
          const r = await (await fetch('https://economia.awesomeapi.com.br/json/last/' + curs.join(','))).json();
          for (const c of curs) {
            const q = r[c.replace('-', '')];
            if (q) out.push({ name: q.code, sub: q.name.split('/')[0], price: +q.bid, cur: q.codein, pct: +q.pctChange });
          }
        } catch (e) { console.warn(e); }
      }
      const stocks = ctx.settings.quoteStocks.split(',').filter(Boolean);
      if (stocks.length) {
        try {
          const headers = ctx.settings.brapiToken ? { Authorization: 'Bearer ' + ctx.settings.brapiToken } : {};
          const r = await (await fetch('https://brapi.dev/api/quote/' + stocks.join(','), { headers })).json();
          for (const q of r.results || []) {
            const d = q.data || q;
            if (d.regularMarketPrice != null) out.push({ name: q.symbol || d.symbol, sub: (d.shortName || '').slice(0, 18), price: d.regularMarketPrice, cur: d.currency || 'BRL', pct: d.regularMarketChangePercent });
          }
          if (r.error && !out.some((o) => stocks.includes(o.name))) out.push({ err: r.message || 'Ações: verifique o token da brapi.dev' });
        } catch (e) { console.warn(e); }
      }
      return out;
    }

    async function load(force) {
      const key = ctx.settings.quoteCurrencies + '|' + ctx.settings.quoteStocks + '|' + !!ctx.settings.brapiToken;
      let c = (await chrome.storage.local.get(CACHE))[CACHE];
      if (force || !c || c.key !== key || Date.now() - c.at > 10 * 60e3) {
        body.style.opacity = '.6';
        const rows = await fetchAll();
        body.style.opacity = '';
        if (rows.length) { c = { key, at: Date.now(), rows }; await chrome.storage.local.set({ [CACHE]: c }); }
      }
      if (!c?.rows?.length) { body.replaceChildren(h('p', { class: 'muted' }, 'Não foi possível carregar as cotações.')); return; }
      body.replaceChildren(...c.rows.map((q) => q.err
        ? h('p', { class: 'muted' }, q.err)
        : h('div', { class: 'q-row' },
          h('span', { class: 'n' }, q.name, ' ', h('small', {}, q.sub)),
          h('span', {}, fmt(q.price, q.cur || 'BRL')),
          h('span', { class: q.pct >= 0 ? 'up' : 'down' }, `${q.pct >= 0 ? '▲' : '▼'} ${Math.abs(q.pct || 0).toFixed(2)}%`))));
      stamp.textContent = 'Atualizado ' + new Date(c.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · valores com atraso';
    }
    load();
    const t = setInterval(load, 10 * 60e3);
    return { destroy: () => clearInterval(t) };
  },
};
