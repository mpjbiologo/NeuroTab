// NeuroTab — calculadora segura (sem eval), conversões e calculadoras de saúde.

// ---------- Números no formato brasileiro ----------
export function parseNum(s) {
  s = String(s).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else s = s.replace(',', '.');
  return parseFloat(s);
}

export function fmtNum(n, max = 10) {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : 'erro';
  if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-9 && n !== 0)) return n.toExponential(6).replace('.', ',');
  return n.toLocaleString('pt-BR', { maximumFractionDigits: max });
}

// ---------- Expressões ----------
const FUNCS = {
  raiz: Math.sqrt, sqrt: Math.sqrt, sen: (x) => Math.sin(x), sin: Math.sin, cos: Math.cos, tan: Math.tan, tg: Math.tan,
  log: Math.log10, ln: Math.log, abs: Math.abs, arred: Math.round, round: Math.round, piso: Math.floor, teto: Math.ceil, exp: Math.exp,
};
const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };

function tokenize(src) {
  const s = src.toLowerCase().replace(/×|x(?=\s*[\d(])/g, '*').replace(/÷/g, '/').replace(/\*\*/g, '^').replace(/√/g, 'raiz');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = s.slice(i).match(/^(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?|[.,]\d+)/);
    if (num) { out.push({ t: 'n', v: parseNum(num[0]) }); i += num[0].length; continue; }
    const id = s.slice(i).match(/^[a-zπ]+/);
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^%()'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`Símbolo inválido: ${c}`);
  }
  return out;
}

export function evaluate(src) {
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p];
  const eat = (t) => { if (tk[p]?.t === t) { p++; return true; } return false; };

  // Cada nível devolve { v, pct } — pct marca "número%" para a regra 200 + 10% = 220.
  function expr() {
    let left = term();
    let v = left.pct ? left.v / 100 : left.v;
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tk[p++].t;
      const r = term();
      const rv = r.pct ? v * r.v / 100 : r.v;
      v = op === '+' ? v + rv : v - rv;
    }
    return { v, pct: false };
  }
  function term() {
    let a = power();
    while (peek() && (peek().t === '*' || peek().t === '/' || (peek().t === '(' ) || peek().t === 'n' || peek().t === 'id')) {
      let op = '*';
      if (peek().t === '*' || peek().t === '/') op = tk[p++].t;
      const b = power();
      const av = a.pct ? a.v / 100 : a.v;
      const bv = b.pct ? b.v / 100 : b.v;
      if (op === '/' && bv === 0) throw new Error('Divisão por zero');
      a = { v: op === '*' ? av * bv : av / bv, pct: false };
    }
    return a;
  }
  function power() {
    const base = unary();
    if (eat('^')) {
      const ex = power();
      return { v: Math.pow(base.pct ? base.v / 100 : base.v, ex.pct ? ex.v / 100 : ex.v), pct: false };
    }
    return base;
  }
  function unary() {
    if (eat('-')) { const u = unary(); return { v: -u.v, pct: u.pct }; }
    if (eat('+')) return unary();
    return postfix();
  }
  function postfix() {
    const v = primary();
    if (eat('%')) return { v, pct: true };
    return { v, pct: false };
  }
  function primary() {
    const t = tk[p++];
    if (!t) throw new Error('Expressão incompleta');
    if (t.t === 'n') return t.v;
    if (t.t === '(') {
      const r = expr();
      if (!eat(')')) throw new Error('Falta fechar parênteses');
      return r.v;
    }
    if (t.t === 'id') {
      if (t.v in CONSTS) return CONSTS[t.v];
      if (t.v in FUNCS) {
        const arg = peek()?.t === '(' ? primary() : unary().v;
        return FUNCS[t.v](arg);
      }
      throw new Error(`Não conheço "${t.v}"`);
    }
    throw new Error('Expressão inválida');
  }
  const r = expr();
  if (p < tk.length) throw new Error('Expressão inválida');
  return r.v;
}

export function looksLikeMath(q) {
  const s = q.trim();
  if (/^=/.test(s)) return true;
  return /\d/.test(s) && /^[\d\s.,+\-*/^%()×÷x√π]+$|^[\d\s.,%]+de\s+[\d.,]+$|^(raiz|sqrt)/i.test(s) && /[+\-*/^%×÷√]|raiz|sqrt/i.test(s);
}

