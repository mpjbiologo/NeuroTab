// Finanças (#66): avisos — contas a pagar (notificação) e e-mails de fatura (só pelo assunto).
import { billsToRemind, today } from './model.js';
import { fmtMoney } from './money.js';

const BILL_SUBJECT = /\b(fatura|vencimento|boleto|cobran[cç]a|segunda via|2ª via|conta (de )?(luz|[aá]gua|g[aá]s|internet|telefone)|sua conta (chegou|est[aá] dispon[ií]vel)|invoice|bill (is )?(due|ready)|factura)\b/i;

// E-mails dos últimos `days` dias cujo assunto parece de conta ou fatura. Não lê o conteúdo.
export function billMails(cache, { days = 10, now = Date.now() } = {}) {
  const out = [];
  for (const acc of Object.values(cache?.byAccount || {})) {
    for (const e of acc?.entries || []) if (BILL_SUBJECT.test(e.subject || '') && (!e.at || now - e.at <= days * 864e5)) out.push(e);
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 5);
}

// Texto da notificação das contas a pagar. Discreto = sem valores.
// `sent` = { 'conta|ocorrência': 'AAAA-MM-DD' } (já avisou hoje).
export function billNotice(fin, { now = today(), discreet = false, sent = {}, currency = 'BRL', lang = 'pt-BR' } = {}) {
  const due = billsToRemind(fin, now).filter((o) => sent[o.bill + '|' + o.key] !== now);
  if (!due.length) return null;
  const when = (o) => (o.days < 0 ? `atrasada ${-o.days} d` : o.days === 0 ? 'vence hoje' : o.days === 1 ? 'vence amanhã' : `vence em ${o.days} dias`);
  const parts = due.slice(0, 4).map((o) => `${o.name} ${when(o)}${discreet ? '' : ' · ' + fmtMoney(o.amount, { currency, lang })}`);
  if (due.length > 4) parts.push(`+${due.length - 4}`);
  return {
    title: due.some((o) => o.days < 0) ? '💸 Contas atrasadas' : '💸 Contas a pagar',
    message: parts.join('\n'),
    keys: due.map((o) => o.bill + '|' + o.key),
  };
}
