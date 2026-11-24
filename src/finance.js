// NeuroTab — página Finanças (0.9.1, #66).
// Resumo, lançamentos, contas e cartões, contas a pagar, orçamento, importação e dados.
// Tudo fica neste computador (nt_finance); com o cofre ligado, guardado cifrado.
import { h, toast } from './lib/ui.js';
import { loadData, saveData } from './lib/store.js';
import { initI18n, LOCALE } from './lib/i18n.js';
import { startIconizer } from './lib/icons.js';
import { fmtMoney, parseMoney } from './lib/finance/money.js';
import {
  today, monthOf, shiftMonth, makeTx, accountBalance, monthSummary, monthSeries, budgetStatus, upcomingBills, payBill,
  cardInvoices, cardUsed, invoiceFor, filterTx, removeTx, undoImport, newId, ACCOUNT_KINDS, cleanTx,
} from './lib/finance/model.js';
import { suggestCategory, learnRule, isBillPayment } from './lib/finance/categorize.js';
import { markDuplicates, fixBillPayments } from './lib/finance/dedupe.js';
import { parseOfx, toOfx } from './lib/finance/import-ofx.js';
import { parseCsv, guessTemplate, applyTemplate, headerSignature, shouldInvert, toCsv } from './lib/finance/import-csv.js';
import { parsePdfLines, detectBank, DEFAULT_PDF_TPL } from './lib/finance/import-pdf.js';
import {
  loadFinance, saveFinance, unlockFinance, lockFinance, enableVault, disableVault, changeVaultPassword,
  wipeFinance, exportFinance, importFinance, onFinanceChange, touchVault,
} from './lib/finance/store.js';

const $ = (s) => document.querySelector(s);
const TABS = [
  ['resumo', 'Resumo'], ['lancamentos', 'Lançamentos'], ['contas', 'Contas e cartões'], ['pagar', 'Contas a pagar'],
  ['orcamento', 'Orçamento'], ['importar', 'Importar'], ['dados', 'Dados e segurança'],
];
const KIND_LABEL = { saida: 'Saída', entrada: 'Entrada', transferencia: 'Transferência' };
const ACC_LABEL = { corrente: 'Conta corrente', poupanca: 'Poupança', carteira: 'Dinheiro / carteira', investimento: 'Investimentos', outro: 'Outra' };

let data; // configurações gerais
let st = { state: 'open', vault: false, fin: null };
let tab = (location.hash.slice(1) || 'resumo');
let month = monthOf(today());
let reveal = false; // modo discreto: "mostrar" só nesta página, até fechar
let filters = { q: '', account: '', cat: '', kind: '', all: false };
let selected = new Set();
let imp = null; // importação em andamento
let saving = 0;

const prefs = () => data.settings.finance;
const hidden = () => prefs().discreet && !reveal;
const money = (c, o = {}) => fmtMoney(c, { currency: prefs().currency, lang: LOCALE, hidden: hidden(), ...o });
const catOf = (id) => st.fin.categories.find((c) => c.id === id) || { id, name: id || '—', icon: '•' };
const catLabel = (id) => { const c = catOf(id); return `${c.icon} ${c.name}`; };
const accName = (id) => st.fin.accounts.find((a) => a.id === id)?.name || '—';
const cardName = (id) => st.fin.cards.find((c) => c.id === id)?.name || '—';
const monthName = (m) => { const s = new Date(m + '-15T12:00:00').toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }); return s[0].toUpperCase() + s.slice(1); };
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' });
const signed = (t) => (t.kind === 'entrada' ? t.amount : t.kind === 'saida' ? -t.amount : 0);

async function save(fin, msg) {
  saving++;
  try {
    st.fin = await saveFinance(fin);
  } catch (e) {
    if (e.code === 'locked') { st = await loadFinance(); render(); toast('O cofre bloqueou. Desbloqueie para salvar.'); return false; }
    throw e;
  } finally { setTimeout(() => { saving--; }, 300); }
  render();
  if (msg) toast(msg);
  return true;
}

async function savePrefs(patch) {
  Object.assign(data.settings.finance, patch);
  await saveData(data);
}

// ── Estrutura ───────────────────────────────────────────────────────────────
function render() {
  const open = st.state === 'open';
  for (const id of ['monthNav', 'eye', 'addTx', 'tabs']) $('#' + id).hidden = !open;
  $('#lockBtn').hidden = !(open && st.vault);
  $('#eye').setAttribute('aria-pressed', String(hidden()));
  $('#eye').textContent = hidden() ? '🙈' : '👁';
  $('#monthLabel').textContent = monthName(month);
  if (!open) { $('#banner').replaceChildren(); $('#view').replaceChildren(lockView()); return; }
  if (!TABS.some(([k]) => k === tab)) tab = 'resumo';
  $('#tabs').replaceChildren(...TABS.map(([k, label]) => h('button', {
    role: 'tab', 'aria-selected': String(k === tab), 'data-tab': k,
    onclick: () => { tab = k; history.replaceState(null, '', '#' + k); render(); },
  }, label)));
  $('#banner').replaceChildren(...banners());
  const views = { resumo: summaryView, lancamentos: txView, contas: accountsView, pagar: billsView, orcamento: budgetView, importar: importView, dados: dataView };
  $('#view').replaceChildren(...[].concat(views[tab]()));
}

function banners() {
  const out = [];
  if (st.fresh && !st.vault && !prefs().vaultAsked) {
    out.push(h('div', { class: 'notice row', id: 'vaultHint' },
      h('span', {}, '🔐 Quer proteger as finanças com uma senha? Com o cofre, os dados ficam cifrados neste computador e bloqueiam sozinhos.'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm primary', onclick: () => vaultDialog('create') }, 'Criar senha'),
      h('button', { class: 'btn sm', onclick: async () => { await savePrefs({ vaultAsked: true }); render(); } }, 'Agora não')));
  }
  return out;
}

// ── Cofre ───────────────────────────────────────────────────────────────────
function lockView() {
  const pass = h('input', { type: 'password', id: 'unlockPass', placeholder: 'Senha do cofre', autocomplete: 'current-password', 'aria-label': 'Senha do cofre' });
  const msg = h('p', { class: 'small', role: 'status' });
  const go = async () => {
    msg.textContent = 'Abrindo…';
    try {
      await unlockFinance(pass.value, prefs().lockMin);
      st = await loadFinance();
      render();
    } catch (e) {
      msg.textContent = e.code === 'wrong_key' ? 'Senha incorreta.' : 'Não deu para abrir: ' + (e.message || e);
      pass.select();
    }
  };
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  setTimeout(() => pass.focus(), 0);
  return h('div', { class: 'lock panel' },
    h('div', { class: 'big' }, '🔒'),
    h('h2', {}, 'Finanças bloqueadas'),
    h('p', { class: 'muted small' }, 'Os dados estão cifrados neste computador. Digite a senha do cofre para abrir.'),
    pass, h('button', { class: 'btn primary', id: 'unlockGo', onclick: go }, 'Desbloquear'), msg,
    h('details', { class: 'small muted' }, h('summary', {}, 'Esqueci a senha'),
      h('p', {}, 'Sem a senha não há como recuperar os dados: nem a NeuroTab consegue abri-los. Você pode apagar tudo e começar de novo.'),
      h('button', { class: 'btn sm danger', onclick: async () => {
        if (!confirm('Apagar TODAS as finanças deste computador? Isso não pode ser desfeito.')) return;
        await wipeFinance(); st = await loadFinance(); render();
      } }, '🗑 Apagar tudo e começar de novo')));
}

function vaultDialog(mode) {
  const d = $('#dlg');
  const p1 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: mode === 'change' ? 'Senha atual' : 'Senha (mínimo 6 caracteres)' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: mode === 'change' ? 'Senha nova' : 'Repita a senha' });
  const p3 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repita a senha nova' });
  const msg = h('p', { class: 'small', role: 'status' });
  const titles = { create: 'Criar o cofre', change: 'Trocar a senha do cofre', remove: 'Desligar o cofre' };
  const go = async () => {
    try {
      if (mode === 'create') {
        if (p1.value !== p2.value) { msg.textContent = 'As senhas não são iguais.'; return; }
        await enableVault(p1.value, prefs().lockMin);
        await savePrefs({ vaultAsked: true });
      } else if (mode === 'change') {
        if (p2.value !== p3.value) { msg.textContent = 'As senhas novas não são iguais.'; return; }
        await changeVaultPassword(p1.value, p2.value, prefs().lockMin);
      } else {
        await disableVault(p1.value);
      }
      d.close();
      st = await loadFinance();
      render();
      toast({ create: 'Cofre ligado. Guarde bem a senha: sem ela não há como recuperar os dados.', change: 'Senha trocada.', remove: 'Cofre desligado. Os dados ficam sem senha neste computador.' }[mode]);
    } catch (e) {
      msg.textContent = e.code === 'wrong_key' ? 'Senha incorreta.' : e.message || String(e);
    }
  };
  d.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); go(); } },
    h('h2', {}, titles[mode]),
    mode === 'create' ? h('p', { class: 'small muted' }, 'Os dados passam a ser cifrados (AES-256) com uma chave tirada desta senha. Ao abrir, ficam liberados até bloquear sozinhos depois de ', String(prefs().lockMin || '∞'), ' min sem uso ou ao fechar o navegador. ', h('b', {}, 'Sem a senha, ninguém recupera os dados — nem você.')) : null,
    mode === 'remove' ? h('p', { class: 'small muted' }, 'Os dados voltam a ficar sem senha neste computador.') : null,
    h('div', { class: 'grid2' }, p1, mode !== 'remove' ? p2 : null, mode === 'change' ? p3 : null),
    msg,
    h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancelar'), h('button', { type: 'submit', class: 'btn primary', id: 'vaultGo' }, 'Confirmar'))));
  d.showModal();
  p1.focus();
}

