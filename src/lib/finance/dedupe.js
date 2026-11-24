// Finanças (#66): duplicidade na importação.
// 1) mesmo FITID (OFX) na mesma conta/cartão → duplicado certo;
// 2) mesmo valor e tipo, data a até 2 dias e descrição parecida → provável duplicado.
import { normalizeDesc, isBillPayment } from './categorize.js';
import { daysBetween } from './model.js';

const words = (s) => new Set(normalizeDesc(s).split(' ').filter((w) => w.length > 2));

// Semelhança de Jaccard entre as palavras das descrições (0..1).
export function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

const sameTarget = (a, b) => (a.card || '') === (b.card || '') && (a.card ? true : (a.account || '') === (b.account || ''));

// Marca cada item novo com { dup: 'certo' | 'provavel', dupOf } quando já existe.
// Também detecta duplicados dentro do próprio arquivo (mesmo FITID).
export function markDuplicates(existing, incoming) {
  const seenFit = new Map();
  for (const t of existing) if (t.fitid) seenFit.set((t.card || t.account || '') + '|' + t.fitid, t.id);
  return incoming.map((n) => {
    const out = { ...n };
    delete out.dup; delete out.dupOf;
    const fk = n.fitid ? (n.card || n.account || '') + '|' + n.fitid : '';
    if (fk && seenFit.has(fk)) return { ...out, dup: 'certo', dupOf: seenFit.get(fk) };
    const hit = existing.find((t) => t.amount === n.amount && t.kind === n.kind && sameTarget(t, n)
      && Math.abs(daysBetween(t.date, n.date)) <= 2 && (similarity(t.desc, n.desc) >= 0.5 || normalizeDesc(t.desc) === normalizeDesc(n.desc)));
    if (fk) seenFit.set(fk, n.id);
    return hit ? { ...out, dup: 'provavel', dupOf: hit.id } : out;
  });
}

// Pagamento de fatura que aparece no extrato da conta vira transferência para o cartão,
// para não contar o gasto duas vezes (as compras já estão no cartão).
export function fixBillPayments(fin, list) {
  const card = fin.cards.length === 1 ? fin.cards[0].id : '';
  return list.map((t) => (t.kind === 'saida' && !t.card && isBillPayment(t.desc)
    ? { ...t, kind: 'transferencia', cat: 'transferencia', ...(card ? { to: card } : {}) }
    : t));
}
