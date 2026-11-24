// Finanças (#66): modelo dos dados e cálculos (resumo do mês, saldos, faturas,
// parcelas, contas a pagar e orçamento). Tudo puro, testável, em centavos inteiros.
import { sum, splitInstallments } from './money.js';
import { DEFAULT_CATEGORIES } from './categorize.js';

export const FIN_KEY = 'nt_finance';
export const FIN_VERSION = 1;
export const KINDS = ['saida', 'entrada', 'transferencia'];
export const ACCOUNT_KINDS = ['corrente', 'poupanca', 'carteira', 'investimento', 'outro'];
export const SOURCES = ['manual', 'voz', 'captura', 'ofx', 'csv', 'pdf', 'recorrente'];
export const BILL_EVERY = ['month', 'year', 'week'];

export const newId = (p = 'f') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'));
const isMonth = (s) => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const clampDay = (v) => Math.min(31, Math.max(1, int(v, 1)));

export const today = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const monthOf = (date) => String(date).slice(0, 7);

// Soma k meses a uma data 'AAAA-MM-DD' mantendo o dia (limitado ao fim do mês).
export function addMonths(date, k, day) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  const dd = Math.min(day || d, last);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
export const addDays = (date, k) => {
  const t = new Date(date + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + k);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
export const shiftMonth = (month, k) => addMonths(month + '-01', k).slice(0, 7);

export function emptyFinance() {
  return {
    v: FIN_VERSION,
    accounts: [{ id: 'acc-main', name: 'Conta principal', kind: 'corrente', initial: 0, archived: false }],
    cards: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    rules: [],
    tx: [],
    bills: [],
    budgets: {},
    imports: [],
    templates: { csv: {}, pdf: {} },
  };
}

function cleanTx(t) {
  if (!t || typeof t !== 'object' || !isDate(t.date)) return null;
  const amount = Math.abs(int(t.amount));
  if (!amount) return null;
  const out = {
    id: str(t.id, 40) || newId('t'),
    date: t.date,
    amount,
    desc: str(t.desc, 200),
    cat: str(t.cat, 40),
    kind: KINDS.includes(t.kind) ? t.kind : 'saida',
    account: str(t.account, 40),
    source: SOURCES.includes(t.source) ? t.source : 'manual',
  };
  if (t.card) out.card = str(t.card, 40);
  if (t.to) out.to = str(t.to, 40);
  if ((out.card || out.to) && isMonth(t.invoice)) out.invoice = t.invoice;
  if (t.fitid) out.fitid = str(t.fitid, 80);
  if (t.importId) out.importId = str(t.importId, 40);
  if (t.bill) out.bill = str(t.bill, 40);
  if (t.note) out.note = str(t.note, 500);
  if (t.inst && int(t.inst.of) > 1) out.inst = { n: Math.min(int(t.inst.n, 1), int(t.inst.of)), of: int(t.inst.of), group: str(t.inst.group, 40) };
  return out;
}

export function sanitizeFinance(raw) {
  const base = emptyFinance();
  if (!raw || typeof raw !== 'object') return base;
  const arr = (v) => (Array.isArray(v) ? v : []);
  const accounts = arr(raw.accounts).filter((a) => a && a.id).map((a) => ({
    id: str(a.id, 40), name: str(a.name, 60) || 'Conta', kind: ACCOUNT_KINDS.includes(a.kind) ? a.kind : 'corrente',
    initial: int(a.initial), archived: !!a.archived,
  }));
  const cards = arr(raw.cards).filter((c) => c && c.id).map((c) => ({
    id: str(c.id, 40), name: str(c.name, 60) || 'Cartão', limit: Math.max(0, int(c.limit)),
    closeDay: clampDay(c.closeDay), dueDay: clampDay(c.dueDay), account: str(c.account, 40), archived: !!c.archived,
  }));
  const cats = arr(raw.categories).filter((c) => c && c.id).map((c) => ({
    id: str(c.id, 40), name: str(c.name, 40) || c.id, icon: str(c.icon, 8),
    kind: ['saida', 'entrada', 'ambos'].includes(c.kind) ? c.kind : 'saida',
  }));
  // Nunca perde as categorias padrão que o resto do código usa (ex.: transferência).
  for (const d of base.categories) if (!cats.some((c) => c.id === d.id)) cats.push({ ...d });
  const bills = arr(raw.bills).filter((b) => b && b.id).map((b) => ({
    id: str(b.id, 40), name: str(b.name, 60) || 'Conta', amount: Math.abs(int(b.amount)), day: clampDay(b.day),
    every: BILL_EVERY.includes(b.every) ? b.every : 'month', month: Math.min(12, Math.max(1, int(b.month, 1))),
    start: isDate(b.start) ? b.start : '', cat: str(b.cat, 40), account: str(b.account, 40), card: str(b.card, 40),
    remind: Math.min(30, Math.max(0, int(b.remind, 3))), active: b.active !== false, autoTx: !!b.autoTx,
    paid: b.paid && typeof b.paid === 'object' ? Object.fromEntries(Object.entries(b.paid).filter(([k, v]) => /^\d{4}-\d{2}(-\d{2})?$/.test(k) && typeof v === 'string')) : {},
  }));
  const budgets = {};
  for (const [k, v] of Object.entries(raw.budgets || {})) if (int(v) > 0) budgets[str(k, 40)] = int(v);
  const rules = arr(raw.rules).filter((r) => r && r.match && r.cat).map((r) => ({ id: str(r.id, 40) || newId('r'), match: str(r.match, 80), cat: str(r.cat, 40), learned: !!r.learned }));
  const imports = arr(raw.imports).filter((i) => i && i.id).map((i) => ({
    id: str(i.id, 40), at: int(i.at), file: str(i.file, 120), format: str(i.format, 10), count: int(i.count), account: str(i.account, 40), card: str(i.card, 40),
  }));
  const tpl = raw.templates && typeof raw.templates === 'object' ? raw.templates : {};
  return {
    v: FIN_VERSION,
    accounts: accounts.length ? accounts : base.accounts,
    cards, categories: cats, rules,
    tx: arr(raw.tx).map(cleanTx).filter(Boolean),
    bills, budgets, imports,
    templates: { csv: tpl.csv && typeof tpl.csv === 'object' ? tpl.csv : {}, pdf: tpl.pdf && typeof tpl.pdf === 'object' ? tpl.pdf : {} },
  };
}

export { cleanTx };

// ── Cartões ─────────────────────────────────────────────────────────────────
// Em qual fatura (mês de vencimento 'AAAA-MM') cai uma compra feita em `date`.
// Compras no dia do fechamento ou depois vão para a fatura seguinte.
export function invoiceFor(card, date) {
  const [y, m, d] = date.split('-').map(Number);
  let closeMonth = `${y}-${String(m).padStart(2, '0')}`;
  if (d >= card.closeDay) closeMonth = shiftMonth(closeMonth, 1);
  return card.dueDay > card.closeDay ? closeMonth : shiftMonth(closeMonth, 1);
}

export const cardDates = (card, invoice) => {
  const due = addMonths(invoice + '-01', 0, card.dueDay);
  const closeMonth = card.dueDay > card.closeDay ? invoice : shiftMonth(invoice, -1);
  return { due, close: addMonths(closeMonth + '-01', 0, card.closeDay) };
};

// Total de uma fatura: compras menos estornos e créditos lançados no cartão.
export function invoiceTotal(fin, cardId, invoice) {
  const list = fin.tx.filter((t) => t.card === cardId && t.invoice === invoice);
  return sum(list.filter((t) => t.kind === 'saida'), (t) => t.amount) - sum(list.filter((t) => t.kind === 'entrada'), (t) => t.amount);
}

// Faturas de um cartão (passadas e futuras com lançamentos), da mais recente à mais antiga.
export function cardInvoices(fin, cardId, now = today()) {
  const card = fin.cards.find((c) => c.id === cardId);
  if (!card) return [];
  const keys = new Set(fin.tx.filter((t) => t.card === cardId && t.invoice).map((t) => t.invoice));
  keys.add(invoiceFor(card, now));
  const paid = (inv) => fin.tx.some((t) => t.kind === 'transferencia' && t.to === cardId && t.invoice === inv);
  return [...keys].sort().reverse().map((inv) => {
    const { due, close } = cardDates(card, inv);
    const status = paid(inv) ? 'paga' : now >= close ? (now > due ? 'vencida' : 'fechada') : 'aberta';
    return { invoice: inv, total: invoiceTotal(fin, cardId, inv), due, close, status };
  });
}

// Limite usado: tudo o que ainda não foi pago.
export function cardUsed(fin, cardId) {
  return cardInvoices(fin, cardId).filter((i) => i.status !== 'paga').reduce((a, i) => a + Math.max(0, i.total), 0);
}

// ── Lançamentos ─────────────────────────────────────────────────────────────
// Prepara um lançamento novo: calcula a fatura do cartão e, se for parcelado,
// gera as parcelas (o valor informado é o total). Devolve uma lista.
export function makeTx(fin, input) {
  const card = input.card ? fin.cards.find((c) => c.id === input.card) : null;
  const base = cleanTx({ ...input, id: input.id || newId('t'), account: card ? card.account || input.account : input.account });
  if (!base) return [];
  if (card) { base.card = card.id; base.invoice = invoiceFor(card, base.date); }
  const n = int(input.installments, 1);
  if (n <= 1 || base.kind !== 'saida') return [base];
  const group = newId('g');
  return splitInstallments(base.amount, n).map((amount, i) => {
    const date = i === 0 ? base.date : addMonths(base.date, i);
    const t = { ...base, id: i ? newId('t') : base.id, amount, date, inst: { n: i + 1, of: n, group } };
    if (card) t.invoice = shiftMonth(invoiceFor(card, base.date), i);
    return t;
  });
}

// Saldo de uma conta até uma data (inclusive). Compras no cartão não mexem no saldo;
// o pagamento da fatura (transferência da conta para o cartão) mexe.
export function accountBalance(fin, accId, until = '9999-12-31') {
  const acc = fin.accounts.find((a) => a.id === accId);
  let bal = acc ? acc.initial : 0;
  for (const t of fin.tx) {
    if (t.date > until || t.card) continue;
    if (t.kind === 'transferencia') {
      if (t.account === accId) bal -= t.amount;
      if (t.to === accId) bal += t.amount;
    } else if (t.account === accId) bal += t.kind === 'entrada' ? t.amount : -t.amount;
  }
  return bal;
}

// Resumo de um mês por data da compra (competência). Transferências não contam.
export function monthSummary(fin, month) {
  const list = fin.tx.filter((t) => monthOf(t.date) === month && t.kind !== 'transferencia');
  const income = sum(list.filter((t) => t.kind === 'entrada' && !t.card), (t) => t.amount);
  const refunds = sum(list.filter((t) => t.kind === 'entrada' && t.card), (t) => t.amount);
  const expense = sum(list.filter((t) => t.kind === 'saida'), (t) => t.amount) - refunds;
  const byCat = {};
  for (const t of list) {
    const k = t.cat || 'outros';
    const v = t.kind === 'saida' ? t.amount : t.card ? -t.amount : 0;
    if (v) byCat[k] = (byCat[k] || 0) + v;
  }
  return { month, income, expense, balance: income - expense, byCat, count: list.length };
}

// Série de n meses terminando em `end` (para os gráficos).
export function monthSeries(fin, end, n = 6) {
  return Array.from({ length: n }, (_, i) => monthSummary(fin, shiftMonth(end, i - n + 1)));
}

// Orçamento do mês: limite, gasto e nível (ok < 80% ≤ alerta < 100% ≤ estourou).
export function budgetStatus(fin, month) {
  const { byCat } = monthSummary(fin, month);
  return Object.entries(fin.budgets).map(([cat, limit]) => {
    const spent = Math.max(0, byCat[cat] || 0);
    const pct = limit ? spent / limit : 0;
    return { cat, limit, spent, pct, level: pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok' };
  }).sort((a, b) => b.pct - a.pct);
}

// ── Contas a pagar ──────────────────────────────────────────────────────────
// Chave da ocorrência: 'AAAA-MM' (mensal), 'AAAA' (anual) ou a data (semanal).
export function occurrenceKey(bill, due) {
  return bill.every === 'year' ? due.slice(0, 4) + '-' + String(bill.month).padStart(2, '0') : bill.every === 'week' ? due : due.slice(0, 7);
}

function dueIn(bill, month) {
  if (bill.every === 'year') return Number(month.slice(5)) === bill.month ? addMonths(month + '-01', 0, bill.day) : null;
  return addMonths(month + '-01', 0, bill.day);
}

// Ocorrências entre `from` e `to` (inclusive), com a situação de cada uma.
export function billOccurrences(bill, from, to, now = today()) {
  if (!bill.active) return [];
  const out = [];
  if (bill.every === 'week') {
    const start = bill.start || from;
    let d = start;
    if (d < from) d = addDays(d, Math.ceil(daysBetween(d, from) / 7) * 7);
    for (; d <= to; d = addDays(d, 7)) out.push(d);
  } else {
    for (let m = monthOf(from); m <= monthOf(to); m = shiftMonth(m, 1)) {
      const d = dueIn(bill, m);
      if (d && d >= from && d <= to && (!bill.start || d >= bill.start)) out.push(d);
    }
  }
  return out.map((due) => {
    const key = occurrenceKey(bill, due);
    const paid = bill.paid[key] || '';
    const days = daysBetween(now, due);
    return { bill: bill.id, name: bill.name, amount: bill.amount, due, key, paid, days, status: paid ? 'paga' : days < 0 ? 'atrasada' : days === 0 ? 'hoje' : 'aberta' };
  });
}

// Próximas contas (e as atrasadas dos últimos 60 dias), da mais urgente à menos.
export function upcomingBills(fin, now = today(), horizon = 35) {
  const from = addDays(now, -60), to = addDays(now, horizon);
  return fin.bills.flatMap((b) => billOccurrences(b, from, to, now))
    .filter((o) => o.status !== 'paga')
    .sort((a, b) => a.due.localeCompare(b.due));
}

// Quais contas pedem lembrete hoje (dentro da antecedência de cada uma, ou atrasadas).
export function billsToRemind(fin, now = today()) {
  return upcomingBills(fin, now).filter((o) => {
    const b = fin.bills.find((x) => x.id === o.bill);
    return o.days <= (b?.remind ?? 3);
  });
}

// Marca uma ocorrência como paga criando o lançamento. Devolve { fin, tx }.
export function payBill(fin, billId, key, { date = today(), amount } = {}) {
  const bill = fin.bills.find((b) => b.id === billId);
  if (!bill) return { fin, tx: null };
  const [tx] = makeTx(fin, {
    date, amount: amount ?? bill.amount, desc: bill.name, cat: bill.cat, kind: 'saida',
    account: bill.account || fin.accounts[0]?.id, card: bill.card || undefined, source: 'recorrente', bill: bill.id,
  });
  if (!tx) return { fin, tx: null };
  const bills = fin.bills.map((b) => (b.id === billId ? { ...b, paid: { ...b.paid, [key]: tx.id } } : b));
  return { fin: { ...fin, bills, tx: [...fin.tx, tx] }, tx };
}

// ── Filtros ─────────────────────────────────────────────────────────────────
export function filterTx(fin, { from, to, account, card, cat, kind, q } = {}) {
  const needle = q ? q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
  return fin.tx.filter((t) => (!from || t.date >= from) && (!to || t.date <= to)
    && (!account || t.account === account || t.to === account)
    && (!card || t.card === card || t.to === card)
    && (!cat || t.cat === cat) && (!kind || t.kind === kind)
    && (!needle || `${t.desc} ${t.note || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(needle)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

// Remove um lançamento; se for parcela, `all` remove o grupo todo. Limpa o "pago" das contas.
export function removeTx(fin, id, { all = false } = {}) {
  const t = fin.tx.find((x) => x.id === id);
  if (!t) return fin;
  const gone = new Set(all && t.inst ? fin.tx.filter((x) => x.inst?.group === t.inst.group).map((x) => x.id) : [id]);
  const bills = fin.bills.map((b) => ({ ...b, paid: Object.fromEntries(Object.entries(b.paid).filter(([, v]) => !gone.has(v))) }));
  return { ...fin, tx: fin.tx.filter((x) => !gone.has(x.id)), bills };
}

// Desfaz uma importação: apaga tudo o que veio dela.
export function undoImport(fin, importId) {
  return { ...fin, tx: fin.tx.filter((t) => t.importId !== importId), imports: fin.imports.filter((i) => i.id !== importId) };
}