// ── Resumo ──────────────────────────────────────────────────────────────────
function summaryView() {
  const fin = st.fin;
  const s = monthSummary(fin, month);
  const kpi = (label, v, cls = '') => h('div', { class: 'kpi' }, h('span', {}, label), h('b', { class: cls }, money(v)));
  const out = [h('section', {}, h('div', { class: 'kpis' },
    kpi('Entradas', s.income, 'pos'), kpi('Saídas', s.expense, 'neg'), kpi('Saldo do mês', s.balance, s.balance < 0 ? 'neg' : 'pos'),
    kpi('Em contas', fin.accounts.filter((a) => !a.archived).reduce((a, x) => a + accountBalance(fin, x.id), 0))))];
  if (!fin.tx.length) {
    out.push(h('section', {}, h('h2', {}, 'Comece por aqui'),
      h('p', {}, 'Lance um gasto no botão ', h('b', {}, '＋ Lançar'), ', importe um extrato (OFX, CSV ou PDF) em ', h('b', {}, 'Importar'), ', ou cadastre suas contas e cartões.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => go('importar') }, '📥 Importar extrato'), h('button', { class: 'btn', onclick: () => go('contas') }, '🏦 Contas e cartões'))));
  }
  const cats = Object.entries(s.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  out.push(h('section', {}, h('h2', {}, 'Gastos por categoria'),
    cats.length ? h('div', { class: 'bars' }, ...cats.map(([c, v]) => h('div', { class: 'bar-row' },
      h('span', {}, catLabel(c)), h('div', { class: 'bar' }, h('i', { style: { width: Math.round((v / max) * 100) + '%' } })), h('span', { class: 'money' }, money(v), ' · ', Math.round((v / (s.expense || 1)) * 100) + '%'))))
      : h('p', { class: 'muted' }, 'Nenhum gasto neste mês.')));
  out.push(h('section', {}, h('div', { class: 'row' }, h('h2', {}, 'Entradas e saídas'), h('span', { class: 'spacer' }),
    h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'inc' }), 'Entradas'), h('span', {}, h('i', { class: 'exp' }), 'Saídas'))),
    seriesChart(monthSeries(fin, month, 12))));
  const bs = budgetStatus(fin, month);
  if (bs.length) out.push(h('section', {}, h('h2', {}, 'Orçamento do mês'), budgetBars(bs)));
  const bills = upcomingBills(fin).slice(0, 6);
  if (bills.length) out.push(h('section', {}, h('h2', {}, 'Próximas contas'), billList(bills)));
  return out;
}

function seriesChart(list) {
  const W = 720, H = 180, P = 22, top = 10;
  const max = Math.max(1, ...list.map((m) => Math.max(m.income, m.expense)));
  const bw = (W - P * 2) / list.length;
  const ns = 'http://www.w3.org/2000/svg';
  const el = (t, a, txt) => { const e = document.createElementNS(ns, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (txt) e.textContent = txt; return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Entradas e saídas dos últimos 12 meses' });
  svg.append(el('line', { x1: P, x2: W - P, y1: H - P, y2: H - P, class: 'axis' }));
  list.forEach((m, i) => {
    const x = P + i * bw;
    const hh = (v) => ((H - P - top) * v) / max;
    const w = Math.max(3, bw / 2 - 4);
    const inc = el('rect', { x: x + 2, y: H - P - hh(m.income), width: w, height: hh(m.income), class: 'inc', rx: 2 });
    const exp = el('rect', { x: x + 2 + w + 2, y: H - P - hh(Math.max(0, m.expense)), width: w, height: hh(Math.max(0, m.expense)), class: 'exp', rx: 2 });
    if (!hidden()) { inc.append(el('title', {}, `${monthName(m.month)} · entradas ${money(m.income)}`)); exp.append(el('title', {}, `${monthName(m.month)} · saídas ${money(m.expense)}`)); }
    svg.append(inc, exp, el('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle' }, new Date(m.month + '-15T12:00:00').toLocaleDateString(LOCALE, { month: 'short' })));
  });
  return svg;
}

function budgetBars(bs) {
  return h('div', { class: 'bars' }, ...bs.map((b) => h('div', { class: 'bar-row' },
    h('span', {}, catLabel(b.cat)),
    h('div', { class: 'bar ' + (b.level === 'ok' ? '' : b.level), title: Math.round(b.pct * 100) + '%' }, h('i', { style: { width: Math.min(100, Math.round(b.pct * 100)) + '%' } })),
    h('span', { class: 'money ' + (b.level === 'over' ? 'neg' : b.level === 'warn' ? 'warn' : '') }, money(b.spent), ' de ', money(b.limit)))));
}

function billList(list) {
  const tagFor = (o) => (o.status === 'atrasada' ? h('span', { class: 'tag bad' }, `atrasada ${-o.days} d`) : o.status === 'hoje' ? h('span', { class: 'tag warn' }, 'vence hoje') : h('span', { class: 'tag' }, o.days === 1 ? 'amanhã' : `em ${o.days} dias`));
  return h('div', { class: 'list' }, ...list.map((o) => h('div', { class: 'row item', 'data-bill': o.bill },
    h('b', {}, o.name), h('span', { class: 'muted small' }, fmtDay(o.due)), tagFor(o), h('span', { class: 'spacer' }), h('span', { class: 'money' }, money(o.amount)),
    h('button', { class: 'btn sm', onclick: () => payDialog(o) }, '✓ Paga'))));
}

function payDialog(o) {
  const d = $('#dlg');
  const amount = h('input', { type: 'text', inputmode: 'decimal', value: (o.amount / 100).toFixed(2).replace('.', ',') });
  const date = h('input', { type: 'date', value: today() });
  d.replaceChildren(h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const r = payBill(st.fin, o.bill, o.key, { date: date.value, amount: Math.abs(parseMoney(amount.value) || o.amount) });
    d.close();
    await save(r.fin, `${o.name}: lançada como paga.`);
  } }, h('h2', {}, `Pagar: ${o.name}`), h('p', { class: 'small muted' }, 'Cria o lançamento e marca esta conta como paga.'),
  h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Valor', amount), h('label', { class: 'f' }, 'Data do pagamento', date)),
  h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancelar'), h('button', { class: 'btn primary', id: 'payGo' }, 'Confirmar'))));
  d.showModal();
}

const go = (k) => { tab = k; history.replaceState(null, '', '#' + k); render(); };

// ── Lançamentos ─────────────────────────────────────────────────────────────
function targetOptions(sel, { cards = true, none = false } = {}) {
  const fin = st.fin;
  return [
    none ? h('option', { value: '' }, 'Todas as contas e cartões') : null,
    h('optgroup', { label: 'Contas' }, ...fin.accounts.filter((a) => !a.archived || sel === 'a:' + a.id).map((a) => h('option', { value: 'a:' + a.id, selected: sel === 'a:' + a.id }, a.name))),
    cards && fin.cards.length ? h('optgroup', { label: 'Cartões' }, ...fin.cards.filter((c) => !c.archived || sel === 'c:' + c.id).map((c) => h('option', { value: 'c:' + c.id, selected: sel === 'c:' + c.id }, '💳 ' + c.name))) : null,
  ];
}
const catOptions = (sel, kind) => st.fin.categories
  .filter((c) => !kind || c.kind === 'ambos' || c.kind === kind || c.id === sel)
  .map((c) => h('option', { value: c.id, selected: c.id === sel }, `${c.icon} ${c.name}`));

