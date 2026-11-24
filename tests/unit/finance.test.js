// Finanças (#66): dinheiro, modelo, categorias, duplicidade, frases e cofre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, fmtMoney, splitInstallments, sum } from '../../src/lib/finance/money.js';
import {
  emptyFinance, sanitizeFinance, invoiceFor, cardDates, makeTx, accountBalance, monthSummary, budgetStatus,
  billOccurrences, upcomingBills, billsToRemind, payBill, cardInvoices, filterTx, removeTx, undoImport, addMonths, shiftMonth, monthSeries,
} from '../../src/lib/finance/model.js';
import { suggestCategory, learnRule, normalizeDesc, ruleKey, isBillPayment } from '../../src/lib/finance/categorize.js';
import { markDuplicates, fixBillPayments, similarity } from '../../src/lib/finance/dedupe.js';
import { parseFinancePhrase, matchVia } from '../../src/lib/finance/phrases.js';
import { createVault, unlockVault, isSealed } from '../../src/lib/finance/vault.js';
import { sanitizeFinancePrefs, DEFAULT_FINANCE } from '../../src/lib/finance/prefs.js';
import { mergeSettings } from '../../src/lib/store.js';

test('dinheiro: texto → centavos inteiros', () => {
  const cases = [
    ['R$ 1.234,56', 123456], ['45', 4500], ['45,9', 4590], ['-45,00', -4500], ['(45,00)', -4500], ['1.234', 123400],
    ['1234.56', 123456], ['1,234.56', 123456], ['1,2 mil', 120000], ['45 reais', 4500], ['12.5', 1250], ['0,01', 1],
    ['1.234.567,89', 123456789], ['45,00 D', -4500], ['45,00 C', 4500], ['150,00-', -15000], [12.34, 1234], ['abc', null], ['', null],
  ];
  for (const [i, o] of cases) assert.equal(parseMoney(i), o, String(i));
  assert.equal(fmtMoney(123456), 'R$ 1.234,56');
  assert.equal(fmtMoney(-4500), '-R$ 45,00');
  assert.equal(fmtMoney(4500, { sign: true }), '+R$ 45,00');
  assert.equal(fmtMoney(4500, { hidden: true }), '••••');
  assert.equal(fmtMoney(1000, { currency: 'USD', lang: 'en-US' }), '$10.00');
  assert.deepEqual(splitInstallments(10000, 3), [3334, 3333, 3333]);
  assert.equal(sum(splitInstallments(99999, 7)), 99999);
});

test('dados conferidos e categorias padrão preservadas', () => {
  const f = sanitizeFinance({ tx: [{ date: '2026-11-02', amount: -4500, desc: 'x' }, { date: 'ontem', amount: 1 }, { date: '2026-11-02', amount: 0 }], categories: [{ id: 'minha', name: 'Minha' }] });
  assert.equal(f.tx.length, 1);
  assert.equal(f.tx[0].amount, 4500, 'valor sempre positivo, o tipo diz o sinal');
  assert.ok(f.categories.some((c) => c.id === 'minha'));
  assert.ok(f.categories.some((c) => c.id === 'transferencia'));
  assert.equal(f.accounts.length, 1);
  assert.deepEqual(sanitizeFinance(null), emptyFinance());
  assert.deepEqual(mergeSettings({}).finance, DEFAULT_FINANCE);
  assert.equal(sanitizeFinancePrefs({ lockMin: 999, currency: 'XXX' }).lockMin, 240);
  assert.equal(sanitizeFinancePrefs({ currency: 'XXX' }).currency, 'BRL');
});

