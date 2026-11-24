// Widget: Cotações — lista de acompanhamento (0.9.2, #71): ações, FIIs, índices, moedas, cripto
// e indicadores, pelo Data Hub. Cada valor vem com a fonte, o horário e o atraso.
import { h } from '../lib/ui.js';
import { LOCALE } from '../lib/i18n.js';
import { hasFeature, requestFeature, FEATURES } from '../lib/permissions.js';
import { getQuotes, cachedQuote, warmCache } from '../lib/datahub/hub.js';
import { KINDS, KIND_LABEL, parseItem, itemKey, sanitizeDatahub } from '../lib/datahub/prefs.js';
import { itemTitle, itemSub, priceText, changeText, provenance, ERROR_LABEL, spokenLine, timeLabel, sourceName } from '../lib/datahub/format.js';
import { loadUsage, usageOf, limitsFor, estimateMonth } from '../lib/datahub/quota.js';
import { getKeys } from '../lib/datahub/keys.js';

const optionsUrl = (hash) => chrome.runtime.getURL('src/options.html' + hash);

export default {
  id: 'quotes',
  title: 'Cotações',
  icon: '📈',
  description: 'Sua lista de acompanhamento: ações e FIIs, Ibovespa, moedas, cripto, SELIC e IPCA, com a fonte e o horário de cada valor.',
  defaultW: 4,
  mount(el, ctx) {
    const body = h('div', { class: 'watch' });
    const foot = h('p', { class: 'watch-foot muted' });
    let editing = false;
    let last = new Map();
    let seq = 0; // só a última busca desenha (evita uma resposta antiga por cima da nova)
    ctx.actions.append(
      h('button', { title: 'Atualizar', 'aria-label': 'Atualizar', onclick: () => load(true) }, '↻'),
      h('button', { title: 'Editar a lista', 'aria-label': 'Editar a lista', onclick: () => { editing = !editing; editing ? edit() : load(); } }, '⚙'),
    );
    el.append(body, foot);
    const watch = () => ctx.settings.watch;

    async function load(force = false) {
      if (editing) return;
      if (!(await hasFeature('quotes'))) {
        body.replaceChildren(h('p', { class: 'muted' }, FEATURES.quotes.why),
          h('button', { class: 'btn primary', type: 'button', onclick: async () => { if (await requestFeature('quotes')) load(true); } }, 'Permitir acesso às cotações'));
        foot.textContent = '';
        return;
      }
      const items = watch().items;
      if (!items.length) { body.replaceChildren(h('p', { class: 'muted' }, 'Lista vazia. Toque em ⚙ para adicionar ativos.')); foot.textContent = ''; return; }
      const my = ++seq;
      body.style.opacity = '.6';
      let got = null;
      try { got = await getQuotes(items, ctx.settings, { force }); } catch (e) { console.warn('NeuroTab: cotações', e); }
      if (my !== seq || editing) return;
      if (got) last = got;
      body.style.opacity = '';
      render();
    }

    function render() {
      const items = watch().items;
      const groups = KINDS.map((k) => [k, items.filter((i) => i.kind === k)]).filter(([, l]) => l.length);
      const now = Date.now();
      body.replaceChildren(...groups.flatMap(([k, list]) => [
        groups.length > 1 ? h('div', { class: 'watch-group' }, KIND_LABEL[k]) : null,
        ...list.map((it) => {
          const v = last.get(itemKey(it)) || {};
          const ch = changeText(it, v, LOCALE);
          const err = v.error && v.price == null;
          return h('div', { class: 'q-row' + (v.stale ? ' stale' : ''), 'data-item': itemKey(it), title: v.price != null ? provenance(v, now) : v.error?.message || '' },
            h('span', { class: 'n' }, itemTitle(it, v), ' ', h('small', {}, itemSub(it, v))),
            err
              ? h('a', { class: 'watch-err small', href: optionsUrl('#fontes-dados'), target: '_blank', title: v.error.message }, ERROR_LABEL[v.error.code] || 'indisponível')
              : [h('span', { class: 'p' }, priceText(it, v, LOCALE)), h('span', { class: ch.cls + ' c' }, ch.text)]);
        }),
      ]));
      const vals = [...last.values()].filter((v) => v.price != null);
      const srcs = [...new Set(vals.map((v) => v.source))].map(sourceName);
      const latest = Math.max(0, ...vals.map((v) => v.at || 0));
      foot.replaceChildren(
        srcs.length ? `${srcs.join(', ')} · ${timeLabel(latest, now, LOCALE)}` : '',
        vals.some((v) => v.stale) ? ' · alguns desatualizados' : '',
        vals.some((v) => v.delay) ? ' · ações com atraso' : '');
    }

    async function edit() {
      const items = [...watch().items];
      const keys = await getKeys();
      const usage = await loadUsage();
      const dh = sanitizeDatahub(ctx.settings.datahub);
      const kindSel = h('select', { 'aria-label': 'Tipo' }, h('option', { value: '' }, 'Detectar'), ...KINDS.map((k) => h('option', { value: k }, KIND_LABEL[k])));
      const input = h('input', { type: 'text', class: 'watch-add', placeholder: 'PETR4, MXRF11, USD, BTC, IBOV, SELIC…', maxlength: 20, 'aria-label': 'Ativo' });
      const msg = h('p', { class: 'small muted', role: 'status' });
      const refresh = h('select', { 'aria-label': 'Atualizar ações a cada' }, ...[15, 30, 60, 120].map((m) => h('option', { value: m, selected: watch().refreshMin === m }, m < 60 ? `${m} min` : `${m / 60} h`)));
      const list = h('ul', { class: 'watch-edit' });
      const est = h('p', { class: 'small muted' });
      const paintEst = () => {
        const n = items.filter((i) => i.kind === 'stock' || i.kind === 'index').length;
        const lim = limitsFor('brapi', dh.limits);
        const month = estimateMonth({ brapiItems: n, refreshMin: +refresh.value, batch: lim.batch || 1 });
        const used = usageOf(usage, 'brapi').month;
        est.textContent = keys.brapi
          ? `BrAPI: cerca de ${month.toLocaleString(LOCALE)} consultas por mês com ${n} ativo(s) (limite ${lim.month.toLocaleString(LOCALE)}; usadas ${used.toLocaleString(LOCALE)} este mês).`
          : 'Sem o token grátis da BrAPI, só PETR4, VALE3, ITUB4 e MGLU3 aparecem. Cadastre em Fontes de dados.';
        est.classList.toggle('warn', !!keys.brapi && month > lim.month);
      };
      const paint = () => {
        list.replaceChildren(...items.map((it, i) => h('li', {},
          h('span', {}, itemTitle(it), ' ', h('small', { class: 'muted' }, KIND_LABEL[it.kind])),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn sm', title: 'Subir', 'aria-label': 'Subir', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; paint(); } }, '↑'),
          h('button', { class: 'btn sm', title: 'Remover', 'aria-label': 'Remover', onclick: () => { items.splice(i, 1); paint(); } }, '✕'))));
        paintEst();
      };
      const add = () => {
        const it = parseItem(input.value, kindSel.value);
        if (!it) { msg.textContent = 'Não reconheci. Exemplos: PETR4, HGLG11, USD, EUR-USD, BTC, IBOV, SELIC, CDI, IPCA.'; return; }
        if (items.some((x) => itemKey(x) === itemKey(it))) { msg.textContent = 'Já está na lista.'; return; }
        items.push(it); input.value = ''; msg.textContent = `${itemTitle(it)} adicionado (${KIND_LABEL[it.kind]}).`; paint();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      refresh.addEventListener('change', paintEst);
      paint();
      body.replaceChildren(
        h('div', { class: 'row-input' }, kindSel, input, h('button', { class: 'btn', onclick: add }, 'Adicionar')), msg, list,
        h('label', { class: 'small row' }, 'Atualizar ações e índices a cada ', refresh, ' (no pregão)'), est,
        h('p', { class: 'small' }, h('a', { href: optionsUrl('#fontes-dados'), target: '_blank' }, '🔑 Fontes de dados e chaves')),
        h('div', { class: 'toolbar' },
          h('button', { class: 'btn primary', id: 'watchSave', onclick: async () => { await ctx.saveSettings({ watch: { items, refreshMin: +refresh.value } }); editing = false; load(true); } }, 'Salvar'),
          h('button', { class: 'btn', onclick: () => { editing = false; load(); } }, 'Cancelar')));
      foot.textContent = '';
      input.focus();
    }

    warmCache();
    load();
    ctx.every(5 * 60e3, () => load()); // o hub decide se busca de novo (validade e pregão)
    ctx.on('data.changed', () => { if (!editing) load(); });
    return { destroy() {} };
  },

  // O cérebro (IA) lê a lista com fonte e horário (último valor conhecido) — nunca para recomendar investimento.
  brainContext(settings) {
    const items = settings.watch?.items || [];
    const lines = items.map((it) => [it, cachedQuote(it)]).filter(([, v]) => v?.price != null).map(([it, v]) => spokenLine(it, v));
    if (!lines.length) return null;
    return { title: 'Cotações e indicadores (lista de acompanhamento)', text: lines.join('\n') + '\nRegra: cite a fonte e o horário; separe o que veio da fonte do que você calculou; não recomende comprar nem vender.' };
  },
};
