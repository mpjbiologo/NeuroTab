// Fontes e documentos (0.9.3, #9): aba Fontes no Meu cérebro, editor, arquivo local, apagar com confirmação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

// PDF mínimo com título e autor nos metadados.
function makePdf(lines, { title = '', author = '' } = {}) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = 'BT /F1 11 Tf 14 TL 50 780 Td\n' + lines.map((l) => `(${esc(l)}) Tj T*`).join('\n') + '\nET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Title (${esc(title)}) /Author (${esc(author)}) /CreationDate (D:20240517120000) >>`,
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const now = Date.now();
const item = (p) => ({ title: '', text: '', url: '', pageTitle: '', tags: [], summary: '', pinned: false, done: false, remindAt: null, notifiedAt: null, source: 'manual', createdAt: now, updatedAt: now, enriched: false, ...p });

test('aba Fontes: lista, filtros, ligados, nova fonte, arquivo PDF e apagar com confirmação', async () => {
  const x = await launch({ viewport: { width: 1400, height: 950 } });
  try {
    const p = await x.open('src/newtab.html');
    await x.seed(p, {
      nt_brain: [
        item({ id: 'pg', type: 'page', title: 'Artigo sobre fibras', url: 'https://www.revista.com/fibras?utm_source=x', createdAt: now - 1000 }),
        item({ id: 'cl', type: 'clip', text: 'Fibras alimentam a microbiota', url: 'https://revista.com/fibras' }),
        item({ id: 'bk', type: 'source', title: 'Guia alimentar', src: { kind: 'book', author: 'Ministério da Saúde', published: '2014', project: 'Consultório' }, createdAt: now - 5000 }),
        item({ id: 'nt', type: 'note', text: 'Ver https://citado.com/estudo', url: 'https://citado.com/estudo', pageTitle: 'Estudo citado' }),
      ],
    }, { reload: false });
    await x.settings(p, { widgets: [{ id: 'brain', w: 12 }] });
    const w = p.locator('.widget[data-id="brain"]');
    await w.locator('.chip:has-text("Fontes")').click();
    const rows = w.locator('.items > .item');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 2, 'página salva + livro; a nota fica de fora');
    const page = rows.filter({ hasText: 'Artigo sobre fibras' });
    assert.match(await page.textContent(), /🔗 1/, 'um trecho ligado pela URL');
    assert.match(await rows.filter({ hasText: 'Guia alimentar' }).textContent(), /Livro.*Ministério da Saúde.*2014.*Consultório/s);
    // filtros
    await w.locator('select[title="Projeto"]').selectOption('Consultório');
    assert.equal(await rows.count(), 1);
    await w.locator('select[title="Projeto"]').selectOption('');
    await w.locator('select[title="Tipo de fonte"]').selectOption('book');
    assert.equal(await rows.count(), 1);
    await w.locator('select[title="Tipo de fonte"]').selectOption('');
    // busca sem IA pelo autor
    await w.locator('input[type="search"]').fill('ministerio');
    await p.waitForTimeout(200);
    assert.equal(await rows.count(), 1);
    await w.locator('input[type="search"]').fill('');
    // links citados sem fonte → vira fonte
    await w.locator('.src-uncited summary').click();
    await w.locator('.src-uncited .chip:has-text("Fonte")').click();
    const dlg = p.locator('#itemDlg[open]');
    assert.equal(await dlg.locator('input[name="url"]').inputValue(), 'https://citado.com/estudo');
    assert.equal(await dlg.locator('#itemSrc').isVisible(), true);
    await dlg.locator('input[name="srcAuthor"]').fill('Souza');
    await dlg.locator('input[name="srcProject"]').fill('Doutorado');
    await dlg.locator('button[value="ok"]').click();
    await rows.filter({ hasText: 'Estudo citado' }).waitFor();
    let brain = await x.storage(p, 'nt_brain');
    const novo = brain.find((i) => i.url === 'https://citado.com/estudo' && i.type === 'source');
    assert.deepEqual([novo.src.author, novo.src.project], ['Souza', 'Doutorado']);
    // mesmo link de novo: não duplica
    await w.locator('.chip:has-text("Nova fonte")').click();
    await dlg.locator('input[name="url"]').fill('https://www.citado.com/estudo/');
    await dlg.locator('input[name="title"]').fill('Repetida');
    await dlg.locator('button[value="ok"]').click();
    await p.waitForTimeout(400);
    brain = await x.storage(p, 'nt_brain');
    assert.equal(brain.filter((i) => i.type === 'source' && /citado/.test(i.url)).length, 1);
    if (await p.locator('#itemDlg[open]').count()) await dlg.locator('button[value="cancel"]').click();
    // abrir a página: mostra o trecho ligado e mantém os metadados ao salvar
    await page.click();
    await dlg.locator('#itemSrcLinked .chip:has-text("Fibras alimentam")').waitFor();
    await dlg.locator('select[name="srcKind"]').selectOption('paper');
    await dlg.locator('button[value="ok"]').click();
    await p.waitForTimeout(300);
    brain = await x.storage(p, 'nt_brain');
    assert.equal(brain.find((i) => i.id === 'pg').src.kind, 'paper');
    // ligar uma nota a uma fonte
    await w.locator('.chip:has-text("Tudo")').click();
    await w.locator('.items > .item', { hasText: 'Ver https://citado' }).click();
    await dlg.locator('#itemSrcPick select').selectOption('bk');
    await dlg.locator('button[value="ok"]').click();
    await p.waitForTimeout(300);
    assert.equal((await x.storage(p, 'nt_brain')).find((i) => i.id === 'nt').sourceId, 'bk');
    // fonte de um arquivo PDF: título, autor, data e texto do PDF; o arquivo não é copiado
    await w.locator('.chip:has-text("Fontes")').click();
    const chooser = p.waitForEvent('filechooser');
    await w.locator('.chip:has-text("De um arquivo")').click();
    await (await chooser).setFiles({ name: 'microbiota.pdf', mimeType: 'application/pdf', buffer: makePdf(['Microbiota intestinal e dieta', 'Resultados do estudo XYZ'], { title: 'Microbiota e dieta', author: 'Silva, A.' }) });
    await dlg.waitFor();
    assert.equal(await dlg.locator('input[name="title"]').inputValue(), 'Microbiota e dieta');
    assert.equal(await dlg.locator('input[name="srcAuthor"]').inputValue(), 'Silva, A.');
    assert.equal(await dlg.locator('input[name="srcPublished"]').inputValue(), '2024-05-17');
    assert.equal(await dlg.locator('select[name="srcKind"]').inputValue(), 'pdf');
    assert.match(await dlg.locator('textarea[name="text"]').inputValue(), /Resultados do estudo XYZ/);
    assert.match(await dlg.locator('#itemSrcFile').textContent(), /microbiota\.pdf.*1 página/);
    if (process.env.NT_SHOTS) await p.screenshot({ path: 'test-results/source-dlg.png' });
    await dlg.locator('button[value="ok"]').click();
    await rows.filter({ hasText: 'Microbiota e dieta' }).waitFor();
    const pdfIt = (await x.storage(p, 'nt_brain')).find((i) => i.title === 'Microbiota e dieta');
    assert.equal(pdfIt.src.file.name, 'microbiota.pdf');
    assert.ok(!JSON.stringify(pdfIt).includes('%PDF'), 'o arquivo não é copiado');
    await w.locator('input[type="search"]').fill('XYZ');
    await p.waitForTimeout(200);
    assert.equal(await rows.count(), 1, 'o texto do PDF entra na busca');
    await w.locator('input[type="search"]').fill('');
    // apagar: pede confirmação (o helper aceita) e vai para a lixeira
    let asked = '';
    p.once('dialog', (d) => { asked = d.message(); });
    await rows.filter({ hasText: 'Artigo sobre fibras' }).click();
    await dlg.locator('#itemDelete').click();
    await p.waitForTimeout(400);
    assert.match(asked, /Apagar a fonte.*lixeira.*1 trecho/s);
    assert.equal((await x.storage(p, 'nt_brain')).some((i) => i.id === 'pg'), false);
    assert.equal((await x.storage(p, 'nt_trash')).some((i) => i.id === 'pg'), true);
    assert.equal((await x.storage(p, 'nt_brain')).some((i) => i.id === 'cl'), true, 'o trecho ligado continua');
    if (process.env.NT_SHOTS) await p.screenshot({ path: 'test-results/sources.png' });
    assert.deepEqual(x.errors, []);
  } finally { await x.close(); }
});
