// Pegar imagem de dentro da página, num Chromium de verdade: login (cookie), blob:, outro site sem CORS.
import '../unit/setup.js'; // só para poder importar o módulo no Node; o teste roda no navegador
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pageGrab, cropRect } from '../../src/lib/page-image.js';
import { png } from './helpers.js';

import http from 'node:http';

const PAGE = (cdn) => `<!doctype html><body style="margin:0">
  <img id="priv" src="/private.png" width="40" height="40">
  <img id="cdn" src="${cdn}/photo.png" width="60" height="30" style="margin-top:900px">
  <img id="blob" width="20" height="20">
  <script>
    const c = document.createElement('canvas'); c.width = 20; c.height = 20;
    c.getContext('2d').fillRect(0, 0, 20, 20);
    c.toBlob((b) => { document.getElementById('blob').src = URL.createObjectURL(b); });
  </script></body>`;

/** Servidor local de verdade (o roteamento do Playwright ignora CORS, então não serve para este teste). */
const serve = (handler) => new Promise((resolve) => {
  const srv = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(srv));
});

test('pageGrab: login, blob: e imagem de outro site (recorte)', async () => {
  const image = png(40, 40);
  // "Outro site" (outra origem: localhost ≠ 127.0.0.1), sem cabeçalho CORS.
  const cdnSrv = await serve((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png(60, 30)); });
  const cdn = `http://localhost:${cdnSrv.address().port}`;
  // Site principal: a imagem só sai com o login (cookie), como no ChatGPT.
  const siteSrv = await serve((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE(cdn)); }
    if (req.url === '/private.png') {
      if ((req.headers.cookie || '').includes('session=ok')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(image); }
      res.writeHead(403); return res.end('forbidden');
    }
    res.writeHead(404); res.end();
  });
  const site = `http://127.0.0.1:${siteSrv.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await ctx.addCookies([{ name: 'session', value: 'ok', url: site }]);
  try {
  const page = await ctx.newPage();
  await page.goto(site + '/');
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth), null, { timeout: 8000 })
    .catch(async (e) => { throw new Error('imagens não carregaram: ' + JSON.stringify(await page.$$eval('img', (l) => l.map((i) => [i.id, i.complete, i.naturalWidth])))); });
  const grab = (src) => page.evaluate(`(${pageGrab.toString()})(${JSON.stringify(src)}, ${12 * 1024 * 1024})`);

  const priv = await grab(site + '/private.png');
  assert.equal(priv.via, 'fetch');
  assert.match(priv.dataUrl, /^data:image\/png;base64,/);
  assert.equal(Buffer.from(priv.dataUrl.split(',')[1], 'base64').length, image.length);

  const blobSrc = await page.$eval('#blob', (i) => i.src);
  const blob = await grab(blobSrc);
  assert.ok(['fetch', 'canvas'].includes(blob.via), blob.via);
  assert.match(blob.dataUrl, /^data:image\//);

  const far = await grab(cdn + '/photo.png');
  assert.ok(far.rect, 'deveria devolver a posição para recortar: ' + JSON.stringify({ ...far, dataUrl: far.dataUrl?.slice(0, 40) }));
  assert.deepEqual(far.viewport, { width: 800, height: 600 });
  assert.ok(far.rect.y >= 0 && far.rect.y + far.rect.height <= 600, 'a imagem foi trazida para a tela');
  assert.deepEqual(cropRect(far.rect, far.viewport, { width: 800, height: 600 }), {
    x: Math.round(far.rect.x), y: Math.round(far.rect.y), width: 60, height: 30,
  });

  const none = await grab(site + '/nao-existe.png');
  assert.ok(none.notFound);
  } finally {
    await browser.close();
    siteSrv.close();
    cdnSrv.close();
  }
});

// Caminho completo dentro da extensão: background → página → (recorte da tela) → biblioteca (IndexedDB).
// O clique no menu dá "activeTab"; aqui uma cópia da extensão com acesso a todos os sites faz esse papel.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXT } from './helpers.js';

test('extensão: salva imagem com login e imagem de outro site (recorte da tela) na biblioteca', async () => {
  const ext = mkdtempSync(join(tmpdir(), 'neurotab-ext-'));
  for (const d of ['manifest.json', 'src', 'icons', '_locales']) cpSync(join(EXT, d), join(ext, d), { recursive: true });
  const man = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
  man.host_permissions = [...man.host_permissions, '<all_urls>'];
  writeFileSync(join(ext, 'manifest.json'), JSON.stringify(man));

  const image = png(40, 40);
  const cdnSrv = await serve((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png(60, 30)); });
  const cdn = `http://localhost:${cdnSrv.address().port}`;
  const siteSrv = await serve((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE(cdn)); }
    if (req.url === '/private.png' && (req.headers.cookie || '').includes('session=ok')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(image); }
    res.writeHead(403); res.end();
  });
  const site = `http://127.0.0.1:${siteSrv.address().port}`;
  const profile = mkdtempSync(join(tmpdir(), 'neurotab-prof-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium', viewport: { width: 800, height: 600 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    await ctx.addCookies([{ name: 'session', value: 'ok', url: site }]);
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = sw.url().split('/')[2];
    const page = await ctx.newPage();
    await page.goto(site + '/');
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
    const extPage = await ctx.newPage();
    await extPage.goto(`chrome-extension://${id}/src/grant.html`);
    await page.bringToFront(); // a captura de tela é da aba visível

    const send = (src) => extPage.evaluate(async ([s, pageUrl]) => {
      const [tab] = await chrome.tabs.query({ url: pageUrl + '*' });
      return chrome.runtime.sendMessage({ type: 'grabImage', src: s, meta: { pageUrl }, tabId: tab.id, frameId: 0, windowId: tab.windowId });
    }, [src, site + '/']);
    assert.deepEqual(await send(site + '/private.png'), { ok: true });
    assert.deepEqual(await send(cdn + '/photo.png'), { ok: true });

    const saved = await extPage.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('neurotab'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all = await new Promise((res) => { const r = db.transaction('captures').objectStore('captures').getAll(); r.onsuccess = () => res(r.result); });
      return Promise.all(all.map(async (c) => {
        const bmp = await createImageBitmap(c.blob);
        return { url: c.url, source: c.source, type: c.type, size: c.size, w: bmp.width, h: bmp.height };
      }));
    });
    const priv = saved.find((c) => c.url.endsWith('/private.png'));
    const far = saved.find((c) => c.url.endsWith('/photo.png'));
    assert.deepEqual({ type: priv.type, size: priv.size, w: priv.w }, { type: 'image/png', size: image.length, w: 40 });
    assert.equal(far.source, 'screenshot');
    assert.ok(Math.abs(far.w - 60) <= 2 && Math.abs(far.h - 30) <= 2, `recorte com o tamanho da imagem na tela: ${far.w}x${far.h}`);
  } finally {
    await ctx.close();
    siteSrv.close();
    cdnSrv.close();
    rmSync(ext, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
  }
});