function txView() {
  const fin = st.fin;
  const from = filters.all ? '' : month + '-01', to = filters.all ? '' : month + '-31';
  const [tk, tid] = (filters.account || ':').split(':');
  const list = filterTx(fin, { from, to, account: tk === 'a' ? tid : '', card: tk === 'c' ? tid : '', cat: filters.cat, kind: filters.kind, q: filters.q });
  selected = new Set([...selected].filter((id) => list.some((t) => t.id === id)));
  const q = h('input', { type: 'search', placeholder: 'Buscar…', value: filters.q, 'aria-label': 'Buscar lançamentos' });
  let qt;
  q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { filters.q = q.value; render(); setTimeout(() => { const n = $('input[type=search]'); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }, 0); }, 250); });
  const sel = (key, opts) => h('select', { onchange: (e) => { filters[key] = e.target.value; render(); } }, ...opts);
  const total = list.reduce((a, t) => a + signed(t), 0);
  const bulkCat = h('select', { 'aria-label': 'Categoria para os selecionados' }, h('option', { value: '' }, 'Mudar categoria…'), ...catOptions(''));
  bulkCat.addEventListener('change', async () => {
    if (!bulkCat.value) return;
    const ids = selected; selected = new Set();
    await save({ ...fin, tx: fin.tx.map((t) => (ids.has(t.id) ? { ...t, cat: bulkCat.value } : t)) }, `${ids.size} lançamento(s) atualizados.`);
  });
  const head = h('div', { class: 'filters' }, q,
    sel('account', targetOptions(filters.account, { none: true })),
    sel('cat', [h('option', { value: '' }, 'Todas as categorias'), ...catOptions(filters.cat)]),
    sel('kind', [h('option', { value: '' }, 'Todos os tipos'), ...Object.entries(KIND_LABEL).map(([k, v]) => h('option', { value: k, selected: filters.kind === k }, v))]),
    h('label', { class: 'small row' }, h('input', { type: 'checkbox', checked: filters.all, onchange: (e) => { filters.all = e.target.checked; render(); } }), 'Todos os meses'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn sm', id: 'expCsv', onclick: () => download(toCsv(list, fin.categories), `financas-${filters.all ? 'tudo' : month}.csv`, 'text/csv') }, '⬇ CSV'),
    h('button', { class: 'btn sm', id: 'expOfx', onclick: () => download(toOfx(list.filter((t) => !t.card && t.kind !== 'transferencia'), { currency: prefs().currency }), `financas-${filters.all ? 'tudo' : month}.ofx`, 'application/x-ofx') }, '⬇ OFX'));
  const bulk = h('div', { class: 'row small', hidden: !selected.size },
    h('b', {}, `${selected.size} selecionado(s)`), bulkCat,
    h('button', { class: 'btn sm danger', onclick: async () => {
      if (!confirm(`Apagar ${selected.size} lançamento(s)?`)) return;
      let f = fin; for (const id of selected) f = removeTx(f, id); selected = new Set();
      await save(f, 'Lançamentos apagados.');
    } }, '🗑 Apagar'));
  const rows = list.slice(0, 500).map((t) => {
    const cat = h('select', { 'aria-label': 'Categoria', onchange: async (e) => {
      let f = { ...fin, tx: fin.tx.map((x) => (x.id === t.id ? { ...x, cat: e.target.value } : x)) };
      f = learnRule(f, t.desc, e.target.value);
      await save(f, 'Categoria salva. Os próximos parecidos vão para ela.');
    } }, ...catOptions(t.cat, t.kind === 'transferencia' ? '' : t.kind));
    const where = t.card ? `💳 ${cardName(t.card)}` : t.kind === 'transferencia' ? `${accName(t.account)} → ${t.to ? (st.fin.cards.some((c) => c.id === t.to) ? '💳 ' + cardName(t.to) : accName(t.to)) : '?'}` : accName(t.account);
    return h('tr', { 'data-id': t.id },
      h('td', {}, h('input', { type: 'checkbox', checked: selected.has(t.id), 'aria-label': 'Selecionar', onchange: (e) => { e.target.checked ? selected.add(t.id) : selected.delete(t.id); bulk.hidden = !selected.size; bulk.firstChild.textContent = `${selected.size} selecionado(s)`; } })),
      h('td', {}, fmtDate(t.date)),
      h('td', {}, t.desc || '—', t.inst ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, `${t.inst.n}/${t.inst.of}`) : null, t.source !== 'manual' ? h('span', { class: 'tag', style: { marginLeft: '6px' }, title: 'Origem' }, t.source) : null),
      h('td', {}, cat),
      h('td', { class: 'small muted' }, where),
      h('td', { class: 'money ' + (t.kind === 'entrada' ? 'pos' : t.kind === 'saida' ? 'neg' : '') }, t.kind === 'transferencia' ? money(t.amount) : money(signed(t), { sign: true })),
      h('td', {}, h('button', { class: 'btn sm icon', title: 'Editar', 'aria-label': 'Editar', onclick: () => txDialog(t) }, '✏️'),
        h('button', { class: 'btn sm icon', title: 'Apagar', 'aria-label': 'Apagar', onclick: () => deleteTx(t) }, '🗑')));
  });
  return [h('section', {}, head, bulk,
    list.length ? h('table', { class: 'tx', id: 'txTable' },
      h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Data'), h('th', {}, 'Descrição'), h('th', {}, 'Categoria'), h('th', {}, 'Conta'), h('th', { class: 'money' }, 'Valor'), h('th', {}))),
      h('tbody', {}, ...rows)) : h('p', { class: 'muted' }, 'Nenhum lançamento aqui.'),
    list.length > 500 ? h('p', { class: 'small muted' }, `Mostrando 500 de ${list.length}. Use os filtros para ver o resto.`) : null,
    list.length ? h('p', { class: 'small row' }, h('span', { class: 'muted' }, `${list.length} lançamento(s) · total `), h('b', { class: total < 0 ? 'neg' : 'pos' }, money(total, { sign: true }))) : null)];
}

async function deleteTx(t) {
  let all = false;
  if (t.inst) all = confirm(`Esta é a parcela ${t.inst.n} de ${t.inst.of}. Apagar TODAS as parcelas? (Cancelar apaga só esta.)`);
  const before = st.fin;
  await save(removeTx(st.fin, t.id, { all }));
  toast(all ? 'Parcelas apagadas.' : 'Lançamento apagado.', 'Desfazer', () => save(before));
}

