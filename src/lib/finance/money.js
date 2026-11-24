// Finanças (#66): dinheiro sempre em centavos inteiros. Nada de ponto flutuante nos dados.

export const CURRENCIES = ['BRL', 'USD', 'EUR', 'GBP', 'ARS', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'BTC'];
export const HIDDEN = '••••';

const WORDS = { mil: 1000, k: 1000, milhão: 1e6, milhao: 1e6, milhões: 1e6, milhoes: 1e6, mi: 1e6 };

// Converte texto em centavos. Entende "R$ 1.234,56", "-45", "45,9", "1,2 mil",
// "1234.56", "(45,00)" (negativo de extrato), "45 reais", "45-" e "45 D"/"45 C".
// Devolve null quando não há número.
export function parseMoney(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (input == null) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[-−–]/.test(s) || /[-−–]\s*$/.test(s) || /\s[d]$/.test(s)) neg = true;
  s = s.replace(/\s[dc]$/, '');
  const mult = Object.entries(WORDS).find(([w]) => new RegExp(`\\d\\s*${w}\\b`).test(s));
  const m = s.match(/\d[\d.,\s]*/);
  if (!m) return null;
  let n = m[0].replace(/\s/g, '');
  const lastComma = n.lastIndexOf(','), lastDot = n.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // O separador decimal é o último que aparece.
    if (lastComma > lastDot) n = n.replace(/\./g, '').replace(',', '.');
    else n = n.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // No Brasil a vírgula sozinha é decimal; várias vírgulas são milhares (formato americano).
    n = n.split(',').length > 2 ? n.replace(/,/g, '') : n.replace(',', '.');
  } else if (lastDot >= 0) {
    const parts = n.split('.');
    // "1.234" e "1.234.567" são milhares no Brasil; "12.5" e "1234.56" são decimais.
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && !mult)) n = n.replace(/\./g, '');
  }
  n = n.replace(/[.,]$/, '');
  let v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (mult) v *= mult[1];
  const cents = Math.round(v * 100);
  return neg ? -cents : cents;
}

const fmtCache = new Map();
function nf(currency, lang) {
  const k = currency + '|' + lang;
  if (!fmtCache.has(k)) {
    try {
      fmtCache.set(k, currency === 'BTC'
        ? { format: (v) => '₿ ' + v.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 8 }) }
        : new Intl.NumberFormat(lang, { style: 'currency', currency }));
    } catch { fmtCache.set(k, new Intl.NumberFormat(lang, { style: 'currency', currency: 'BRL' })); }
  }
  return fmtCache.get(k);
}

// Formata centavos. { hidden } troca por •••• (modo discreto); { sign } força "+".
export function fmtMoney(cents, { currency = 'BRL', lang = 'pt-BR', hidden = false, sign = false } = {}) {
  if (hidden) return HIDDEN;
  const c = Number.isFinite(cents) ? cents : 0;
  const s = nf(currency, lang).format(c / 100).replace(/ /g, ' ');
  return sign && c > 0 ? '+' + s : s;
}

// Soma segura (centavos inteiros).
export const sum = (list, get = (x) => x) => list.reduce((a, x) => a + (Math.round(get(x)) || 0), 0);

// Divide um total em n parcelas que somam exatamente o total (a diferença vai para a 1ª).
export function splitInstallments(total, n) {
  const k = Math.max(1, Math.floor(n));
  const base = Math.trunc(total / k);
  const out = Array(k).fill(base);
  out[0] += total - base * k;
  return out;
}

// Converte entre moedas com uma taxa "1 unidade de from = rate unidades de to".
export const convert = (cents, rate) => Math.round(cents * (Number(rate) || 0));
