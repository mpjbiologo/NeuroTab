// ✂️ Recorte de tela (#37): escolher uma área numa página de teste (tamanho e cor conferidos), página inteira
// rolando (barra fixa uma vez só) e página proibida com a dica do Win+Shift+S.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, extWith } from './helpers.js';

const SITE = 'https://recorte.example/';
const HTML = `<!doctype html><title>Recorte</title><body style="margin:0;background:#fff">
  <header style="position:fixed;top:0;left:0;right:0;height:40px;background:rgb(0,0,255)"></header>
  <div style="position:absolute;left:100px;top:100px;width:200px;height:100px;background:rgb(255,0,0)"></div>
  <div style="position:absolute;left:0;top:1500px;width:100%;height:100px;background:rgb(0,160,0)"></div>
  <div style="height:2400px"></div></body>`;
const sw = (x) => x.ctx.serviceWorkers()[0];

/** Tamanho e cores de pontos de uma imagem da biblioteca. */
const inspect = (p, id, points) => p.evaluate(async ([id, points]) => {
  const { getCapture } = await import('./lib/image-index.js');
  const rec = await getCapture(id);
  const bmp = await createImageBitmap(rec.blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, source: rec.source, pageTitle: rec.pageTitle, px: points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3)) };
}, [id, points]);

async function setup() {
  const ext = extWith((m) => { m.host_permissions.push('<all_urls>'); });
  const x = await launch({ ext, viewport: { width: 800, height: 600 } });
  await x.ctx.route(SITE + '**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: HTML }));
  const lib = await x.open('src/newtab.html');
  const page = await x.ctx.newPage();
  await page.goto(SITE);
  await page.bringToFront();
  const tabId = await sw(x).evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, SITE);
  const snip = (full) => sw(x).evaluate(async ([tabId, full]) => {
    const r = await __nt.startSnip(await chrome.tabs.get(tabId), { full });
    return r;
  }, [tabId, full]);
  return { x, lib, page, snip, tabId };
}

test('recortar uma área: arrastar, Enter salva na biblioteca com tamanho e cor certos; Esc cancela', async () => {
  const { x, lib, page, snip } = await setup();
  try {
    let run = snip(false);
    await page.locator('[data-neurotab-snip]').waitFor();
    await page.mouse.move(110, 110);
    await page.mouse.down();
    await page.mouse.move(250, 160, { steps: 5 });
    await page.mouse.move(290, 190, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press('Enter');
    const r = await run;
    assert.equal(r.action, 'save');
    assert.equal(await page.locator('[data-neurotab-snip]').count(), 0, 'a camada saiu da página');
    const img = await inspect(lib, r.id, [[5, 5], [170, 70]]);
    assert.equal(img.w, 180);
    assert.equal(img.h, 80);
    assert.deepEqual(img.px[0], [255, 0, 0]);
    assert.equal(img.source, 'region');
    assert.equal(img.pageTitle, 'Recorte');
    // Esc cancela sem salvar
    run = snip(false);
    await page.locator('[data-neurotab-snip]').waitFor();
    await page.keyboard.press('Escape');
    assert.equal((await run).action, 'cancel');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('página inteira: rola, junta, a barra fixa aparece uma vez só, e abre "Salvar e anotar"', async () => {
  const { x, lib, page, snip } = await setup();
  try {
    await page.evaluate(() => scrollTo(0, 300));
    const win = x.ctx.waitForEvent('page');
    win.catch(() => {});
    const r = await snip(true);
    assert.equal(r.action, 'full');
    assert.equal(r.screens, 4, '2400 px de página ÷ 600 px de tela');
    const img = await inspect(lib, r.id, [[400, 10], [400, 620], [400, 1550], [150, 150]]);
    assert.equal(img.w, 800);
    assert.equal(img.h, 2400, 'altura da página');
    assert.deepEqual(img.px[0], [0, 0, 255], 'barra fixa no topo');
    assert.notDeepEqual(img.px[1], [0, 0, 255], 'barra fixa não se repete');
    assert.deepEqual(img.px[2], [0, 160, 0], 'conteúdo lá embaixo');
    assert.deepEqual(img.px[3], [255, 0, 0]);
    assert.equal(await page.evaluate(() => scrollY), 300, 'volta para onde estava');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('header')).visibility), 'visible');
    const w = await win;
    await w.locator('#comment').waitFor();
    assert.match(await w.textContent('#title'), /Salvar imagem e anotar/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('página proibida: dica do recorte do sistema', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    const err = await sw(x).evaluate(async () => {
      try { await __nt.startSnip({ id: 1, windowId: 1, url: 'chrome://settings/' }, {}); return ''; } catch (e) { return e.message; }
    });
    assert.match(err, /Win\+Shift\+S/);
    void p;
  } finally {
    await x.close();
  }
});
