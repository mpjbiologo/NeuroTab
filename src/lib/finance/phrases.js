// Finanças (#66): frases de voz e da Captura rápida.
// "gastei 45 no mercado", "recebi 1200 de salário", "paguei a luz 180",
// "comprei um tênis de 300 em 3 vezes no nubank", "spent 20 on lunch", "gasté 30 en comida".
import { parseMoney } from './money.js';

const VERBS = [
  [/^(gastei|paguei|comprei|torrei|pagamos|gastamos|compramos|spent|paid|bought|gast[ée]|pagu[ée]|compr[ée])\b/i, 'saida'],
  [/^(recebi|ganhei|entrou|caiu|recebemos|received|earned|got paid|recib[íi]|gan[ée])\b/i, 'entrada'],
];
const NUM = /(?:r\$\s*)?-?\d[\d.,]*(?:\s*(?:mil|k)\b)?(?:\s*(?:reais|real|conto|contos|pila|dólares|dolares|dollars|bucks|euros|pesos))?/i;
const INST = /\b(?:em|in|en)\s+(\d{1,2})\s*(?:x|vezes|parcelas|installments|cuotas)\b|\b(\d{1,2})\s*x\b/i;
const VIA = /\b(?:no|na|pelo|pela|com o|com a|on|with|en el|con)\s+(?:cart[aã]o\s+(?:do\s+|da\s+)?)?([\wÀ-ú]+)\s*$/i;
const FILLER = /^(?:no|na|nos|nas|com|de|do|da|em|um|uma|o|a|os|as|on|for|at|in|the|a|en|el|la|con|por|pra|para)\s+/i;

// Devolve { kind, amount, desc, installments, via } ou null se não for um lançamento.
export function parseFinancePhrase(text) {
  let s = String(text || '').trim().replace(/[.!?]+$/, '');
  const verb = VERBS.find(([re]) => re.test(s));
  if (!verb) return null;
  s = s.replace(verb[0], '').trim();
  let installments = 1;
  const im = s.match(INST);
  if (im) { installments = Number(im[1] || im[2]); s = s.replace(im[0], ' ').trim(); }
  const nm = s.match(NUM);
  if (!nm) return null;
  const amount = Math.abs(parseMoney(nm[0].replace(/reais|real|contos?|pila|d[óo]lares|dollars|bucks|euros|pesos/gi, '')) || 0);
  if (!amount) return null;
  let rest = (s.slice(0, nm.index) + ' ' + s.slice(nm.index + nm[0].length)).replace(/\s+/g, ' ').trim();
  let via = '';
  const vm = rest.match(VIA);
  // "no nubank"/"no cartão" no fim indica a conta ou o cartão, se houver outra coisa antes.
  if (vm && rest.slice(0, vm.index).trim()) { via = vm[1]; rest = rest.slice(0, vm.index).trim(); }
  for (let i = 0; i < 3; i++) rest = rest.replace(FILLER, '').trim();
  rest = rest.replace(/\s+(?:de|do|da|com|no|na)$/i, '').trim();
  const desc = rest ? rest[0].toUpperCase() + rest.slice(1) : '';
  return { kind: verb[1], amount, desc, installments: Math.min(48, Math.max(1, installments)), via };
}

// Acha a conta ou o cartão citado ("nubank", "cartão", "itau").
export function matchVia(fin, via) {
  if (!via) return {};
  const v = via.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const card = fin.cards.find((c) => norm(c.name).includes(v));
  if (card) return { card: card.id };
  if (/^(cartao|credito|card)$/.test(v) && fin.cards.length === 1) return { card: fin.cards[0].id };
  const acc = fin.accounts.find((a) => norm(a.name).includes(v));
  return acc ? { account: acc.id } : {};
}

// Lançamento rápido do widget: "45 mercado", "45,90 uber no nubank", "+1200 salário",
// "300 tênis 3x" ou uma frase completa ("gastei 45 no mercado").
export function parseQuick(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const full = parseFinancePhrase(s);
  if (full) return full;
  const m = s.match(/^([+-])?\s*(?:r\$\s*)?(\d[\d.,]*)\s*(.*)$/i);
  if (!m) return null;
  const r = parseFinancePhrase(`${m[1] === '+' ? 'recebi' : 'gastei'} ${m[2]} ${m[3]}`);
  return r;
}

// Para a voz: só vira lançamento se for claramente dinheiro. "gastei/paguei" bastam;
// "comprei/recebi/ganhei" precisam de uma pista de valor ("reais", "R$", "45,90").
export function parseMoneyPhrase(text) {
  const p = parseFinancePhrase(text);
  if (!p) return null;
  const s = String(text).toLowerCase();
  const strongVerb = /^\s*(gastei|paguei|gastamos|pagamos|torrei|spent|paid|gast[ée]|pagu[ée])\b/.test(s);
  const cue = /r\$|\breais\b|\breal\b|\bcontos?\b|\bpila\b|d[óo]lar|dollars?|bucks|euros?|pesos|\d+,\d{2}\b|\d+\.\d{2}\b/.test(s);
  return strongVerb || cue ? p : null;
}