// ---------- Unidades ----------
const UNITS = {
  // comprimento (m)
  mm: ['len', 0.001], cm: ['len', 0.01], m: ['len', 1], km: ['len', 1000], pol: ['len', 0.0254], polegada: ['len', 0.0254], polegadas: ['len', 0.0254], in: ['len', 0.0254],
  pe: ['len', 0.3048], pes: ['len', 0.3048], ft: ['len', 0.3048], jarda: ['len', 0.9144], yd: ['len', 0.9144], milha: ['len', 1609.344], milhas: ['len', 1609.344], mi: ['len', 1609.344],
  // massa (kg)
  mg: ['mass', 1e-6], g: ['mass', 0.001], kg: ['mass', 1], t: ['mass', 1000], ton: ['mass', 1000], lb: ['mass', 0.45359237], libra: ['mass', 0.45359237], libras: ['mass', 0.45359237], oz: ['mass', 0.028349523], onca: ['mass', 0.028349523], arroba: ['mass', 15],
  // volume (L)
  ml: ['vol', 0.001], l: ['vol', 1], litro: ['vol', 1], litros: ['vol', 1], xicara: ['vol', 0.24], xicaras: ['vol', 0.24], colher: ['vol', 0.015], 'colher-sopa': ['vol', 0.015], 'colher-cha': ['vol', 0.005], gal: ['vol', 3.785411784], galao: ['vol', 3.785411784], floz: ['vol', 0.0295735], m3: ['vol', 1000],
  // velocidade (m/s)
  'km/h': ['spd', 1 / 3.6], kmh: ['spd', 1 / 3.6], 'm/s': ['spd', 1], mph: ['spd', 0.44704], no: ['spd', 0.514444], nos: ['spd', 0.514444],
  // área (m²)
  m2: ['area', 1], 'm²': ['area', 1], km2: ['area', 1e6], 'km²': ['area', 1e6], ha: ['area', 1e4], hectare: ['area', 1e4], hectares: ['area', 1e4], alqueire: ['area', 48400], acre: ['area', 4046.8564224],
  // dados (byte)
  b: ['data', 1], kb: ['data', 1024], mb: ['data', 1024 ** 2], gb: ['data', 1024 ** 3], tb: ['data', 1024 ** 4],
  // tempo (s)
  s: ['time', 1], seg: ['time', 1], min: ['time', 60], h: ['time', 3600], hora: ['time', 3600], horas: ['time', 3600], dia: ['time', 86400], dias: ['time', 86400], semana: ['time', 604800], semanas: ['time', 604800], ano: ['time', 31557600], anos: ['time', 31557600],
  // energia (kcal)
  kcal: ['energy', 1], cal: ['energy', 0.001], kj: ['energy', 1 / 4.184],
};
const TEMP = { c: 'c', '°c': 'c', celsius: 'c', f: 'f', '°f': 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };
const CUR = { usd: 'USD', dolar: 'USD', dolares: 'USD', '$': 'USD', us$: 'USD', eur: 'EUR', euro: 'EUR', euros: 'EUR', '€': 'EUR', brl: 'BRL', real: 'BRL', reais: 'BRL', 'r$': 'BRL', gbp: 'GBP', libra_est: 'GBP', btc: 'BTC', bitcoin: 'BTC', eth: 'ETH', ars: 'ARS', peso: 'ARS', jpy: 'JPY', iene: 'JPY', cad: 'CAD', cny: 'CNY', yuan: 'CNY' };

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function toC(v, u) { return u === 'c' ? v : u === 'f' ? (v - 32) * 5 / 9 : v - 273.15; }
function fromC(v, u) { return u === 'c' ? v : u === 'f' ? v * 9 / 5 + 32 : v + 273.15; }

async function rateToBRL(code, fetcher) {
  if (code === 'BRL') return 1;
  const r = await fetcher(code);
  if (!r) throw new Error('Cotação indisponível para ' + code);
  return r;
}

export async function defaultRateFetcher(code) {
  const res = await fetch(`https://economia.awesomeapi.com.br/json/last/${code}-BRL`);
  const j = await res.json();
  return +j[code + 'BRL']?.bid || null;
}