function txDialog(t = null) {
  const d = $('#dlg');
  const fin = st.fin;
  let kind = t?.kind || 'saida';
  const amount = h('input', { type: 'text', inputmode: 'decimal', id: 'fAmount', required: true, placeholder: '0,00', value: t ? (t.amount / 100).toFixed(2).replace('.', ',') : '' });
  const desc = h('input', { type: 'text', id: 'fDesc', maxlength: 200, value: t?.desc || '', placeholder: 'Ex.: Mercado, Uber, Salário' });
  const date = h('input', { type: 'date', id: 'fDate', value: t?.date || (month === monthOf(today()) ? today() : month + '-01'), required: true });
  const target = h('select', { id: 'fTarget' }, ...targetOptions(t ? (t.card ? 'c:' + t.card : 'a:' + t.account) : 'a:' + (fin.accounts.find((a) => !a.archived)?.id || '')));
  const to = h('select', { id: 'fTo' }, ...targetOptions(t?.to ? (fin.cards.some((c) => c.id === t.to) ? 'c:' + t.to : 'a:' + t.to) : ''));
  const cat = h('select', { id: 'fCat' });
  const inst = h('input', { type: 'number', id: 'fInst', min: 1, max: 48, value: 1 });
  const note = h('input', { type: 'text', id: 'fNote', maxlength: 500, value: t?.note || '', placeholder: 'Observação (opcional)' });
  const repeat = h('input', { type: 'checkbox', id: 'fRepeat' });
  let catTouched = !!t;
  const fillCats = () => {
    const sug = catTouched ? cat.value || t?.cat : suggestCategory(fin, desc.value, kind).cat;
    cat.replaceChildren(...catOptions(sug, kind === 'transferencia' ? '' : kind));
    if (kind === 'transferencia' && !catTouched) cat.value = 'transferencia';
  };
  cat.addEventListener('change', () => { catTouched = true; });
  desc.addEventListener('input', () => { if (!catTouched) fillCats(); });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo' }, ...Object.entries(KIND_LABEL).map(([k, v]) => h('button', { type: 'button', 'data-kind': k, 'aria-pressed': String(k === kind), onclick: () => { kind = k; paint(); } }, v)));
  const toRow = h('label', { class: 'f' }, 'Para (conta ou fatura do cartão)', to);
  const instRow = h('label', { class: 'f' }, 'Parcelas (o valor é o total)', inst);
  const repRow = h('label', { class: 'small row' }, repeat, 'Repetir todo mês (cria uma conta a pagar)');
  const paint = () => {
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    toRow.hidden = kind !== 'transferencia';
    instRow.hidden = !!t || kind !== 'saida';
    repRow.hidden = !!t || kind === 'transferencia';
    fillCats();
  };
  const msg = h('p', { class: 'small', role: 'status' });
  d.replaceChildren(h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const cents = Math.abs(parseMoney(amount.value) || 0);
    if (!cents) { msg.textContent = 'Informe o valor.'; amount.focus(); return; }
    const [tk, tid] = target.value.split(':');
    const [ok2, oid] = to.value.split(':');
    const input = { date: date.value, amount: cents, desc: desc.value.trim(), cat: cat.value, kind, note: note.value.trim(), source: t?.source || 'manual',
      account: tk === 'a' ? tid : '', card: tk === 'c' ? tid : undefined, installments: Number(inst.value) || 1 };
    if (kind === 'transferencia') {
      if (to.value === target.value) { msg.textContent = 'Escolha um destino diferente da origem.'; return; }
      input.to = oid;
      if (ok2 === 'c') { const card = fin.cards.find((c) => c.id === oid); input.invoice = invoiceFor(card, date.value); }
      delete input.card;
    }
    let f = fin;
    if (t) {
      const [nt] = makeTx(fin, { ...input, id: t.id, installments: 1 });
      if (t.inst) nt.inst = t.inst;
      if (t.importId) nt.importId = t.importId;
      if (t.fitid) nt.fitid = t.fitid;
      if (t.bill) nt.bill = t.bill;
      if (kind === 'transferencia' && input.invoice) nt.invoice = input.invoice;
      f = { ...f, tx: f.tx.map((x) => (x.id === t.id ? nt : x)) };
      if (nt.cat !== t.cat) f = learnRule(f, nt.desc, nt.cat);
    } else {
      const list = makeTx(fin, input);
      if (kind === 'transferencia' && input.invoice) list[0].invoice = input.invoice;
      f = { ...f, tx: [...f.tx, ...list] };
      if (repeat.checked) {
        const day = Number(date.value.slice(8));
        f.bills = [...f.bills, { id: newId('b'), name: input.desc || catOf(input.cat).name, amount: cents, day, every: 'month', cat: input.cat, account: input.account, card: input.card || '', remind: 3, active: true, start: date.value, paid: { [date.value.slice(0, 7)]: list[0].id } }];
      }
      if (catTouched) f = learnRule(f, input.desc, input.cat);
    }
    d.close();
    await save(f, t ? 'Lançamento atualizado.' : 'Lançado.');
  } },
  h('h2', {}, t ? 'Editar lançamento' : 'Novo lançamento'), seg,
  h('div', { class: 'grid2', style: { marginTop: '10px' } },
    h('label', { class: 'f' }, 'Valor', amount), h('label', { class: 'f' }, 'Data', date),
    h('label', { class: 'f', style: { gridColumn: '1 / -1' } }, 'Descrição', desc),
    h('label', { class: 'f' }, 'Categoria', cat), h('label', { class: 'f' }, 'Conta ou cartão', target),
    toRow, instRow),
  h('div', { style: { marginTop: '8px' } }, note), repRow, msg,
  h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancelar'), h('button', { class: 'btn primary', id: 'fSave' }, 'Salvar'))));
  paint();
  d.showModal();
  amount.focus();
}

// ── Contas e cartões ────────────────────────────────────────────────────────
function accountsView() {
  const fin = st.fin;
  const accs = fin.accounts.map((a) => h('div', { class: 'item', 'data-acc': a.id },
    h('header', {}, h('b', {}, a.name, a.archived ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'arquivada') : null),
      h('span', { class: 'muted small' }, ACC_LABEL[a.kind]), h('span', { class: 'money' }, money(accountBalance(fin, a.id))),
      h('button', { class: 'btn sm', onclick: () => accountDialog(a) }, 'Editar'))));
  const cards = fin.cards.map((c) => {
    const inv = cardInvoices(fin, c.id).slice(0, 4);
    const used = cardUsed(fin, c.id);
    return h('div', { class: 'item', 'data-card': c.id },
      h('header', {}, h('b', {}, '💳 ', c.name, c.archived ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'arquivado') : null),
        h('span', { class: 'small muted' }, `fecha dia ${c.closeDay} · vence dia ${c.dueDay}`),
        c.limit ? h('span', { class: 'small' }, 'limite usado ', money(used), ' de ', money(c.limit)) : null,
        h('button', { class: 'btn sm', onclick: () => cardDialog(c) }, 'Editar')),
      c.limit ? h('div', { class: 'bar ' + (used / c.limit >= 1 ? 'over' : used / c.limit >= 0.8 ? 'warn' : '') }, h('i', { style: { width: Math.min(100, Math.round((used / c.limit) * 100)) + '%' } })) : null,
      h('table', { class: 'tx' }, h('tbody', {}, ...inv.map((i) => h('tr', {},
        h('td', {}, 'Fatura de ', monthName(i.invoice)), h('td', { class: 'small muted' }, 'vence ', fmtDate(i.due)),
        h('td', {}, h('span', { class: 'tag ' + ({ paga: 'ok', vencida: 'bad', fechada: 'warn' }[i.status] || '') }, i.status)),
        h('td', { class: 'money' }, money(i.total)),
        h('td', {}, i.status !== 'paga' && i.total > 0 ? h('button', { class: 'btn sm', onclick: () => payInvoice(c, i) }, 'Pagar fatura') : null,
          h('button', { class: 'btn sm', onclick: () => { filters = { ...filters, account: 'c:' + c.id, all: true }; go('lancamentos'); } }, 'Ver')))))));
  });
  return [
    h('section', {}, h('div', { class: 'row' }, h('h2', {}, 'Contas'), h('span', { class: 'spacer' }), h('button', { class: 'btn sm', id: 'addAcc', onclick: () => accountDialog() }, '＋ Conta')), h('div', { class: 'list' }, ...accs)),
    h('section', {}, h('div', { class: 'row' }, h('h2', {}, 'Cartões de crédito'), h('span', { class: 'spacer' }), h('button', { class: 'btn sm', id: 'addCard', onclick: () => cardDialog() }, '＋ Cartão')),
      cards.length ? h('div', { class: 'list' }, ...cards) : h('p', { class: 'muted small' }, 'Cadastre um cartão para acompanhar as faturas: as compras caem na fatura certa pelo dia do fechamento.')),
  ];
}

function payInvoice(card, inv) {
  const d = $('#dlg');
  const from = h('select', {}, ...targetOptions('a:' + (card.account || st.fin.accounts[0]?.id), { cards: false }));
  const amount = h('input', { type: 'text', inputmode: 'decimal', value: (inv.total / 100).toFixed(2).replace('.', ',') });
  const date = h('input', { type: 'date', value: today() });
  d.replaceChildren(h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const [tx] = makeTx(st.fin, { date: date.value, amount: Math.abs(parseMoney(amount.value) || inv.total), desc: `Pagamento da fatura ${card.name}`, cat: 'transferencia', kind: 'transferencia', account: from.value.slice(2), to: card.id, invoice: inv.invoice });
    tx.invoice = inv.invoice;
    d.close();
    await save({ ...st.fin, tx: [...st.fin.tx, tx] }, 'Fatura paga.');
  } }, h('h2', {}, `Pagar a fatura de ${monthName(inv.invoice)}`), h('p', { class: 'small muted' }, 'Vira uma transferência da conta para o cartão: não conta como gasto de novo (as compras já contaram).'),
  h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Valor', amount), h('label', { class: 'f' }, 'Data', date), h('label', { class: 'f' }, 'Pago com', from)),
  h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancelar'), h('button', { class: 'btn primary' }, 'Confirmar'))));
  d.showModal();
}

function accountDialog(a = null) {
  const d = $('#dlg');
  const name = h('input', { type: 'text', id: 'aName', maxlength: 60, required: true, value: a?.name || '', placeholder: 'Ex.: Nubank, Itaú, Carteira' });
  const kind = h('select', {}, ...ACCOUNT_KINDS.map((k) => h('option', { value: k, selected: a?.kind === k }, ACC_LABEL[k])));
  const initial = h('input', { type: 'text', inputmode: 'decimal', id: 'aInitial', value: a ? (a.initial / 100).toFixed(2).replace('.', ',') : '0,00' });
  const arch = h('input', { type: 'checkbox', checked: !!a?.archived });
  const used = a && st.fin.tx.some((t) => t.account === a.id || t.to === a.id);
  d.replaceChildren(h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const acc = { id: a?.id || newId('a'), name: name.value.trim(), kind: kind.value, initial: parseMoney(initial.value) || 0, archived: arch.checked };
    d.close();
    await save({ ...st.fin, accounts: a ? st.fin.accounts.map((x) => (x.id === a.id ? acc : x)) : [...st.fin.accounts, acc] }, 'Conta salva.');
  } }, h('h2', {}, a ? 'Editar conta' : 'Nova conta'),
  h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Nome', name), h('label', { class: 'f' }, 'Tipo', kind), h('label', { class: 'f' }, 'Saldo inicial', initial)),
  a ? h('label', { class: 'small row' }, arch, 'Arquivada (some das listas, mas os lançamentos ficam)') : null,
  h('div', { class: 'row' },
    a && !used && st.fin.accounts.length > 1 ? h('button', { type: 'button', class: 'btn sm danger', onclick: async () => { d.close(); await save({ ...st.fin, accounts: st.fin.accounts.filter((x) => x.id !== a.id) }, 'Conta apagada.'); } }, '🗑 Apagar') : null,
    h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancelar'), h('button', { class: 'btn primary', id: 'aSave' }, 'Salvar'))));
  d.showModal();
  name.focus();
}

