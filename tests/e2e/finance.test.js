// Finanças (#66): widget com lançamento rápido, página (lançar, parcelas no cartão, regra aprendida,
// conta a pagar, orçamento, discreto), importação OFX/CSV/PDF com duplicados e desfazer,
// cofre (cifrado, bloquear, senha errada/certa), voz, Captura rápida e lembrete das contas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const fin = (x, p) => x.storage(p, 'nt_finance');
async function until(p, fn, arg, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await p.waitForTimeout(120)) {
    const v = await p.evaluate(fn, arg);
    if (v) return v;
  }
  throw new Error('tempo esgotado esperando: ' + fn.toString().slice(0, 80));
}
const txCount = (p) => p.evaluate(async () => ((await chrome.storage.local.get('nt_finance')).nt_finance?.tx || []).length);

// PDF mínimo (texto em Helvetica), sem bibliotecas: uma linha por item.
function makePdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = 'BT /F1 11 Tf 14 TL 50 780 Td\n' + lines.map((l) => `(${esc(l)}) Tj T*`).join('\n') + '\nET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><ACCTID>999</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>-45.90<FITID>F1<MEMO>IFOOD *RESTAURANTE
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261101<TRNAMT>5000.00<FITID>F2<MEMO>SALARIO EMPRESA
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261110<TRNAMT>-800.00<FITID>F3<MEMO>PAGAMENTO DE FATURA
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('finanças: widget, página, contas a pagar, orçamento e modo discreto', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { widgets: [{ id: 'finance', w: 6 }, { id: 'capture', w: 6 }] });
    const w = p.locator('.widget[data-id=finance]');
    await w.locator('.fin-kpis').waitFor();
    // lançamento rápido
    await w.locator('.fin-quick').fill('45 mercado');
    assert.match(await w.locator('.fin-hint').textContent(), /Saída · R\$ 45,00 · 🛒 Mercado/);
    await w.locator('.fin-quick').press('Enter');
    await until(p, async () => ((await chrome.storage.local.get('nt_finance')).nt_finance?.tx || []).length === 1);
    let f = await fin(x, p);
    assert.deepEqual([f.tx[0].amount, f.tx[0].kind, f.tx[0].cat, f.tx[0].desc], [4500, 'saida', 'mercado', 'Mercado']);
    await w.locator('.fin-kpi b.neg', { hasText: 'R$ 45,00' }).first().waitFor();
    await w.locator('.fin-quick').fill('+1200 salário');
    await w.locator('.fin-quick').press('Enter');
    await until(p, async () => ((await chrome.storage.local.get('nt_finance')).nt_finance?.tx || []).length === 2);

    // Captura rápida oferece lançar nas finanças
    await p.fill('.widget[data-id=capture] textarea', 'paguei 180 reais de luz');
    await p.locator('.widget[data-id=capture] .fin-offer').click();
    await until(p, async () => ((await chrome.storage.local.get('nt_finance')).nt_finance?.tx || []).some((t) => t.source === 'captura' && t.amount === 18000 && t.cat === 'contas'));
    assert.equal(await p.inputValue('.widget[data-id=capture] textarea'), '');

    // página
    const g = await x.open('src/finance.html');
    await g.locator('.kpi b.pos', { hasText: '1.200,00' }).first().waitFor();
    assert.equal(await g.isVisible('#vaultHint'), false, 'já tinha dados: não é "primeiro uso"');
    // cartão
    await g.click('[data-tab=contas]');
    await g.click('#addCard');
    await g.fill('#cName', 'Nubank');
    await g.fill('#cClose', '3');
    await g.fill('#cDue', '10');
    await g.click('#cSave');
    await g.locator('[data-card]').waitFor();
    // compra parcelada no cartão
    await g.click('#addTx');
    await g.fill('#fAmount', '300');
    await g.fill('#fDesc', 'Tênis');
    const cardOpt = await g.evaluate(() => [...document.querySelectorAll('#fTarget option')].find((o) => o.value.startsWith('c:')).value);
    await g.selectOption('#fTarget', cardOpt);
    await g.fill('#fInst', '3');
    await g.click('#fSave');
    await until(g, async () => ((await chrome.storage.local.get('nt_finance')).nt_finance.tx.filter((t) => t.inst?.of === 3)).length === 3);
    f = await fin(x, g);
    const inst = f.tx.filter((t) => t.inst).sort((a, b) => a.inst.n - b.inst.n);
    assert.deepEqual(inst.map((t) => t.amount), [10000, 10000, 10000]);
    assert.ok(inst.every((t) => t.card) && new Set(inst.map((t) => t.invoice)).size === 3, 'cada parcela numa fatura');
    // corrigir a categoria cria uma regra
    await g.click('[data-tab=lancamentos]');
    const row = g.locator('#txTable tr', { hasText: 'Tênis' }).first();
    await row.locator('select').selectOption('lazer');
    await until(g, async () => (await chrome.storage.local.get('nt_finance')).nt_finance.rules.some((r) => r.match === 'tenis' && r.cat === 'lazer'));
    // conta a pagar
    await g.click('[data-tab=pagar]');
    await g.click('#addBill');
    await g.fill('#bName', 'Internet');
    await g.fill('#bAmount', '99,90');
    await g.fill('#bDay', String(new Date().getDate()));
    await g.click('#bSave');
    const due = g.locator('.item[data-bill]', { hasText: 'Internet' }).filter({ hasText: 'vence hoje' });
    await due.waitFor();
    assert.equal(await g.locator('.item[data-bill]', { hasText: 'atrasada' }).count(), 0, 'conta nova não aparece atrasada nos meses anteriores');
    // lembrete (notificação) — pelo service worker
    const sw = x.ctx.serviceWorkers()[0];
    const n = await sw.evaluate(() => globalThis.__nt.runFinBills({ force: true }));
    assert.equal(n.title, '💸 Contas a pagar');
    assert.match(n.message, /Internet vence hoje · R\$ 99,90/);
    assert.equal(await sw.evaluate(() => globalThis.__nt.runFinBills({ force: true })), null, 'uma vez por dia');
    await due.getByRole('button', { name: /Paga/ }).click();
    await g.click('#payGo');
    await due.waitFor({ state: 'detached' });
    f = await fin(x, g);
    assert.ok(f.tx.some((t) => t.bill && t.amount === 9990));
    // orçamento
    await g.click('[data-tab=orcamento]');
    await g.fill('[data-budget=mercado]', '50');
    await g.press('[data-budget=mercado]', 'Tab');
    await until(g, async () => (await chrome.storage.local.get('nt_finance')).nt_finance.budgets.mercado === 5000);
    await g.locator('.bar.warn').first().waitFor();
    // modo discreto
    await g.click('#eye');
    await g.click('[data-tab=resumo]');
    await g.locator('.kpi b', { hasText: '••••' }).first().waitFor();
    assert.equal((await x.storage(g, 'nt_data')).settings.finance.discreet, true);
    await g.click('#eye');
    await g.locator('.kpi b', { hasText: 'R$' }).first().waitFor();
    // o widget também esconde
    await p.reload();
    await p.locator('.widget[data-id=finance] .fin-kpi b', { hasText: '••••' }).first().waitFor();
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('finanças: importar OFX, CSV e PDF com prévia, duplicados e desfazer', async () => {
  const x = await launch();
  try {
    const g = await x.open('src/finance.html');
    await g.click('[data-tab=importar]');
    // OFX
    await g.setInputFiles('#impFile', { name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX) });
    await g.locator('#impTable').waitFor();
    assert.match(await g.textContent('#impSummary'), /3 encontrado\(s\) · 3 para importar/);
    assert.match(await g.locator('#impTable').textContent(), /transferência/, 'pagamento de fatura vira transferência');
    await g.click('#impGo');
    await until(g, async () => ((await chrome.storage.local.get('nt_finance')).nt_finance?.tx || []).length === 3);
    let f = await fin(x, g);
    assert.equal(f.tx.find((t) => t.fitid === 'F1').cat, 'alimentacao');
    assert.equal(f.tx.find((t) => t.fitid === 'F2').cat, 'salario');
    assert.equal(f.tx.find((t) => t.fitid === 'F3').kind, 'transferencia');
    assert.equal(f.imports.length, 1);
    // de novo: tudo duplicado e desmarcado
    await g.setInputFiles('#impFile', { name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX) });
    await g.locator('#impTable').waitFor();
    assert.match(await g.textContent('#impSummary'), /0 para importar · 3 parece/);
    assert.equal(await g.isDisabled('#impGo'), true);
    await g.getByRole('button', { name: 'Cancelar' }).click();

    // CSV do cartão (Nubank): compras positivas → inverte sozinho
    await g.click('[data-tab=contas]');
    await g.click('#addCard');
    await g.fill('#cName', 'Nubank');
    await g.click('#cSave');
    await g.click('[data-tab=importar]');
    await g.setInputFiles('#impFile', { name: 'nubank-2026-11.csv', mimeType: 'text/csv', buffer: Buffer.from('date,title,amount\n2026-11-03,Uber *Trip,23.50\n2026-11-04,Netflix,55.90\n2026-11-05,Estorno Loja,-10.00\n') });
    await g.locator('#impTable').waitFor();
    assert.ok(await g.isChecked('#impInvert'));
    assert.match(await g.inputValue('#impTarget'), /^c:/, 'arquivo do cartão vai para o cartão');
    await g.click('#impGo');
    await until(g, async () => ((await chrome.storage.local.get('nt_finance')).nt_finance.tx || []).length === 6);
    f = await fin(x, g);
    const uber = f.tx.find((t) => t.desc === 'Uber *Trip');
    assert.deepEqual([uber.kind, uber.cat, !!uber.card, uber.invoice], ['saida', 'transporte', true, '2026-12']);
    assert.equal(f.tx.find((t) => t.desc === 'Estorno Loja').kind, 'entrada');
    assert.ok(Object.keys(f.templates.csv).includes('date|title|amount'), 'molde guardado');

    // PDF de fatura
    const pdf = makePdf(['Nu Pagamentos S.A.', 'Fatura de dezembro', 'Vencimento: 10/12/2026', '15 NOV Padaria Pao Bom 23,50', '20 NOV Amazon Marketplace 2/3 100,00', '28 NOV Pagamento recebido -900,00', 'Total da fatura 123,50']);
    await g.setInputFiles('#impFile', { name: 'fatura.pdf', mimeType: 'application/pdf', buffer: pdf });
    await g.locator('#impTable').waitFor({ timeout: 20000 });
    const txt = await g.locator('#impTable').textContent();
    assert.match(txt, /Padaria Pao Bom/);
    assert.match(txt, /Amazon Marketplace/);
    assert.match(await g.textContent('#impSummary'), /3 encontrado\(s\) · 2 para importar/, 'pagamento recebido fica desmarcado');
    await g.fill('#impIgnore', 'pagamento recebido');
    await g.press('#impIgnore', 'Tab');
    await g.locator('#impSummary', { hasText: '2 encontrado(s) · 2 para importar' }).waitFor();
    await g.click('#impGo');
    await until(g, async () => ((await chrome.storage.local.get('nt_finance')).nt_finance.tx || []).length === 8);
    f = await fin(x, g);
    assert.deepEqual(f.tx.find((t) => /Amazon/.test(t.desc)).inst, { n: 2, of: 3, group: f.tx.find((t) => /Amazon/.test(t.desc)).inst.group });
    assert.deepEqual(f.templates.pdf.nubank.ignore, ['pagamento recebido']);
    // desfazer a importação do PDF
    await g.locator('[data-import]').first().waitFor();
    const pdfImport = f.imports.find((i) => i.format === 'pdf').id;
    await g.locator(`[data-import="${pdfImport}"] button`).click();
    await until(g, async () => ((await chrome.storage.local.get('nt_finance')).nt_finance.tx || []).length === 6);
    // exportar CSV
    await g.click('[data-tab=lancamentos]');
    await g.check('text=Todos os meses');
    const [dl] = await Promise.all([g.waitForEvent('download'), g.click('#expCsv')]);
    assert.match(dl.suggestedFilename(), /^financas-tudo\.csv$/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('finanças: cofre com senha, bloqueio e voz', async () => {
  const x = await launch({ voice: true });
  try {
    const g = await x.open('src/finance.html');
    // primeiro uso: sugere o cofre
    await g.locator('#vaultHint').waitFor();
    await g.getByRole('button', { name: 'Criar senha' }).click();
    const [a, b] = await g.locator('#dlg input[type=password]').all();
    await a.fill('minha-senha');
    await b.fill('minha-senha');
    await g.click('#vaultGo');
    await g.locator('#lockBtn').waitFor();
    await g.click('#addTx');
    await g.fill('#fAmount', '12,34');
    await g.fill('#fDesc', 'segredo farmácia');
    await g.click('#fSave');
    await until(g, async () => !!(await chrome.storage.local.get('nt_finance')).nt_finance?.sealed);
    const raw = JSON.stringify(await fin(x, g));
    assert.ok(!raw.includes('segredo'), 'nada legível guardado');
    // voz lança com o cofre aberto
    const p = await x.open('src/newtab.html');
    await p.click('#voiceFab');
    await p.waitForTimeout(150);
    await p.evaluate(() => { window.__lastSR.say('gastei 45 no mercado'); window.__lastSR.stop(); });
    await p.locator('#voiceReply', { hasText: 'Gasto de R$ 45,00 lançado em Mercado.' }).waitFor();
    await p.evaluate(() => { window.__lastSR?.stop?.(); });
    // bloquear
    await g.bringToFront();
    await g.click('#lockBtn');
    await g.locator('#unlockPass').waitFor();
    await g.fill('#unlockPass', 'errada');
    await g.click('#unlockGo');
    await g.locator('.lock', { hasText: 'Senha incorreta.' }).waitFor();
    await g.fill('#unlockPass', 'minha-senha');
    await g.click('#unlockGo');
    await g.locator('.kpi').first().waitFor();
    await g.click('[data-tab=lancamentos]');
    await g.locator('#txTable', { hasText: 'Mercado' }).waitFor();
    assert.match(await g.textContent('#txTable'), /segredo farmácia/);
    // bloqueado: a voz avisa e não lança
    await g.click('#lockBtn');
    await p.bringToFront();
    await p.click('#voiceFab');
    await p.waitForTimeout(150);
    await p.evaluate(() => { window.__lastSR.say('gastei 10 reais no uber'); window.__lastSR.stop(); });
    await p.locator('#voiceReply', { hasText: 'bloqueadas' }).waitFor();
    // backup próprio sai selado
    await g.bringToFront();
    await g.fill('#unlockPass', 'minha-senha');
    await g.click('#unlockGo');
    await g.click('[data-tab=dados]');
    const [dl] = await Promise.all([g.waitForEvent('download'), g.click('#finBackup')]);
    const json = JSON.parse(await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'));
    assert.equal(json.format, 'neurotab-finance');
    assert.equal(json.sealed, true);
    // apagar tudo
    await g.click('#finWipe');
    await until(g, async () => !(await chrome.storage.local.get('nt_finance')).nt_finance);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