/** "10 km em milhas", "100 usd em brl", "37 c em f" → { text, value } ou null */
export async function convert(q, fetcher = defaultRateFetcher) {
  const m = fold(q).match(/^(-?[\d.,]+)\s*([a-z°$€²³/\-]+(?:\s[a-z]+)?)\s+(?:em|para|pra|to|in|->|=)\s+([a-z°$€²³/\-]+)$/);
  if (!m) return null;
  const v = parseNum(m[1]);
  let a = m[2].replace(/\s+/g, '-');
  let b = m[3];
  if (a === 'colher-de' || a === 'colheres') a = 'colher';
  if (TEMP[a] && TEMP[b]) {
    const r = fromC(toC(v, TEMP[a]), TEMP[b]);
    return { value: r, text: `${fmtNum(v)} °${TEMP[a].toUpperCase()} = ${fmtNum(r, 2)} °${TEMP[b].toUpperCase()}` };
  }
  if (CUR[a] && CUR[b]) {
    const ra = await rateToBRL(CUR[a], fetcher);
    const rb = await rateToBRL(CUR[b], fetcher);
    const r = (v * ra) / rb;
    return { value: r, text: `${fmtNum(v)} ${CUR[a]} = ${fmtNum(r, CUR[b] === 'BTC' ? 8 : 2)} ${CUR[b]}` };
  }
  const ua = UNITS[a];
  const ub = UNITS[b];
  if (ua && ub) {
    if (ua[0] !== ub[0]) throw new Error('Unidades incompatíveis');
    const r = (v * ua[1]) / ub[1];
    return { value: r, text: `${fmtNum(v)} ${m[2]} = ${fmtNum(r, 4)} ${b}` };
  }
  return null;
}

// ---------- Datas ----------
export function dateCalc(q, now = new Date()) {
  const t = fold(q);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const parseDate = (s) => {
    const m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (!m) return null;
    let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
    const d = new Date(y, +m[2] - 1, +m[1]);
    if (!m[3] && d < today) d.setFullYear(y + 1);
    return d;
  };
  let m;
  if ((m = t.match(/^dias?\s+(?:ate|para|pra)\s+(.+)$/))) {
    const d = parseDate(m[1]);
    if (!d) return null;
    const n = Math.round((d - today) / 864e5);
    return { value: n, text: `Faltam ${fmtNum(n)} dias para ${d.toLocaleDateString('pt-BR')}` };
  }
  if ((m = t.match(/^dias?\s+(?:desde|de)\s+(.+)$/))) {
    const d = parseDate(m[1]);
    if (!d) return null;
    const n = Math.round((today - d) / 864e5);
    return { value: n, text: `${fmtNum(n)} dias desde ${d.toLocaleDateString('pt-BR')}` };
  }
  if ((m = t.match(/^(?:hoje|daqui a)\s*\+?\s*(\d+)\s*dias?$/))) {
    const d = new Date(today);
    d.setDate(d.getDate() + +m[1]);
    return { value: d.getTime(), text: `${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` };
  }
  return null;
}

/** Tenta tudo: conta, conversão ou data. */
export async function smartCalc(q, fetcher) {
  const s = q.trim().replace(/^=\s*/, '').replace(/^(quanto e|quanto é|calcule|calcular)\s+/i, '').replace(/\?$/, '');
  const d = dateCalc(s);
  if (d) return d;
  const c = await convert(s, fetcher);
  if (c) return c;
  const v = evaluate(s.replace(/([\d.,]+)\s*%\s*de\s+/gi, '($1/100)*'));
  return { value: v, text: fmtNum(v) };
}

// ---------- Saúde ----------
export function imc(pesoKg, alturaM) {
  if (alturaM > 3) alturaM /= 100;
  const v = pesoKg / (alturaM * alturaM);
  const c = v < 18.5 ? 'Abaixo do peso' : v < 25 ? 'Peso adequado' : v < 30 ? 'Sobrepeso' : v < 35 ? 'Obesidade grau I' : v < 40 ? 'Obesidade grau II' : 'Obesidade grau III';
  return { value: v, classe: c };
}

export const ACTIVITY = [
  [1.2, 'Sedentário (pouco ou nenhum exercício)'],
  [1.375, 'Leve (1–3 dias/semana)'],
  [1.55, 'Moderado (3–5 dias/semana)'],
  [1.725, 'Intenso (6–7 dias/semana)'],
  [1.9, 'Muito intenso (2x/dia ou trabalho físico)'],
];

/** Mifflin-St Jeor: TMB em kcal/dia. */
export function tmb({ sexo, peso, alturaCm, idade }) {
  return 10 * peso + 6.25 * alturaCm - 5 * idade + (sexo === 'f' ? -161 : 5);
}

export function agua(pesoKg, mlPorKg = 35) {
  return pesoKg * mlPorKg;
}
