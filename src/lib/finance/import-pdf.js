// Finanças (#66): faturas e extratos em PDF.
// 1) o texto sai do PDF com o pdf.js (carregado só aqui, na hora de importar);
// 2) as linhas são remontadas pela posição na página;
// 3) o leitor genérico acha "data … descrição … valor" em cada linha;
// 4) a pessoa "ensina" o leitor na prévia (molde): ordem da data, inverter sinais,
//    linhas a ignorar. O molde fica guardado pelo banco reconhecido no texto.
// A senha do PDF (comum: CPF) é pedida na hora e nunca guardada.
import { parseMoney } from './money.js';
import { parseDate } from './import-csv.js';

const VENDOR = 'src/vendor/pdfjs/';
const url = (p) => (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(p) : '/' + p);

export const BANKS = [
  ['nubank', /nu\s?pagamentos|nubank/i], ['itau', /ita[uú]\s?unibanco|banco ita[uú]|itaucard/i], ['bradesco', /bradesco/i],
  ['bb', /banco do brasil|ourocard/i], ['caixa', /caixa econ[oô]mica|caixa\b/i], ['santander', /santander/i],
  ['inter', /banco inter\b|inter\.co/i], ['c6', /c6\s?bank|banco c6/i], ['picpay', /picpay/i], ['mercadopago', /mercado\s?pago/i],
  ['next', /\bnext\b/i], ['sicoob', /sicoob/i], ['sicredi', /sicredi/i], ['btg', /btg/i], ['xp', /banco xp|xp investimentos/i],
];

export function detectBank(text) {
  const head = String(text).slice(0, 4000);
  return BANKS.find(([, re]) => re.test(head))?.[0] || '';
}

