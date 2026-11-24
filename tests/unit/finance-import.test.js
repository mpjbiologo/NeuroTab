// Finanças (#66): importação de OFX, CSV e PDF (texto sintético, sem dados reais).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfx, toOfx, ofxDate } from '../../src/lib/finance/import-ofx.js';
import { parseCsv, detectDelimiter, guessTemplate, applyTemplate, parseDate, headerSignature, shouldInvert, toCsv } from '../../src/lib/finance/import-csv.js';
import { parsePdfLines, linesFromItems, detectBank, guessYear } from '../../src/lib/finance/import-pdf.js';

const OFX1 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0260<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261101
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261105120000[-3:BRT]
<TRNAMT>-45.90
<FITID>A1
<MEMO>Compra no débito - Padaria &amp; Cia
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261101
<TRNAMT>5000,00
<FITID>A2
<NAME>SALARIO
</STMTTRN>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20261102<TRNAMT>0.00<FITID>A3<MEMO>zero
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1234.56<DTASOF>20261130</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const OFX2 = `<?xml version="1.0"?><?OFX OFXHEADER="200"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL</CURDEF>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261110</DTPOSTED><TRNAMT>-120.00</TRNAMT><FITID>X9</FITID><MEMO>UBER *TRIP</MEMO></STMTTRN></BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

test('OFX 1.x (SGML) e 2.x (XML)', () => {
  const a = parseOfx(OFX1);
  assert.equal(a.kind, 'banco');
  assert.equal(a.acctId, '12345-6');
  assert.equal(a.balance, 123456);
  assert.equal(a.items.length, 2, 'valor zero é ignorado');
  assert.deepEqual(a.items[0], { date: '2026-11-05', amount: 4590, kind: 'saida', desc: 'Compra no débito - Padaria & Cia', fitid: 'A1', type: 'DEBIT' });
  assert.deepEqual([a.items[1].amount, a.items[1].kind, a.items[1].desc], [500000, 'entrada', 'SALARIO']);
  const b = parseOfx(OFX2);
  assert.equal(b.kind, 'cartao');
  assert.deepEqual([b.items[0].date, b.items[0].amount, b.items[0].fitid], ['2026-11-10', 12000, 'X9']);
  assert.throws(() => parseOfx('data,valor'), /OFX/);
  assert.equal(ofxDate('20261231'), '2026-12-31');
  const round = parseOfx(toOfx([{ id: 't1', date: '2026-11-05', amount: 4590, kind: 'saida', desc: 'A & B' }]));
  assert.deepEqual([round.items[0].amount, round.items[0].kind, round.items[0].desc, round.items[0].fitid], [4590, 'saida', 'A & B', 't1']);
});

test('CSV: Nubank (conta), Nubank (cartão), Inter e débito/crédito separados', () => {
  const nuConta = 'Data,Valor,Identificador,Descrição\n05/11/2026,-45.90,abc,Compra no débito - Padaria\n06/11/2026,1200.00,def,"Transferência recebida, João"\n';
  const p = parseCsv(nuConta);
  assert.equal(p.delim, ',');
  const t = guessTemplate(p.rows);
  assert.deepEqual([t.headerRow, t.date, t.amount, t.desc], [0, 0, 1, 3]);
  const r = applyTemplate(p.rows, t);
  assert.deepEqual(r.items.map((i) => [i.date, i.amount, i.kind]), [['2026-11-05', 4590, 'saida'], ['2026-11-06', 120000, 'entrada']]);
  assert.equal(r.items[1].desc, 'Transferência recebida, João');

  const nuCard = 'date,title,amount\n2026-11-03,Uber *Trip,23.50\n2026-11-04,Estorno,-10.00\n';
  const pc = parseCsv(nuCard);
  const tc = guessTemplate(pc.rows);
  const rc = applyTemplate(pc.rows, tc);
  assert.ok(shouldInvert(rc.items, true));
  const inv = applyTemplate(pc.rows, { ...tc, invert: true });
  assert.deepEqual(inv.items.map((i) => i.kind), ['saida', 'entrada']);

  const inter = 'Extrato Conta Corrente\nConta;123\n\nData Lançamento;Histórico;Descrição;Valor;Saldo\n05/11/2026;Pix enviado;Fulano;-1.234,56;10.000,00\n06/11/2026;Saldo do dia;;0,00;10.000,00\n';
  const pi = parseCsv(inter);
  assert.equal(pi.delim, ';');
  const ti = guessTemplate(pi.rows);
  assert.equal(ti.headerRow, 2, 'linhas vazias não contam');
  assert.equal(ti.amount, 3, 'não confunde com a coluna Saldo');
  const ri = applyTemplate(pi.rows, ti);
  assert.equal(ri.items.length, 1);
  assert.equal(ri.items[0].amount, 123456);

  const dc = 'Data;Descrição;Débito;Crédito\n01/11/2026;Aluguel;1.500,00;\n02/11/2026;Salário;;5.000,00\n';
  const pd = parseCsv(dc);
  const td = guessTemplate(pd.rows);
  assert.deepEqual([td.amount, td.debit, td.credit], [-1, 2, 3]);
  assert.deepEqual(applyTemplate(pd.rows, td).items.map((i) => [i.kind, i.amount]), [['saida', 150000], ['entrada', 500000]]);
  assert.equal(headerSignature(pd.rows[0]), 'data|descricao|debito|credito');
});

test('CSV: separador, aspas, datas e exportação', () => {
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.deepEqual(parseCsv('a;"b ""x""";c').rows[0], ['a', 'b "x"', 'c']);
  assert.deepEqual(parseCsv('a,"linha\nquebrada",c\n1,2,3').rows.length, 2);
  assert.equal(parseDate('05/11/26'), '2026-11-05');
  assert.equal(parseDate('11/25/2026', { order: 'mdy' }), '2026-11-25');
  assert.equal(parseDate('05 NOV', { year: 2026 }), '2026-11-05');
  assert.equal(parseDate('5 de dezembro de 2026'), '2026-12-05');
  assert.equal(parseDate('32/01/2026'), '');
  const us = parseCsv('Date,Description,Amount\n11/25/2026,Lunch,-12.00\n');
  assert.equal(guessTemplate(us.rows).order, 'mdy');
  const out = toCsv([{ date: '2026-11-05', desc: 'A;B', amount: 4590, kind: 'saida', cat: 'mercado', inst: { n: 1, of: 3 } }], [{ id: 'mercado', name: 'Mercado' }]);
  assert.ok(out.includes('2026-11-05;"A;B";-45,90;saida;Mercado;;;1/3'));
});

const FATURA = `Nu Pagamentos S.A.
Fatura de dezembro
Vencimento: 10/01/2027
Total a pagar R$ 1.234,56
Data Descrição Valor
28 DEZ Pagamento recebido -900,00
15 DEZ Uber *Trip 23,50
20 DEZ Amazon Marketplace 2/3 100,00
02 JAN IOF compra internacional 1,20
05 NOV Restaurante Bom Sabor - Parcela 3/3 R$ 50,00
Total da fatura 1.234,56
linha sem nada
03/01 Estorno Loja X 10,00 C`;

test('PDF: leitor genérico de fatura e de extrato', () => {
  const lines = FATURA.split('\n');
  assert.equal(detectBank(FATURA), 'nubank');
  assert.deepEqual(guessYear(FATURA), { year: 2027, dueMonth: 1 });
  const r = parsePdfLines(lines, { isCard: true });
  const by = Object.fromEntries(r.items.map((i) => [i.desc, i]));
  assert.equal(by['Uber *Trip'].date, '2026-12-15', 'dezembro numa fatura de janeiro é do ano anterior');
  assert.equal(by['Uber *Trip'].kind, 'saida');
  assert.equal(by['Pagamento recebido'].kind, 'entrada');
  assert.deepEqual(by['Amazon Marketplace'].inst, { n: 2, of: 3 });
  assert.equal(by['IOF compra internacional'].date, '2027-01-02');
  assert.equal(by['Restaurante Bom Sabor -'].amount, 5000);
  assert.equal(by['Estorno Loja X'].kind, 'entrada', 'C = crédito');
  assert.ok(!r.items.some((i) => /total/i.test(i.desc)));
  const ig = parsePdfLines(lines, { isCard: true, tpl: { order: 'dmy', invert: 'auto', ignore: ['pagamento recebido'] } });
  assert.equal(ig.items.length, r.items.length - 1);
  assert.ok(ig.rejected.some((x) => x.why === 'ignorada'));

  const extrato = 'Banco Inter\n05/11/2026  Pix enviado Fulano  -1.234,56\n06/11/2026 Salário 5.000,00\n07/11/2026 Saldo do dia 10.000,00';
  const e = parsePdfLines(extrato.split('\n'), { isCard: false });
  assert.deepEqual(e.items.map((i) => [i.kind, i.amount]), [['saida', 123456], ['entrada', 500000]]);
  const flip = parsePdfLines(extrato.split('\n'), { tpl: { invert: true } });
  assert.equal(flip.items[0].kind, 'entrada');
});

test('PDF: linhas remontadas pela posição', () => {
  const it = (s, x, y, w = s.length * 5) => ({ str: s, transform: [1, 0, 0, 1, x, y], width: w, height: 10 });
  const lines = linesFromItems([it('23,50', 400, 700), it('15/12', 50, 700.5), it('Uber', 100, 701), it('Título', 50, 750), it(' ', 0, 0)]);
  assert.deepEqual(lines, ['Título', '15/12  Uber  23,50']);
});
