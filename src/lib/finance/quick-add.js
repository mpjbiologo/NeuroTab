// Finanças (#66): lançar a partir de uma frase (voz e Captura rápida) e responder "quanto gastei".
import { loadFinance, saveFinance } from './store.js';
import { makeTx, today, monthOf, monthSummary, upcomingBills } from './model.js';
import { suggestCategory } from './categorize.js';
import { matchVia } from './phrases.js';
import { fmtMoney } from './money.js';

// p = resultado de parseFinancePhrase/parseQuick. Devolve { ok, reply, ids } (reply em português).
export async function addFromPhrase(p, { source = 'voz', currency = 'BRL' } = {}) {
  const st = await loadFinance();
  if (st.state !== 'open') return { ok: false, reply: 'As finanças estão bloqueadas. Abra o cofre com a senha para eu lançar.' };
  const fin = st.fin;
  const cat = suggestCategory(fin, p.desc, p.kind).cat;
  const via = matchVia(fin, p.via);
  const list = makeTx(fin, {
    date: today(), amount: p.amount, desc: p.desc, cat, kind: p.kind,
    account: via.account || fin.accounts.find((a) => !a.archived)?.id, card: via.card, installments: p.installments, source,
  });
  if (!list.length) return { ok: false, reply: 'Não entendi o valor.' };
  await saveFinance({ ...fin, tx: [...fin.tx, ...list] });
  const c = fin.categories.find((x) => x.id === cat);
  const val = fmtMoney(p.amount, { currency });
  const parc = p.installments > 1 ? ` em ${p.installments} vezes` : '';
  return {
    ok: true, ids: list.map((t) => t.id),
    reply: `${p.kind === 'entrada' ? 'Entrada' : 'Gasto'} de ${val}${parc} ${p.kind === 'entrada' ? 'lançada' : 'lançado'}${c ? ` em ${c.name}` : ''}.`,
  };
}

export async function undoAdd(ids) {
  const st = await loadFinance();
  if (st.state !== 'open') return false;
  await saveFinance({ ...st.fin, tx: st.fin.tx.filter((t) => !ids.includes(t.id)) });
  return true;
}

// "Quanto gastei este mês?" — resposta curta, sem valores no modo discreto.
export async function financeText({ currency = 'BRL', discreet = false } = {}) {
  const st = await loadFinance();
  if (st.state !== 'open') return 'As finanças estão bloqueadas.';
  if (!st.fin.tx.length) return 'Ainda não há lançamentos nas finanças.';
  if (discreet) return 'O modo discreto está ligado: abra as Finanças para ver os valores.';
  const s = monthSummary(st.fin, monthOf(today()));
  const f = (c) => fmtMoney(c, { currency });
  const top = Object.entries(s.byCat).sort((a, b) => b[1] - a[1])[0];
  const topName = top && st.fin.categories.find((c) => c.id === top[0])?.name;
  const bills = upcomingBills(st.fin).filter((o) => o.days <= 7);
  return [
    `Este mês: ${f(s.expense)} de saídas e ${f(s.income)} de entradas, saldo de ${f(s.balance)}.`,
    top && top[1] > 0 ? `O maior gasto é ${topName}, com ${f(top[1])}.` : '',
    bills.length ? `Contas nos próximos 7 dias: ${bills.map((o) => o.name).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}