test('datas: soma de meses respeita o fim do mês', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('cartão: em qual fatura cai cada compra', () => {
  const nub = { id: 'c1', closeDay: 3, dueDay: 10 };
  assert.equal(invoiceFor(nub, '2026-11-02'), '2026-11');
  assert.equal(invoiceFor(nub, '2026-11-03'), '2026-12', 'no dia do fechamento vai para a próxima');
  assert.equal(invoiceFor(nub, '2026-12-20'), '2027-01');
  const late = { id: 'c2', closeDay: 25, dueDay: 5 }; // vence no mês seguinte ao fechamento
  assert.equal(invoiceFor(late, '2026-11-10'), '2026-12');
  assert.equal(invoiceFor(late, '2026-11-26'), '2027-01');
  assert.deepEqual(cardDates(late, '2026-12'), { due: '2026-12-05', close: '2026-11-25' });
});

test('parcelas somam o total e caem em faturas seguidas', () => {
  const fin = { ...emptyFinance(), cards: [{ id: 'c1', name: 'Nubank', closeDay: 3, dueDay: 10, account: 'acc-main' }] };
  const list = makeTx(fin, { date: '2026-11-20', amount: 30000, desc: 'Tênis', kind: 'saida', card: 'c1', installments: 3 });
  assert.equal(list.length, 3);
  assert.equal(sum(list, (t) => t.amount), 30000);
  assert.deepEqual(list.map((t) => t.invoice), ['2026-12', '2027-01', '2027-02']);
  assert.deepEqual(list.map((t) => t.inst.n), [1, 2, 3]);
  assert.ok(list.every((t) => t.inst.group === list[0].inst.group));
  const f2 = { ...fin, tx: list };
  assert.equal(removeTx(f2, list[1].id).tx.length, 2);
  assert.equal(removeTx(f2, list[1].id, { all: true }).tx.length, 0);
  const inv = cardInvoices(f2, 'c1', '2026-11-25');
  assert.equal(inv.find((i) => i.invoice === '2026-12').total, 10000);
  assert.equal(inv.find((i) => i.invoice === '2026-12').status, 'aberta');
});

test('saldo, resumo do mês e orçamento', () => {
  const fin = sanitizeFinance({
    accounts: [{ id: 'a', name: 'Banco', initial: 100000 }, { id: 'b', name: 'Poupança', initial: 0 }],
    cards: [{ id: 'c', name: 'Cartão', closeDay: 3, dueDay: 10, account: 'a' }],
    budgets: { mercado: 50000 },
    tx: [
      { date: '2026-11-01', amount: 500000, kind: 'entrada', cat: 'salario', account: 'a' },
      { date: '2026-11-05', amount: 45000, kind: 'saida', cat: 'mercado', account: 'a' },
      { date: '2026-11-06', amount: 20000, kind: 'saida', cat: 'lazer', account: 'a', card: 'c', invoice: '2026-12' },
      { date: '2026-11-07', amount: 5000, kind: 'entrada', cat: 'lazer', account: 'a', card: 'c', invoice: '2026-12' }, // estorno
      { date: '2026-11-08', amount: 100000, kind: 'transferencia', account: 'a', to: 'b' },
      { date: '2026-12-01', amount: 1000, kind: 'saida', cat: 'mercado', account: 'a' },
    ],
  });
  assert.equal(accountBalance(fin, 'a', '2026-11-30'), 100000 + 500000 - 45000 - 100000, 'cartão não mexe no saldo');
  assert.equal(accountBalance(fin, 'b'), 100000);
  const m = monthSummary(fin, '2026-11');
  assert.equal(m.income, 500000);
  assert.equal(m.expense, 45000 + 20000 - 5000, 'estorno abate o gasto; transferência não conta');
  assert.equal(m.byCat.lazer, 15000);
  const [b] = budgetStatus(fin, '2026-11');
  assert.deepEqual([b.cat, b.spent, b.level], ['mercado', 45000, 'warn']);
  assert.equal(monthSeries(fin, '2026-12', 3).length, 3);
  assert.equal(filterTx(fin, { q: 'xyz' }).length, 0);
  assert.equal(filterTx(fin, { cat: 'mercado' }).length, 2);
  assert.equal(filterTx(fin, { account: 'b' }).length, 1);
});

test('contas a pagar: ocorrências, lembrete e pagamento', () => {
  let fin = sanitizeFinance({
    bills: [
      { id: 'luz', name: 'Luz', amount: 18000, day: 10, every: 'month', remind: 3, cat: 'contas', account: 'acc-main' },
      { id: 'ipva', name: 'IPVA', amount: 90000, day: 15, every: 'year', month: 1 },
      { id: 'fx', name: 'Faxina', amount: 15000, day: 1, every: 'week', start: '2026-11-02' },
      { id: 'off', name: 'Velha', amount: 1, day: 1, active: false },
    ],
  });
  const luz = billOccurrences(fin.bills[0], '2026-11-01', '2026-12-31', '2026-11-08');
  assert.deepEqual(luz.map((o) => o.due), ['2026-11-10', '2026-12-10']);
  assert.equal(luz[0].days, 2);
  assert.equal(billOccurrences(fin.bills[1], '2026-11-01', '2027-02-28').length, 1);
  assert.deepEqual(billOccurrences(fin.bills[2], '2026-11-10', '2026-11-24').map((o) => o.due), ['2026-11-16', '2026-11-23']);
  assert.equal(billOccurrences(fin.bills[3], '2026-11-01', '2026-12-31').length, 0);
  const remind = billsToRemind(fin, '2026-11-08');
  assert.ok(remind.some((o) => o.bill === 'luz'));
  const r = payBill(fin, 'luz', '2026-11', { date: '2026-11-09' });
  fin = r.fin;
  assert.equal(r.tx.amount, 18000);
  assert.equal(r.tx.bill, 'luz');
  assert.ok(!upcomingBills(fin, '2026-11-09').some((o) => o.bill === 'luz' && o.key === '2026-11'));
  assert.equal(removeTx(fin, r.tx.id).bills[0].paid['2026-11'], undefined, 'apagar o lançamento desmarca a conta');
  // atrasada
  const late = upcomingBills(sanitizeFinance({ bills: [{ id: 'x', name: 'X', amount: 1, day: 1 }] }), '2026-11-05');
  assert.equal(late[0].status, 'atrasada');
});

test('categorias: embutidas, aprendidas e pagamento de fatura', () => {
  const fin = emptyFinance();
  assert.equal(suggestCategory(fin, 'IFOOD *RESTAURANTE 12/11').cat, 'alimentacao');
  assert.equal(suggestCategory(fin, 'UBER *TRIP').cat, 'transporte');
  assert.equal(suggestCategory(fin, 'Posto Ipiranga').cat, 'transporte');
  assert.equal(suggestCategory(fin, 'COISA ESTRANHA').cat, 'outros');
  assert.equal(suggestCategory(fin, 'COISA ESTRANHA', 'entrada').cat, 'renda');
  assert.equal(normalizeDesc('Compra Cartão PIX *Padaria São João 12/11 123456'), 'padaria sao joao');
  assert.equal(ruleKey('PAG*JoseDaSilva Mercearia'), 'josedasilva mercearia');
  const f2 = learnRule(fin, 'Mercearia do Zé 01/11', 'mercado');
  assert.equal(suggestCategory(f2, 'MERCEARIA DO ZE 15/11').cat, 'mercado');
  assert.equal(suggestCategory(f2, 'MERCEARIA DO ZE').by, 'regra');
  assert.ok(isBillPayment('Pagamento de fatura'));
  assert.ok(isBillPayment('PGTO FAT CARTAO'));
  assert.ok(!isBillPayment('Mercado'));
});

test('duplicidade: FITID, data próxima e pagamento de fatura', () => {
  const old = [
    { id: 'o1', date: '2026-11-05', amount: 4500, kind: 'saida', desc: 'SUPERMERCADO BH', account: 'a', fitid: 'F1' },
    { id: 'o2', date: '2026-11-06', amount: 2000, kind: 'saida', desc: 'Padaria Pão Bom', account: 'a' },
  ];
  const inc = markDuplicates(old, [
    { id: 'n1', date: '2026-11-05', amount: 4500, kind: 'saida', desc: 'outra coisa', account: 'a', fitid: 'F1' },
    { id: 'n2', date: '2026-11-07', amount: 2000, kind: 'saida', desc: 'PADARIA PAO BOM LTDA', account: 'a' },
    { id: 'n3', date: '2026-11-07', amount: 2000, kind: 'saida', desc: 'Farmácia', account: 'a' },
    { id: 'n4', date: '2026-11-15', amount: 2000, kind: 'saida', desc: 'Padaria Pão Bom', account: 'a' },
    { id: 'n5', date: '2026-11-05', amount: 9, kind: 'saida', desc: 'x', account: 'a', fitid: 'F9' },
    { id: 'n6', date: '2026-11-05', amount: 9, kind: 'saida', desc: 'x', account: 'a', fitid: 'F9' },
  ]);
  assert.deepEqual(inc.map((t) => t.dup || ''), ['certo', 'provavel', '', '', '', 'certo']);
  assert.ok(similarity('Padaria Pão Bom', 'PADARIA PAO BOM LTDA') >= 0.5);
  const fin = { ...emptyFinance(), cards: [{ id: 'c', name: 'C', closeDay: 1, dueDay: 8 }] };
  const [p] = fixBillPayments(fin, [{ id: 'p', date: '2026-11-08', amount: 50000, kind: 'saida', desc: 'Pagamento de fatura', account: 'a' }]);
  assert.deepEqual([p.kind, p.to, p.cat], ['transferencia', 'c', 'transferencia']);
});

test('frases de voz e da captura', () => {
  const p = (s) => { const r = parseFinancePhrase(s); return r && [r.kind, r.amount, r.desc, r.installments, r.via]; };
  assert.deepEqual(p('gastei 45 no mercado'), ['saida', 4500, 'Mercado', 1, '']);
  assert.deepEqual(p('Gastei 45,90 com uber no nubank'), ['saida', 4590, 'Uber', 1, 'nubank']);
  assert.deepEqual(p('recebi 1200 de salário'), ['entrada', 120000, 'Salário', 1, '']);
  assert.deepEqual(p('paguei a luz 180'), ['saida', 18000, 'Luz', 1, '']);
  assert.deepEqual(p('comprei um tênis de 300 em 3 vezes no cartão'), ['saida', 30000, 'Tênis', 3, 'cartão']);
  assert.deepEqual(p('gastei R$ 1.200,50 no aluguel'), ['saida', 120050, 'Aluguel', 1, '']);
  assert.deepEqual(p('spent 20 on lunch'), ['saida', 2000, 'Lunch', 1, '']);
  assert.equal(parseFinancePhrase('gastei tempo demais'), null);
  assert.equal(parseFinancePhrase('lembre de comprar pão'), null);
  const fin = { ...emptyFinance(), cards: [{ id: 'nu', name: 'Nubank roxinho' }] };
  assert.deepEqual(matchVia(fin, 'nubank'), { card: 'nu' });
  assert.deepEqual(matchVia(fin, 'cartão'), { card: 'nu' });
  assert.deepEqual(matchVia(fin, 'principal'), { account: 'acc-main' });
  assert.deepEqual(matchVia(fin, 'nada'), {});
});

test('cofre: cifra, abre com a senha certa e recusa a errada', async () => {
  const fin = sanitizeFinance({ tx: [{ date: '2026-11-01', amount: 100, desc: 'segredo', kind: 'saida' }] });
  await assert.rejects(createVault(fin, '123'), /6 caracteres/);
  const { record, key } = await createVault(fin, 'senha-boa', 1000);
  assert.ok(isSealed(record));
  assert.ok(!JSON.stringify(record).includes('segredo'), 'nada legível no que fica guardado');
  assert.ok(key);
  const open = await unlockVault(record, 'senha-boa');
  assert.equal(open.fin.tx[0].desc, 'segredo');
  await assert.rejects(unlockVault(record, 'senha-ruim'), (e) => e.code === 'wrong_key');
  assert.equal(undoImport({ ...fin, tx: [{ ...fin.tx[0], importId: 'i1' }], imports: [{ id: 'i1' }] }, 'i1').tx.length, 0);
});