function cardDialog(c = null) {
  const d = $('#dlg');
  const name = h('input', { type: 'text', id: 'cName', maxlength: 60, required: true, value: c?.name || '', placeholder: 'Ex.: Nubank, Itaú Visa' });
  const limit = h('input', { type: 'text', inputmode: 'decimal', value: c ? (c.limit / 100).toFixed(2).replace('.', ',') : '' , placeholder: 'opcional' });
  const close = h('input', { type: 'number', id: 'cClose', min: 1, max: 31, required: true, value: c?.closeDay || 1 });
  const due = h('input', { type: 'number', id: 'cDue', min: 1, max: 31, required: true, value: c?.dueDay || 10 });
  const acc = h('select', {}, ...targetOptions('a:' + (c?.account || st.fin.accounts[0]?.id), { cards: false }));
  const arch = h('input', { type: 'checkbox', checked: !!c?.archived });
  const used = c && st.fin.tx.some((t) => t.card === c.id || t.to === c.id);
  d.replaceChildren(h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const card = { id: c?.id || newId('c'), name: name.value.trim(), limit: Math.abs(parseMoney(limit.value) || 0), closeDay: +close.value, dueDay: +due.value, account: acc.value.slice(2), archived: arch.checked };
    d.close();
    await save({ ...st.fin, cards: c ? st.fin.cards.map((x) => (x.id === c.id ? card : x)) : [...st.fin.cards, card] }, 'Cartão salvo.');
  } }, h('h2', {}, c ? 'Editar cartão' : 'Novo cartão'),
  h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Nome', name), h('label', { class: 'f' }, 'Limite', limit),
    h('label', { class: 'f' }, 'Dia do fechamento', close), h('label', { class: 'f' }, 'Dia do vencimento', due), h('label', { class: 'f' }, 'Pago com a conta', acc)),
  h('p', { class: 'small muted' }, 'Compras a partir do dia do fechamento caem na fatura seguinte.'),
  c ? h('label', { class: 'small row' }, arch, 'Arquivado') : null,
  h('div', { class: 'row' },
    c && !used ? h('button', { type: 'button', class: 'btn sm danger', onclick: async () => { d.close(); await save({ ...st.fin, cards: st.fin.cards.filter((x) => x.id !== c.id) }, 'Cartão apagado.'); } }, '🗑 Apagar') : null,
    h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancelar'), h('button', { class: 'btn primary', id: 'cSave' }, 'Salvar'))));
  d.showModal();
  name.focus();
}

// ── Contas a pagar ──────────────────────────────────────────────────────────
function billsView() {
  const fin = st.fin;
  const up = upcomingBills(fin);
  const EVERY = { month: 'todo mês', year: 'todo ano', week: 'toda semana' };
  return [
    h('section', {}, h('h2', {}, 'Próximas e atrasadas'), up.length ? billList(up) : h('p', { class: 'muted' }, 'Nada a pagar nos próximos dias.'),
      h('p', { class: 'small muted' }, prefs().remind ? `🔔 A NeuroTab avisa por notificação a partir das ${prefs().remindHour}h, dentro da antecedência de cada conta.` : '🔕 Os lembretes estão desligados nas configurações.')),
    h('section', {}, h('div', { class: 'row' }, h('h2', {}, 'Contas recorrentes'), h('span', { class: 'spacer' }), h('button', { class: 'btn sm', id: 'addBill', onclick: () => billDialog() }, '＋ Conta a pagar')),
      fin.bills.length ? h('div', { class: 'list' }, ...fin.bills.map((b) => h('div', { class: 'item row', 'data-billdef': b.id },
        h('b', {}, b.name), h('span', { class: 'small muted' }, `${EVERY[b.every]} · dia ${b.day}${b.every === 'year' ? '/' + b.month : ''}`), b.active ? null : h('span', { class: 'tag' }, 'pausada'),
        h('span', { class: 'spacer' }), h('span', { class: 'money' }, money(b.amount)), h('button', { class: 'btn sm', onclick: () => billDialog(b) }, 'Editar'))))
        : h('p', { class: 'muted small' }, 'Aluguel, luz, internet, assinaturas… Cadastre uma vez e a NeuroTab lembra antes de vencer.')),
  ];
}

function billDialog(b = null) {
  const d = $('#dlg');
  const name = h('input', { type: 'text', id: 'bName', required: true, maxlength: 60, value: b?.name || '', placeholder: 'Ex.: Luz, Aluguel, Netflix' });
  const amount = h('input', { type: 'text', id: 'bAmount', inputmode: 'decimal', required: true, value: b ? (b.amount / 100).toFixed(2).replace('.', ',') : '' });
  const day = h('input', { type: 'number', id: 'bDay', min: 1, max: 31, required: true, value: b?.day || 10 });
  const every = h('select', { id: 'bEvery' }, ...[['month', 'Todo mês'], ['year', 'Todo ano'], ['week', 'Toda semana']].map(([k, v]) => h('option', { value: k, selected: (b?.every || 'month') === k }, v)));
  const mon = h('input', { type: 'number', min: 1, max: 12, value: b?.month || new Date().getMonth() + 1 });
  const start = h('input', { type: 'date', value: b?.start || today() });
  const cat = h('select', {}, ...catOptions(b?.cat || 'contas', 'saida'));
  const target = h('select', {}, ...targetOptions(b ? (b.card ? 'c:' + b.card : 'a:' + b.account) : 'a:' + st.fin.accounts[0]?.id));
  const remind = h('input', { type: 'number', min: 0, max: 30, value: b?.remind ?? 3 });
  const active = h('input', { type: 'checkbox', checked: b ? b.active : true });
  const monRow = h('label', { class: 'f' }, 'Mês', mon), startRow = h('label', { class: 'f' }, 'A partir de', start);
  const paint = () => { monRow.hidden = every.value !== 'year'; startRow.hidden = every.value !== 'week'; };
  every.addEventListener('change', paint);
  d.replaceChildren(h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const [tk, tid] = target.value.split(':');
    const bill = { id: b?.id || newId('b'), name: name.value.trim(), amount: Math.abs(parseMoney(amount.value) || 0), day: +day.value, every: every.value, month: +mon.value,
      start: every.value === 'week' ? start.value : b?.start || today(), cat: cat.value, account: tk === 'a' ? tid : '', card: tk === 'c' ? tid : '', remind: +remind.value, active: active.checked, paid: b?.paid || {} };
    d.close();
    await save({ ...st.fin, bills: b ? st.fin.bills.map((x) => (x.id === b.id ? bill : x)) : [...st.fin.bills, bill] }, 'Conta a pagar salva.');
  } }, h('h2', {}, b ? 'Editar conta a pagar' : 'Nova conta a pagar'),
  h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Nome', name), h('label', { class: 'f' }, 'Valor', amount), h('label', { class: 'f' }, 'Repete', every),
    h('label', { class: 'f' }, 'Dia do vencimento', day), monRow, startRow, h('label', { class: 'f' }, 'Categoria', cat), h('label', { class: 'f' }, 'Paga com', target),
    h('label', { class: 'f' }, 'Lembrar quantos dias antes', remind)),
  h('label', { class: 'small row' }, active, 'Ativa'),
  h('div', { class: 'row' },
    b ? h('button', { type: 'button', class: 'btn sm danger', onclick: async () => { d.close(); await save({ ...st.fin, bills: st.fin.bills.filter((x) => x.id !== b.id) }, 'Conta a pagar apagada (os lançamentos ficam).'); } }, '🗑 Apagar') : null,
    h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancelar'), h('button', { class: 'btn primary', id: 'bSave' }, 'Salvar'))));
  paint();
  d.showModal();
  name.focus();
}