// Ano de referência da fatura: o do vencimento, senão o maior ano que aparece.
export function guessYear(text, fallback = new Date().getFullYear()) {
  const due = String(text).match(/venc\w*[^\d]{0,30}(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i);
  if (due) return { year: +due[3] < 100 ? 2000 + +due[3] : +due[3], dueMonth: +due[2] };
  const years = [...String(text).matchAll(/\b(20\d{2})\b/g)].map((m) => +m[1]).filter((y) => y <= fallback + 1);
  return { year: years.length ? Math.max(...years) : fallback, dueMonth: 0 };
}

const DATE_START = /^(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{1,2}\s+(?:de\s+)?(?:jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[a-zç]*\.?(?:\s+\d{4})?)\s+/i;
const AMOUNT_END = /\s(-\s?|\+\s?)?(?:R\$|US\$|\$)?\s?(-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2})(\s?-|\s?[DC])?\s*$/i;
const INST = /\b(?:parc(?:ela)?\.?\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i;
const NOISE = /^(total|subtotal|saldo|pagamento m[ií]nimo|limite|encargos|juros do rotativo|valor (total|m[ií]nimo)|fatura anterior|cr[eé]ditos? e|resumo|lan[cç]amentos? (nacionais|internacionais)|data\s+descri)/i;

export const DEFAULT_PDF_TPL = { order: 'dmy', invert: 'auto', ignore: [], dateAt: 'start' };

// Linhas de texto → { items, rejected } usando o molde.
// isCard: em faturas, compras costumam vir positivas e créditos negativos.
export function parsePdfLines(lines, { tpl = DEFAULT_PDF_TPL, isCard = false, text = '' } = {}) {
  const { year, dueMonth } = guessYear(text || lines.join('\n'));
  const ignore = (tpl.ignore || []).map((s) => s.toLowerCase()).filter(Boolean);
  const items = [], rejected = [];
  for (const raw of lines) {
    const line = String(raw).replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (ignore.some((s) => lower.includes(s))) { rejected.push({ line, why: 'ignorada' }); continue; }
    let rest = line, dateStr = '';
    const dm = rest.match(DATE_START);
    if (dm) { dateStr = dm[1]; rest = rest.slice(dm[0].length); }
    else if (tpl.dateAt === 'end') {
      const em = rest.match(/\s(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\s*$/);
      if (em) { dateStr = em[1]; rest = rest.slice(0, em.index); }
    }
    const am = rest.match(AMOUNT_END);
    if (!dateStr || !am) { if (dateStr || am) rejected.push({ line, why: 'incompleta' }); continue; }
    let desc = rest.slice(0, am.index).replace(/\s+/g, ' ').trim();
    if (!desc || NOISE.test(desc)) { rejected.push({ line, why: 'resumo' }); continue; }
    let cents = parseMoney(am[2]);
    if (!cents) continue;
    const mark = (am[3] || '').trim().toUpperCase(); // "C" crédito / "D" débito valem mais que o sinal
    if ((am[1] && am[1].trim() === '-') || mark === '-') cents = -Math.abs(cents);
    // Datas sem ano: numa fatura que vence em janeiro, compras de dezembro são do ano anterior.
    let date = parseDate(dateStr, { order: tpl.order, year });
    if (date && !/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}/.test(dateStr) && dueMonth && +date.slice(5, 7) > dueMonth + 1) date = (year - 1) + date.slice(4);
    if (!date) { rejected.push({ line, why: 'data' }); continue; }
    let inst = null;
    const im = desc.match(INST);
    if (im && +im[2] > 1 && +im[1] <= +im[2] && +im[2] <= 48) { inst = { n: +im[1], of: +im[2] }; desc = desc.replace(im[0], ' ').replace(/\s+/g, ' ').trim(); }
    items.push({ date, amount: Math.abs(cents), sign: cents < 0 ? -1 : 1, mark, desc, inst, line });
  }
  // Em fatura, positivo = compra. Em extrato, positivo = entrada. "auto" decide assim.
  const invert = tpl.invert === 'auto' ? isCard : !!tpl.invert;
  return {
    items: items.map((i) => ({ date: i.date, amount: i.amount, kind: i.mark === 'C' ? 'entrada' : i.mark === 'D' ? 'saida' : (i.sign > 0) !== invert ? 'entrada' : 'saida', desc: i.desc, ...(i.inst ? { inst: i.inst } : {}), line: i.line })),
    rejected, year,
  };
}

// Remonta as linhas a partir dos pedaços de texto do pdf.js (x, y e largura).
export function linesFromItems(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4], y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, (it.height || 8) * 0.4));
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, w: it.width || 0, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.parts.sort((a, b) => a.x - b.x);
    let out = '', end = null;
    for (const p of r.parts) {
      if (end !== null) out += p.x - end > 1.5 ? '  ' : '';
      out += p.s;
      end = p.x + p.w;
    }
    return out.replace(/\s{2,}/g, '  ').trim();
  });
}

let pdfjs = null;
async function lib() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = url(VENDOR + 'pdf.worker.min.mjs');
  return pdfjs;
}

export class PdfPasswordError extends Error { constructor(wrong) { super(wrong ? 'Senha do PDF incorreta.' : 'Este PDF tem senha.'); this.code = wrong ? 'wrong_password' : 'password'; } }

// Lê o texto do PDF: { pages, lines, text, scanned }. scanned = quase sem texto (precisa de OCR).
export async function extractPdf(buffer, { password = '' } = {}) {
  const { getDocument } = await lib();
  let doc;
  try {
    doc = await getDocument({ data: new Uint8Array(buffer), password: password || undefined, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new PdfPasswordError(e.code === 2);
    throw new Error('Não consegui abrir o PDF: ' + (e?.message || e));
  }
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    lines.push(...linesFromItems(tc.items));
  }
  const text = lines.join('\n');
  const scanned = text.replace(/\s/g, '').length < 40 * doc.numPages;
  return { doc, pages: doc.numPages, lines, text, scanned };
}

// PDF escaneado: desenha cada página e lê o texto com o OCR local (tesseract, já no pacote).
export async function ocrPdf(doc, { onProgress, maxPages = 10 } = {}) {
  const { readText } = await import('../vision.js');
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const canvas = new OffscreenCanvas(vp.width, vp.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const text = await readText(blob, { onProgress: (m) => onProgress?.({ page: p, pages: doc.numPages, ...m }) });
    lines.push(...String(text).split(/\r?\n/));
  }
  return lines;
}
