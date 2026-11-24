// Finanças (#66): CSV de extratos e faturas (Nubank, Inter, C6, planilhas…).
// Descobre o separador, a linha de títulos e as colunas; o "molde" escolhido
// fica guardado pela assinatura dos títulos para a próxima importação do mesmo banco.
import { parseMoney } from './money.js';

const MONTHS = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

export function detectDelimiter(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',', score = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const ok = counts.filter((c) => c > 1 && c === counts[counts.length > 1 ? 1 : 0]).length;
    const s = ok * 10 + (counts[0] || 0);
    if (counts.some((c) => c > 1) && s > score) { best = d; score = s; }
  }
  return best;
}

function splitLine(line, d) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text, delim) {
  const src = String(text || '').replace(/^﻿/, '');
  const d = delim || detectDelimiter(src);
  // Junta linhas quebradas dentro de aspas.
  const rows = []; let buf = '';
  for (const line of src.split(/\r?\n/)) {
    buf = buf ? buf + '\n' + line : line;
    if ((buf.match(/"/g) || []).length % 2 === 0) { if (buf.trim()) rows.push(splitLine(buf, d)); buf = ''; }
  }
  if (buf.trim()) rows.push(splitLine(buf, d));
  return { delim: d, rows };
}

// Data em vários formatos → 'AAAA-MM-DD'. `year` completa "05/11" e "05 NOV".
export function parseDate(s, { order = 'dmy', year } = {}) {
  const t = String(s || '').trim().toLowerCase();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (m) {
    let [a, b] = [+m[1], +m[2]];
    if (order === 'mdy') [a, b] = [b, a];
    let y = m[3] ? +m[3] : year;
    if (y && y < 100) y += 2000;
    return y ? fmt(y, b, a) : '';
  }
  m = t.match(/^(\d{1,2})\s*(?:de\s+)?([a-zç]{3})[a-zç]*\.?(?:\s*(?:de\s+)?(\d{2,4}))?/);
  if (m && MONTHS[m[2]]) {
    let y = m[3] ? +m[3] : year;
    if (y && y < 100) y += 2000;
    return y ? fmt(y, MONTHS[m[2]], +m[1]) : '';
  }
  return '';
}
function fmt(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const HINTS = {
  date: /^(data|date|dt|fecha|data (do )?lancamento|data da compra|data movimento)\b/,
  desc: /(descri|historico|title|titulo|estabelecimento|lancamento$|memo|detalhe|description|concepto)/,
  amount: /^(valor|amount|montante|importe|quantia|valor \(r\$\)|valor r\$)$/,
  debit: /(debito|saida|debit|cargo)/,
  credit: /(credito|entrada|credit|abono)/,
};

// Assinatura dos títulos (para guardar o molde de cada banco).
export const headerSignature = (header) => header.map(norm).join('|');

// Acha a linha de títulos (a primeira com "data" e algo de valor) e sugere as colunas.
export function guessTemplate(rows) {
  let headerRow = rows.findIndex((r) => r.some((c) => HINTS.date.test(norm(c))) && r.some((c) => HINTS.amount.test(norm(c)) || HINTS.debit.test(norm(c)) || /valor|amount/.test(norm(c))));
  const tpl = { headerRow, date: -1, desc: -1, amount: -1, debit: -1, credit: -1, order: 'dmy', invert: false };
  if (headerRow < 0) {
    headerRow = -1;
    tpl.headerRow = -1;
    // Sem títulos: escolhe pelas cores das colunas na primeira linha com data.
    const sample = rows.find((r) => r.some((c) => parseDate(c, { year: 2000 })));
    if (!sample) return tpl;
    sample.forEach((c, i) => {
      if (tpl.date < 0 && parseDate(c, { year: 2000 })) tpl.date = i;
      else if (tpl.amount < 0 && /\d/.test(c) && parseMoney(c) !== null && !/[a-z]{3,}/i.test(c)) tpl.amount = i;
      else if (tpl.desc < 0 && /[a-z]/i.test(c)) tpl.desc = i;
    });
    return tpl;
  }
  const h = rows[headerRow].map(norm);
  const find = (re, skip = []) => h.findIndex((c, i) => !skip.includes(i) && re.test(c));
  tpl.date = find(HINTS.date);
  tpl.amount = find(HINTS.amount, [tpl.date]);
  if (tpl.amount < 0) tpl.amount = h.findIndex((c, i) => i !== tpl.date && /valor|amount/.test(c) && !/saldo|balance/.test(c));
  if (tpl.amount < 0) { tpl.debit = find(HINTS.debit, [tpl.date]); tpl.credit = find(HINTS.credit, [tpl.date, tpl.debit]); }
  tpl.desc = find(HINTS.desc, [tpl.date, tpl.amount]);
  if (tpl.desc < 0) tpl.desc = h.findIndex((c, i) => ![tpl.date, tpl.amount, tpl.debit, tpl.credit].includes(i) && !/saldo|balance|id|identificador/.test(c));
  // Datas no formato americano (mm/dd) quando algum "dia" passa de 12 na 2ª posição.
  const dates = rows.slice(headerRow + 1).map((r) => r[tpl.date]).filter(Boolean);
  if (dates.some((d) => { const m = String(d).match(/^\d{1,2}[/.-](\d{1,2})[/.-]/); return m && +m[1] > 12; })) tpl.order = 'mdy';
  return tpl;
}

// Aplica o molde: devolve { items, skipped } com itens { date, amount, kind, desc }.
export function applyTemplate(rows, tpl, { year = new Date().getFullYear() } = {}) {
  const items = []; let skipped = 0;
  for (const r of rows.slice(tpl.headerRow + 1)) {
    const date = parseDate(r[tpl.date], { order: tpl.order, year });
    let cents = null;
    if (tpl.amount >= 0) cents = parseMoney(r[tpl.amount]);
    else {
      const d = parseMoney(r[tpl.debit]), c = parseMoney(r[tpl.credit]);
      if (d) cents = -Math.abs(d); else if (c) cents = Math.abs(c);
    }
    if (!date || !cents) { if (r.some((c) => c)) skipped++; continue; }
    if (tpl.invert) cents = -cents;
    const desc = String(r[tpl.desc] ?? '').replace(/\s+/g, ' ').trim();
    if (/^saldo\b|^total\b|saldo (anterior|do dia|final)/i.test(desc)) { skipped++; continue; }
    items.push({ date, amount: Math.abs(cents), kind: cents < 0 ? 'saida' : 'entrada', desc });
  }
  return { items, skipped };
}

// Fatura de cartão em CSV costuma trazer as compras como valores positivos.
// Se a maioria é "entrada" num cartão, sugere inverter os sinais.
export const shouldInvert = (items, isCard) => isCard && items.length > 0 && items.filter((i) => i.kind === 'entrada').length >= items.length / 2;

export function toCsv(list, cats = []) {
  const name = (id) => cats.find((c) => c.id === id)?.name || id || '';
  const esc = (v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [['Data', 'Descrição', 'Valor', 'Tipo', 'Categoria', 'Conta', 'Cartão', 'Parcela'].join(';')];
  for (const t of list) {
    const v = ((t.kind === 'entrada' ? 1 : -1) * t.amount / 100).toFixed(2).replace('.', ',');
    lines.push([t.date, t.desc, v, t.kind, name(t.cat), t.account || '', t.card || '', t.inst ? `${t.inst.n}/${t.inst.of}` : ''].map(esc).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