// ── Orçamento ───────────────────────────────────────────────────────────────
function budgetView() {
  const fin = st.fin;
  const s = monthSummary(fin, month);
  const prev = monthSeries(fin, shiftMonth(month, -1), 3);
  const avg = (cat) => Math.round(prev.reduce((a, m) => a + Math.max(0, m.byCat[cat] || 0), 0) / 3);
  const rows = fin.categories.filter((c) => c.kind !== 'entrada' && c.id !== 'transferencia').map((c) => {
    const lim = fin.budgets[c.id] || 0;
    const input = h('input', { type: 'text', inputmode: 'decimal', 'data-budget': c.id, placeholder: 'sem limite', value: lim ? (lim / 100).toFixed(2).replace('.', ',') : '', style: { width: '120px' } });
    input.addEventListener('change', async () => {
      const v = Math.abs(parseMoney(input.value) || 0);
      const budgets = { ...fin.budgets };
      if (v) budgets[c.id] = v; else delete budgets[c.id];
      await save({ ...fin, budgets }, 'Orçamento salvo.');
    });
    const spent = Math.max(0, s.byCat[c.id] || 0);
    return h('tr', {}, h('td', {}, `${c.icon} ${c.name}`), h('td', {}, input), h('td', { class: 'money' }, money(spent)), h('td', { class: 'money muted' }, money(avg(c.id))),
      h('td', {}, lim ? h('div', { class: 'bar ' + (spent / lim >= 1 ? 'over' : spent / lim >= 0.8 ? 'warn' : '') }, h('i', { style: { width: Math.min(100, Math.round((spent / lim) * 100)) + '%' } })) : null));
  });
  const bs = budgetStatus(fin, month);
  return [
    bs.length ? h('section', {}, h('h2', {}, 'Como está o mês'), budgetBars(bs), h('p', { class: 'small muted' }, 'Avisa em 80% (amarelo) e ao passar do limite (vermelho).')) : null,
    h('section', {}, h('h2', {}, 'Limite por categoria'),
      h('table', { class: 'tx' }, h('thead', {}, h('tr', {}, h('th', {}, 'Categoria'), h('th', {}, 'Limite por mês'), h('th', { class: 'money' }, 'Gasto no mês'), h('th', { class: 'money' }, 'Média de 3 meses'), h('th', {}))), h('tbody', {}, ...rows))),
  ].filter(Boolean);
}

// ── Importar ────────────────────────────────────────────────────────────────
function importView() {
  if (imp?.step === 'preview') return previewView();
  const file = h('input', { type: 'file', id: 'impFile', accept: '.ofx,.qfx,.csv,.txt,.pdf,application/pdf,text/csv', hidden: true });
  file.addEventListener('change', () => file.files[0] && readFile(file.files[0]));
  const drop = h('div', { class: 'drop', id: 'impDrop' },
    h('p', {}, '📥 Arraste o arquivo aqui ou ', h('button', { class: 'btn sm', onclick: () => file.click() }, 'escolha o arquivo')),
    h('p', { class: 'small muted' }, 'OFX (extrato e cartão), CSV (Nubank, Inter, C6, planilhas) ou PDF de fatura e extrato. O arquivo é lido aqui, no seu computador.'), file);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  const fin = st.fin;
  const hist = fin.imports.slice().sort((a, b) => b.at - a.at).slice(0, 20);
  return [
    h('section', {}, h('div', { class: 'steps' }, h('b', {}, '1. Arquivo'), '→ 2. Conta ou cartão → 3. Prévia → 4. Importar'), drop,
      imp?.error ? h('p', { class: 'neg small', role: 'alert' }, imp.error) : null),
    hist.length ? h('section', {}, h('h2', {}, 'Importações'), h('table', { class: 'tx' }, h('tbody', {}, ...hist.map((i) => h('tr', { 'data-import': i.id },
      h('td', {}, new Date(i.at).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })), h('td', {}, i.file), h('td', {}, h('span', { class: 'tag' }, i.format)),
      h('td', { class: 'small muted' }, i.card ? '💳 ' + cardName(i.card) : accName(i.account)), h('td', {}, `${fin.tx.filter((t) => t.importId === i.id).length} lançamentos`),
      h('td', {}, h('button', { class: 'btn sm', onclick: async () => {
        if (!confirm(`Desfazer esta importação? Apaga os ${fin.tx.filter((t) => t.importId === i.id).length} lançamentos que vieram dela.`)) return;
        await save(undoImport(st.fin, i.id), 'Importação desfeita.');
      } }, '↶ Desfazer'))))))) : null,
  ].filter(Boolean);
}

async function readFile(f) {
  imp = { file: f.name, step: 'read' };
  try {
    const name = f.name.toLowerCase();
    if (name.endsWith('.pdf') || f.type === 'application/pdf') {
      imp.format = 'pdf';
      imp.buffer = await f.arrayBuffer();
      await readPdf();
    } else {
      const text = await readTextFile(f);
      if (/<OFX>/i.test(text)) {
        imp.format = 'ofx';
        const r = parseOfx(text);
        imp.ofx = r;
        imp.isCard = r.kind === 'cartao';
        imp.raw = r.items;
      } else {
        imp.format = 'csv';
        const p = parseCsv(text);
        imp.csv = p;
        const guess = guessTemplate(p.rows);
        const sig = guess.headerRow >= 0 ? headerSignature(p.rows[guess.headerRow]) : '';
        imp.sig = sig;
        imp.tpl = { ...guess, ...(sig && st.fin.templates.csv[sig] ? st.fin.templates.csv[sig] : {}) };
        imp.savedTpl = !!(sig && st.fin.templates.csv[sig]);
      }
    }
    imp.target = guessTarget();
    imp.isCard = imp.target.startsWith('c:');
    if (imp.format === 'csv') { const first = applyTemplate(imp.csv.rows, imp.tpl); if (!imp.savedTpl && shouldInvert(first.items, imp.isCard)) imp.tpl.invert = true; }
    imp.step = 'preview';
    rebuild();
  } catch (e) {
    if (e.code === 'password' || e.code === 'wrong_password') return pdfPassword(e.code === 'wrong_password');
    imp = { error: e.message || String(e) };
  }
  render();
}

function readTextFile(f) {
  return f.arrayBuffer().then((buf) => {
    const utf = new TextDecoder('utf-8').decode(buf);
    // Muitos bancos exportam em Windows-1252 (acentos viram �).
    return utf.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf;
  });
}

async function readPdf(password = '') {
  const { extractPdf } = await import('./lib/finance/import-pdf.js');
  const r = await extractPdf(imp.buffer, { password });
  imp.pdf = r;
  imp.bank = detectBank(r.text);
  imp.tpl = { ...DEFAULT_PDF_TPL, ...(imp.bank && st.fin.templates.pdf[imp.bank] ? st.fin.templates.pdf[imp.bank] : {}) };
  imp.savedTpl = !!(imp.bank && st.fin.templates.pdf[imp.bank]);
  imp.isCard = /fatura|cart[aã]o de cr[eé]dito|limite dispon[ií]vel|vencimento/i.test(r.text.slice(0, 3000));
}

