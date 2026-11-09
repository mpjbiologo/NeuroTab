// Biblioteca de imagens (#16): colar na Captura rápida, baixar por https, erros e exclusão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, png } from './helpers.js';

const IMG = png(8, 8);

async function setup() {
  const x = await launch();
  await x.ctx.route('https://img.example.com/**', (r) => {
    const u = r.request().url();
    if (u.endsWith('/404.png')) return r.fulfill({ status: 404, body: 'não existe' });
    if (u.endsWith('/pagina.html')) return r.fulfill({ body: '<html></html>', contentType: 'text/html', headers: { 'access-control-allow-origin': '*' } });
    return r.fulfill({ body: IMG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } });
  });
  const p = await x.open('src/newtab.html');
  await x.settings(p, { widgets: [{ id: 'capture', w: 6 }, { id: 'image-library', w: 6 }] });
  return { x, p };
}

const paste = (p, withText) => p.evaluate(([b64, withText]) => {
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' }));
  if (withText) dt.setData('text/plain', 'texto junto');
  const ta = document.querySelector('.widget[data-id=capture] textarea');
  ta.focus();
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  ta.dispatchEvent(ev);
  return ev.defaultPrevented;
}, [IMG.toString('base64'), withText]);

test('colar imagem (Ctrl+V): prévia, salvar, anti-duplicação, texto junto', async () => {
  const { x, p } = await setup();
  try {
    assert.equal(await paste(p, false), true, 'só imagem: não cola nada no texto');
    assert.ok(await p.isVisible('.paste-preview'));
    await paste(p, false); // evento repetido
    assert.equal(await p.$$eval('.paste-preview img', (e) => e.length), 1);
    await p.click('.paste-preview .btn.primary');
    await p.waitForTimeout(700);
    assert.ok(await p.isHidden('.paste-preview'));
    assert.equal(await p.$$eval('.nt-image-card', (e) => e.length), 1);
    await p.waitForTimeout(1600);
    assert.equal(await paste(p, true), false, 'com texto: o texto é colado normalmente');
    await p.click('.paste-preview .chip'); // cancelar
    assert.ok(await p.isHidden('.paste-preview'));
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('baixar por https, erros (http, 404, não-imagem) e excluir', async () => {
  const { x, p } = await setup();
  try {
    const g = await x.open(`src/grant.html?src=${encodeURIComponent('http://img.example.com/x.png')}`, { wait: 400 });
    assert.match(await g.textContent('#msg'), /inválido/);
    assert.ok(await g.isDisabled('#go'));

    const results = await g.evaluate(async () => {
      const { downloadAndSave } = await import('./lib/captures.js');
      const run = async (u) => { try { const r = await downloadAndSave(u, { source: 'context' }); return `ok ${r.fileName} ${r.type}`; } catch (e) { return 'erro ' + e.message; } };
      return [await run('https://img.example.com/foto%20linda.png'), await run('https://img.example.com/404.png'), await run('https://img.example.com/pagina.html')];
    });
    assert.equal(results[0], 'ok foto linda.png image/png');
    assert.match(results[1], /erro .*404/);
    assert.match(results[2], /não é uma imagem/);

    await p.bringToFront();
    await p.waitForTimeout(800);
    assert.equal(await p.$$eval('.nt-image-card', (e) => e.length), 1, 'aba aberta atualiza sozinha');
    await p.click('.nt-image-card .chip.danger');
    await p.waitForTimeout(600);
    assert.equal(await p.$$eval('.nt-image-card', (e) => e.length), 0);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
