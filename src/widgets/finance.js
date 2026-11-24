// Widget: Finanças (0.9.1, #66) — resumo do mês, lançamento rápido e próximas contas.
// Os dados ficam só neste computador (nt_finance); não vão para a IA (sem brainContext).
import { h } from '../lib/ui.js';
import { LOCALE } from '../lib/i18n.js';
import { fmtMoney } from '../lib/finance/money.js';
import { today, monthOf, monthSummary, upcomingBills, budgetStatus, makeTx } from '../lib/finance/model.js';
import { suggestCategory } from '../lib/finance/categorize.js';
import { parseQuick, matchVia } from '../lib/finance/phrases.js';
import { billMails } from '../lib/finance/notices.js';
import { loadFinance, saveFinance, unlockFinance, onFinanceChange } from '../lib/finance/store.js';
import { MAIL_KEY } from '../lib/mail.js';

const pageUrl = (hash = '') => chrome.runtime.getURL('src/finance.html' + hash);

export default {
  id: 'finance',
  title: 'Finanças',
  icon: '💰',
  description: 'Entradas, saídas e saldo do mês, lançamento rápido ("45 mercado") e contas a pagar. Fica só neste computador, com cofre opcional.',
  defaultW: 4,
  mount(el, ctx) {
    let st = null;
    let mails = [];
    let reveal = false;
    const body = h('div', { class: 'fin' });
    const prefs = () => ctx.settings.finance;
    const hidden = () => prefs().discreet && !reveal;
    const money = (c, o = {}) => fmtMoney(c, { currency: prefs().currency, lang: LOCALE, hidden: hidden(), ...o });
    const eye = h('button', { title: 'Mostrar ou esconder os valores', 'aria-label': 'Modo discreto', onclick: () => { if (prefs().discreet) reveal = !reveal; else ctx.saveSettings({ finance: { ...prefs(), discreet: true } }); render(); } }, '👁');
    const open = h('button', { title: 'Abrir as Finanças', 'aria-label': 'Abrir as Finanças', onclick: () => chrome.tabs.create({ url: pageUrl() }) }, '↗');
    ctx.actions.append(eye, open);
    el.append(body);

    async function load() {
      st = await loadFinance();
      if (prefs().mailHint) {
        try { mails = billMails((await chrome.storage.local.get(MAIL_KEY))[MAIL_KEY]); } catch { mails = []; }
      } else mails = [];
      render();
    }

    function render() {
      eye.textContent = hidden() ? '🙈' : '👁';
      eye.setAttribute('aria-pressed', String(hidden()));
      if (!st) return;
      body.replaceChildren(...(st.state === 'locked' ? lockedView() : openView()));
    }

    function lockedView() {
      const pass = h('input', { type: 'password', class: 'fin-pass', placeholder: 'Senha do cofre', 'aria-label': 'Senha do cofre', autocomplete: 'current-password' });
      const msg = h('span', { class: 'small muted', role: 'status' });
      const go = async () => {
        try { await unlockFinance(pass.value, prefs().lockMin); await load(); } catch (e) { msg.textContent = e.code === 'wrong_key' ? 'Senha incorreta.' : String(e.message || e); }
      };
      pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      return [h('p', { class: 'muted' }, '🔒 Finanças bloqueadas.'), h('div', { class: 'row' }, pass, h('button', { class: 'btn', onclick: go }, 'Abrir')), msg];
    }

    function openView() {
      const fin = st.fin;
      const m = monthOf(today());
      const s = monthSummary(fin, m);
      const kpi = (label, v, cls) => h('div', { class: 'fin-kpi' }, h('span', {}, label), h('b', { class: cls }, money(v)));
      const out = [h('div', { class: 'fin-kpis' }, kpi('Entradas', s.income, 'pos'), kpi('Saídas', s.expense, 'neg'), kpi('Saldo', s.balance, s.balance < 0 ? 'neg' : 'pos'))];

      // Lançamento rápido
      const input = h('input', { type: 'text', class: 'fin-quick', placeholder: '45 mercado · +1200 salário · 300 tênis 3x', 'aria-label': 'Lançamento rápido', maxlength: 160 });
      const hint = h('p', { class: 'fin-hint small muted', role: 'status' });
      const parse = () => {
        const p = parseQuick(input.value);
        if (!p) { hint.textContent = input.value.trim() ? 'Comece pelo valor: "45 mercado" ou "+1200 salário".' : ''; return null; }
        const cat = suggestCategory(fin, p.desc, p.kind).cat;
        const c = fin.categories.find((x) => x.id === cat);
        const via = matchVia(fin, p.via);
        const where = via.card ? '💳 ' + fin.cards.find((x) => x.id === via.card).name : via.account ? fin.accounts.find((x) => x.id === via.account).name : fin.accounts.find((a) => !a.archived)?.name;
        hint.textContent = `${p.kind === 'entrada' ? 'Entrada' : 'Saída'} · ${fmtMoney(p.amount, { currency: prefs().currency, lang: LOCALE })}${p.installments > 1 ? ` em ${p.installments}x` : ''} · ${c ? c.icon + ' ' + c.name : cat} · ${where} — Enter para lançar`;
        return { ...p, cat, via };
      };
      input.addEventListener('input', parse);
      input.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const p = parse();
        if (!p) return;
        const list = makeTx(fin, { date: today(), amount: p.amount, desc: p.desc, cat: p.cat, kind: p.kind, account: p.via.account || fin.accounts.find((a) => !a.archived)?.id, card: p.via.card, installments: p.installments, source: 'manual' });
        try {
          st.fin = await saveFinance({ ...fin, tx: [...fin.tx, ...list] });
          ctx.toast(`Lançado: ${p.desc || 'sem descrição'}`, 'Desfazer', async () => { const cur = await loadFinance(); if (cur.state === 'open') await saveFinance({ ...cur.fin, tx: cur.fin.tx.filter((t) => !list.some((x) => x.id === t.id)) }); load(); });
          render();
          body.querySelector('.fin-quick')?.focus();
        } catch (err) { ctx.toast(err.code === 'locked' ? 'O cofre bloqueou. Desbloqueie para lançar.' : String(err.message || err)); load(); }
      });
      out.push(input, hint);

      // Orçamento total
      const bs = budgetStatus(fin, m);
      if (bs.length) {
        const lim = bs.reduce((a, b) => a + b.limit, 0), spent = bs.reduce((a, b) => a + Math.min(b.spent, b.limit * 2), 0);
        const pct = lim ? spent / lim : 0;
        const over = bs.filter((b) => b.level !== 'ok');
        out.push(h('div', { class: 'fin-budget', title: over.map((b) => `${fin.categories.find((c) => c.id === b.cat)?.name}: ${Math.round(b.pct * 100)}%`).join('\n') },
          h('div', { class: 'small row' }, h('span', {}, 'Orçamento'), h('span', { class: 'spacer' }), h('span', { class: pct >= 1 ? 'neg' : pct >= 0.8 ? 'warn' : '' }, `${Math.round(pct * 100)}%`), over.length ? h('span', { class: 'small warn' }, ` · ${over.length} no limite`) : null),
          h('div', { class: 'fin-bar ' + (pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : '') }, h('i', { style: { width: Math.min(100, Math.round(pct * 100)) + '%' } }))));
      }

      // Contas a pagar
      const n = prefs().widgetBills;
      const bills = n ? upcomingBills(fin).slice(0, n) : [];
      if (bills.length) {
        out.push(h('ul', { class: 'fin-bills' }, ...bills.map((o) => h('li', {},
          h('span', {}, o.name), h('span', { class: 'small ' + (o.status === 'atrasada' ? 'neg' : o.status === 'hoje' ? 'warn' : 'muted') },
            o.status === 'atrasada' ? ` atrasada` : o.status === 'hoje' ? ' hoje' : ' ' + new Date(o.due + 'T12:00:00').toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' })),
          h('span', { class: 'spacer' }), h('span', { class: 'money' }, money(o.amount))))));
      }
      if (mails.length) {
        out.push(h('p', { class: 'small fin-mail' }, '✉️ ', mails.length === 1 ? 'Chegou um e-mail que parece de conta: ' : `${mails.length} e-mails parecem de contas, como `, h('a', { href: mails[0].link, target: '_blank', rel: 'noopener' }, `"${mails[0].subject.slice(0, 60)}"`), '. Já lançou?'));
      }
      if (!fin.tx.length && !fin.bills.length) {
        out.push(h('p', { class: 'small muted' }, 'Digite acima ou ', h('a', { href: pageUrl('#importar'), target: '_blank' }, 'importe um extrato'), '. ', h('span', { title: 'Não sincroniza e não vai para a IA.' }, '🔒 Só neste computador.')));
      }
      return out;
    }

    ctx.onCleanup(onFinanceChange(() => load()));
    ctx.on('data.changed', () => render());
    load();
    return { destroy() {} };
  },
};