function pdfPassword(wrong) {
  const d = $('#dlg');
  const pass = h('input', { type: 'password', id: 'pdfPass', autocomplete: 'off', placeholder: 'Senha do PDF' });
  d.replaceChildren(h('form', { onsubmit: async (e) => {
    e.preventDefault();
    d.close();
    try {
      await readPdf(pass.value);
      imp.target = guessTarget();
      imp.isCard = imp.target.startsWith('c:') || imp.isCard;
      imp.step = 'preview';
      rebuild();
      render();
    } catch (err) {
      if (err.code === 'wrong_password') return pdfPassword(true);
      imp = { error: err.message || String(err) }; render();
    }
  } }, h('h2', {}, '🔑 Este PDF tem senha'),
  h('p', { class: 'small muted' }, 'Faturas costumam usar parte do CPF. A senha é usada só para abrir este arquivo agora e não fica guardada.'),
  wrong ? h('p', { class: 'small neg' }, 'Senha incorreta.') : null, pass,
  h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', onclick: () => { d.close(); imp = null; render(); } }, 'Cancelar'), h('button', { class: 'btn primary' }, 'Abrir'))));
  d.showModal();
  pass.focus();
}

// Escolhe a conta/cartão provável: pelo tipo do arquivo e pelo nome do banco.
function guessTarget() {
  const fin = st.fin;
  const hay = `${imp.file} ${imp.bank || ''} ${imp.ofx?.acctId || ''}`.toLowerCase();
  const wantCard = imp.isCard || /fatura|cart|card/i.test(imp.file);
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const named = (list) => list.filter((x) => !x.archived).find((x) => { const k = norm(x.name).split(' ')[0]; return k.length >= 2 && hay.includes(k); });
  const accN = named(fin.accounts), cardN = named(fin.cards);
  if (cardN && (wantCard || !accN)) return 'c:' + cardN.id;
  if (accN && !wantCard) return 'a:' + accN.id;
  if (wantCard && fin.cards.some((c) => !c.archived)) return 'c:' + fin.cards.find((c) => !c.archived).id;
  return 'a:' + (accN || fin.accounts.find((x) => !x.archived) || fin.accounts[0]).id;
}

// Recalcula a prévia a partir do arquivo e do molde atual.
function rebuild() {
  const fin = st.fin;
  let items = [];
  imp.rejected = [];
  if (imp.format === 'ofx') items = imp.raw.map((i) => ({ ...i }));
  else if (imp.format === 'csv') { const r = applyTemplate(imp.csv.rows, imp.tpl); items = r.items; imp.skipped = r.skipped; }
  else if (imp.format === 'pdf') { const r = parsePdfLines(imp.ocrLines || imp.pdf.lines, { tpl: imp.tpl, isCard: imp.isCard, text: imp.pdf.text }); items = r.items; imp.rejected = r.rejected; }
  if (imp.format === 'ofx' && imp.flip) items = items.map((i) => ({ ...i, kind: i.kind === 'entrada' ? 'saida' : 'entrada' }));
  const [tk, tid] = imp.target.split(':');
  let list = items.map((i, n) => ({
    id: 'p' + n, date: i.date, amount: i.amount, kind: i.kind, desc: i.desc, fitid: i.fitid,
    account: tk === 'a' ? tid : fin.cards.find((c) => c.id === tid)?.account || '', card: tk === 'c' ? tid : undefined,
    cat: suggestCategory(fin, i.desc, i.kind).cat, inst: i.inst || null,
  }));
  if (tk === 'a') list = fixBillPayments(fin, list);
  list = markDuplicates(fin.tx, list);
  // Na fatura, "pagamento recebido" é o pagamento da fatura anterior: já entra pelo extrato da conta.
  imp.rows = list.map((t) => ({ ...t, on: !t.dup && !(tk === 'c' && t.kind === 'entrada' && (isBillPayment(t.desc) || /^pag(amento|to)\b/i.test(t.desc))) }));
}

function previewView() {
  const fin = st.fin;
  const rows = imp.rows || [];
  const on = rows.filter((r) => r.on);
  const opts = [];
  const re = () => { rebuild(); render(); };
  const target = h('select', { id: 'impTarget', onchange: (e) => { imp.target = e.target.value; imp.isCard = imp.target.startsWith('c:'); re(); } }, ...targetOptions(imp.target));
  opts.push(h('label', { class: 'f' }, 'Importar para', target));
  if (imp.format === 'csv') {
    const cols = imp.csv.rows[imp.tpl.headerRow] || imp.csv.rows[0] || [];
    const colSel = (key, label, allowNone) => h('label', { class: 'f' }, label, h('select', { 'data-col': key, onchange: (e) => { imp.tpl[key] = +e.target.value; re(); } },
      allowNone ? h('option', { value: -1, selected: imp.tpl[key] < 0 }, '—') : null,
      ...cols.map((c, i) => h('option', { value: i, selected: imp.tpl[key] === i }, c || `Coluna ${i + 1}`))));
    opts.push(colSel('date', 'Coluna da data'), colSel('desc', 'Coluna da descrição'), colSel('amount', 'Coluna do valor', true));
    if (imp.tpl.amount < 0) opts.push(colSel('debit', 'Coluna de débito (saídas)', true), colSel('credit', 'Coluna de crédito (entradas)', true));
    opts.push(h('label', { class: 'f' }, 'Formato da data', h('select', { onchange: (e) => { imp.tpl.order = e.target.value; re(); } }, h('option', { value: 'dmy', selected: imp.tpl.order === 'dmy' }, 'dia/mês/ano'), h('option', { value: 'mdy', selected: imp.tpl.order === 'mdy' }, 'mês/dia/ano'))));
    opts.push(h('label', { class: 'small row' }, h('input', { type: 'checkbox', id: 'impInvert', checked: imp.tpl.invert, onchange: (e) => { imp.tpl.invert = e.target.checked; re(); } }), 'Inverter sinais (compras vêm positivas)'));
  } else if (imp.format === 'pdf') {
    opts.push(h('label', { class: 'f' }, 'Sinais', h('select', { id: 'impPdfInvert', onchange: (e) => { imp.tpl.invert = e.target.value === 'auto' ? 'auto' : e.target.value === '1'; re(); } },
      h('option', { value: 'auto', selected: imp.tpl.invert === 'auto' }, 'Automático'), h('option', { value: '1', selected: imp.tpl.invert === true }, 'Positivo = gasto (fatura)'), h('option', { value: '0', selected: imp.tpl.invert === false }, 'Positivo = entrada (extrato)'))));
    opts.push(h('label', { class: 'f' }, 'Formato da data', h('select', { onchange: (e) => { imp.tpl.order = e.target.value; re(); } }, h('option', { value: 'dmy', selected: imp.tpl.order === 'dmy' }, 'dia/mês'), h('option', { value: 'mdy', selected: imp.tpl.order === 'mdy' }, 'mês/dia'))));
    opts.push(h('label', { class: 'f' }, 'Data no', h('select', { onchange: (e) => { imp.tpl.dateAt = e.target.value; re(); } }, h('option', { value: 'start', selected: imp.tpl.dateAt !== 'end' }, 'começo da linha'), h('option', { value: 'end', selected: imp.tpl.dateAt === 'end' }, 'fim da linha'))));
    const ign = h('input', { type: 'text', id: 'impIgnore', value: (imp.tpl.ignore || []).join('; '), placeholder: 'ex.: pagamento recebido; saldo' });
    ign.addEventListener('change', () => { imp.tpl.ignore = ign.value.split(';').map((s) => s.trim()).filter(Boolean); re(); });
    opts.push(h('label', { class: 'f' }, 'Ignorar linhas com (separe com ;)', ign));
  } else if (imp.format === 'ofx') {
    opts.push(h('label', { class: 'small row' }, h('input', { type: 'checkbox', checked: !!imp.flip, onchange: (e) => { imp.flip = e.target.checked; re(); } }), 'Inverter sinais'));
  }
  const table = h('table', { class: 'tx', id: 'impTable' },
    h('thead', {}, h('tr', {}, h('th', {}, h('input', { type: 'checkbox', 'aria-label': 'Todos', checked: rows.length && on.length === rows.length, onchange: (e) => { rows.forEach((r) => { r.on = e.target.checked; }); render(); } })),
      h('th', {}, 'Data'), h('th', {}, 'Descrição'), h('th', {}, 'Categoria'), h('th', { class: 'money' }, 'Valor'), h('th', {}))),
    h('tbody', {}, ...rows.map((r) => h('tr', { class: (r.dup ? 'dup ' : '') + (r.on ? '' : 'off') },
      h('td', {}, h('input', { type: 'checkbox', checked: r.on, 'aria-label': 'Importar', onchange: (e) => { r.on = e.target.checked; render(); } })),
      h('td', {}, fmtDate(r.date)),
      h('td', {}, r.desc, r.inst ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, `${r.inst.n}/${r.inst.of}`) : null, r.kind === 'transferencia' ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'transferência') : null),
      h('td', {}, h('select', { onchange: (e) => { r.cat = e.target.value; r.catTouched = true; } }, ...catOptions(r.cat, r.kind === 'transferencia' ? '' : r.kind))),
      h('td', { class: 'money ' + (r.kind === 'entrada' ? 'pos' : r.kind === 'saida' ? 'neg' : '') }, money(r.kind === 'entrada' ? r.amount : -r.amount, { sign: true })),
      h('td', {}, r.dup ? h('span', { class: 'tag warn', title: 'Já existe um lançamento igual' }, r.dup === 'certo' ? 'já importado' : 'parece repetido') : null)))));
  const sumOn = on.reduce((a, r) => a + (r.kind === 'entrada' ? r.amount : r.kind === 'saida' ? -r.amount : 0), 0);
  const dups = rows.filter((r) => r.dup).length;
  const pdfHelp = imp.format === 'pdf' ? [
    imp.pdf.scanned && !imp.ocrLines ? h('div', { class: 'notice warn' }, h('p', {}, 'Este PDF parece ser uma imagem (escaneado). Dá para ler o texto aqui mesmo, com o leitor de texto local (pode levar um minuto).'),
      h('button', { class: 'btn sm', id: 'impOcr', onclick: runOcr }, '🔍 Ler o texto (OCR)')) : null,
    imp.rejected.length ? h('details', { class: 'small' }, h('summary', {}, `${imp.rejected.length} linha(s) não viraram lançamento`), h('pre', { class: 'lines' }, imp.rejected.slice(0, 120).map((r) => `[${r.why}] ${r.line}`).join('\n'))) : null,
    !rows.length ? h('p', { class: 'small muted' }, 'Nenhuma linha reconhecida. Ajuste as opções acima (sinais, posição da data) ou veja as linhas do arquivo:') : null,
    !rows.length ? h('pre', { class: 'lines' }, (imp.ocrLines || imp.pdf.lines).slice(0, 80).join('\n')) : null,
  ] : [];
  return [h('section', {},
    h('div', { class: 'steps' }, '1. Arquivo → ', h('b', {}, '2. Conta ou cartão → 3. Prévia'), ' → 4. Importar'),
    h('p', {}, h('b', {}, imp.file), ' · ', h('span', { class: 'tag' }, imp.format), imp.bank ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, imp.bank) : null,
      imp.savedTpl ? h('span', { class: 'tag ok', style: { marginLeft: '6px' } }, 'molde salvo') : null),
    h('div', { class: 'grid2' }, ...opts),
    ...pdfHelp,
    h('p', { class: 'small', id: 'impSummary' }, `${rows.length} encontrado(s) · ${on.length} para importar`, dups ? ` · ${dups} parece(m) repetido(s) (desmarcado)` : '', imp.skipped ? ` · ${imp.skipped} linha(s) ignorada(s)` : '', ' · total ', money(sumOn, { sign: true })),
    rows.length ? table : null,
    h('div', { class: 'row', style: { marginTop: '10px' } },
      imp.format !== 'ofx' ? h('label', { class: 'small row' }, h('input', { type: 'checkbox', id: 'impSaveTpl', checked: imp.saveTpl !== false, onchange: (e) => { imp.saveTpl = e.target.checked; } }), 'Lembrar estas opções para este banco') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => { imp = null; render(); } }, 'Cancelar'),
      h('button', { class: 'btn primary', id: 'impGo', disabled: !on.length, onclick: commitImport }, `Importar ${on.length}`)))];
}

async function runOcr() {
  const btn = $('#impOcr');
  if (btn) { btn.disabled = true; btn.textContent = 'Lendo…'; }
  try {
    const { ocrPdf } = await import('./lib/finance/import-pdf.js');
    imp.ocrLines = await ocrPdf(imp.pdf.doc, { onProgress: (m) => { if (btn && m.progress != null) btn.textContent = `Lendo a página ${m.page} de ${m.pages}… ${Math.round(m.progress * 100)}%`; } });
    imp.bank = imp.bank || detectBank(imp.ocrLines.join('\n'));
    rebuild();
  } catch (e) {
    toast('Não consegui ler o texto: ' + (e.message || e));
  }
  render();
}

async function commitImport() {
  let fin = st.fin;
  const importId = newId('i');
  const [tk, tid] = imp.target.split(':');
  const add = [];
  for (const r of imp.rows.filter((x) => x.on)) {
    const base = { date: r.date, amount: r.amount, desc: r.desc, cat: r.cat, kind: r.kind, account: r.account, card: r.card, to: r.to, fitid: r.fitid, source: imp.format, importId };
    const [t] = makeTx(fin, base);
    if (!t) continue;
    if (r.inst) t.inst = { ...r.inst, group: 'imp-' + importId + '-' + r.desc.slice(0, 20) };
    add.push(cleanTx(t));
    if (r.catTouched) fin = learnRule(fin, r.desc, r.cat);
  }
  fin = { ...fin, tx: [...fin.tx, ...add.filter(Boolean)], imports: [...fin.imports, { id: importId, at: Date.now(), file: imp.file, format: imp.format, count: add.length, account: tk === 'a' ? tid : '', card: tk === 'c' ? tid : '' }] };
  if (imp.saveTpl !== false) {
    if (imp.format === 'csv' && imp.sig) fin = { ...fin, templates: { ...fin.templates, csv: { ...fin.templates.csv, [imp.sig]: { ...imp.tpl } } } };
    if (imp.format === 'pdf' && imp.bank) fin = { ...fin, templates: { ...fin.templates, pdf: { ...fin.templates.pdf, [imp.bank]: { ...imp.tpl } } } };
  }
  const n = add.length;
  imp = null;
  if (await save(fin)) toast(`${n} lançamento(s) importado(s).`, 'Desfazer', () => save(undoImport(st.fin, importId)));
}

// ── Dados e segurança ───────────────────────────────────────────────────────
function dataView() {
  const fin = st.fin;
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (!confirm('Restaurar este backup? As finanças atuais deste computador serão substituídas.')) return;
    try {
      const sealed = await importFinance(JSON.parse(await f.text()));
      st = await loadFinance();
      render();
      toast(sealed ? 'Backup restaurado. Ele está no cofre: abra com a senha dele.' : 'Backup restaurado.');
    } catch (e) { toast(e.message || String(e)); }
  });
  const learned = fin.rules.filter((r) => r.learned);
  return [
    h('section', {}, h('h2', {}, '🔐 Cofre'),
      st.vault
        ? [h('p', {}, '✅ Ligado. Os dados ficam cifrados neste computador e bloqueiam depois de ', String(prefs().lockMin || '∞'), ' min sem uso (ou ao fechar o navegador).'),
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => vaultDialog('change') }, 'Trocar a senha'), h('button', { class: 'btn', onclick: () => vaultDialog('remove') }, 'Desligar o cofre'))]
        : [h('p', {}, 'Desligado. Com o cofre, os dados ficam cifrados (AES-256) e só abrem com a sua senha.'), h('button', { class: 'btn primary', id: 'vaultCreate', onclick: () => vaultDialog('create') }, 'Ligar o cofre')],
      h('label', { class: 'small row', style: { marginTop: '8px' } }, 'Bloquear depois de', h('select', { onchange: async (e) => { await savePrefs({ lockMin: +e.target.value }); render(); } },
        ...[[5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 hora'], [0, 'só ao fechar o navegador']].map(([v, l]) => h('option', { value: v, selected: prefs().lockMin === v }, l)))),
      h('label', { class: 'small row' }, h('input', { type: 'checkbox', id: 'discreetDefault', checked: prefs().discreet, onchange: async (e) => { await savePrefs({ discreet: e.target.checked }); reveal = false; render(); } }), 'Modo discreto: esconder os valores (••••) até tocar no 👁')),
    h('section', {}, h('h2', {}, 'Regras de categoria aprendidas'),
      learned.length ? h('table', { class: 'tx' }, h('tbody', {}, ...learned.map((r) => h('tr', {}, h('td', {}, `"${r.match}"`), h('td', {}, '→ ', catLabel(r.cat)),
        h('td', {}, h('button', { class: 'btn sm', onclick: () => save({ ...fin, rules: fin.rules.filter((x) => x.id !== r.id) }, 'Regra apagada.') }, '🗑'))))))
        : h('p', { class: 'small muted' }, 'Quando você corrige a categoria de um lançamento, a NeuroTab cria uma regra para os próximos parecidos.')),
    h('section', {}, h('h2', {}, 'Backup e exclusão'),
      h('p', { class: 'small muted' }, 'As finanças não entram no backup comum nem na sincronização. Guarde um backup próprio: com o cofre ligado, ele sai cifrado e só abre com a senha.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', id: 'finBackup', onclick: async () => download(JSON.stringify(await exportFinance()), `neurotab-financas-${today()}.json`, 'application/json') }, '⬇ Baixar backup das finanças'),
        h('button', { class: 'btn', onclick: () => file.click() }, '⬆ Restaurar backup'), file,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn danger', id: 'finWipe', onclick: async () => {
          if (!confirm('Apagar TODAS as finanças deste computador (lançamentos, contas, cartões, regras e o cofre)? Isso não pode ser desfeito.')) return;
          await wipeFinance(); st = await loadFinance(); tab = 'resumo'; render(); toast('Finanças apagadas.');
        } }, '🗑 Apagar tudo'))),
  ];
}

function download(text, name, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ── Início ──────────────────────────────────────────────────────────────────
async function init() {
  data = await loadData();
  initI18n(data.settings.lang);
  startIconizer();
  st = await loadFinance();
  $('#prevMonth').onclick = () => { month = shiftMonth(month, -1); render(); };
  $('#nextMonth').onclick = () => { month = shiftMonth(month, 1); render(); };
  $('#eye').onclick = () => { if (prefs().discreet) reveal = !reveal; else { savePrefs({ discreet: true }); reveal = false; } render(); };
  $('#lockBtn').onclick = async () => { await lockFinance(); st = await loadFinance(); render(); };
  $('#addTx').onclick = () => txDialog();
  onFinanceChange(async () => {
    if (saving) return;
    const keep = st.fresh;
    st = await loadFinance();
    st.fresh = keep && !st.fin?.tx.length;
    if (!$('#dlg').open) render();
  });
  // Uso renova o prazo do bloqueio automático.
  let last = 0;
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { if (st.vault && Date.now() - last > 30e3) { last = Date.now(); touchVault(); } }, { passive: true });
  // Bloqueou em outra aba ou o prazo venceu: volta para a tela do cadeado.
  setInterval(async () => { if (st.vault && st.state === 'open') { const s = await loadFinance(); if (s.state === 'locked') { st = s; render(); } } }, 20e3);
  addEventListener('hashchange', () => { tab = location.hash.slice(1) || 'resumo'; render(); });
  if (location.search.includes('add=1')) setTimeout(() => st.state === 'open' && txDialog(), 50);
  render();
}
init();
