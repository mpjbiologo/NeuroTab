// Biblioteca de mídias (0.9.3.1, #45): imagens da biblioteca, posts salvos, fotos de um post do TikTok baixadas
// pelo navegador na pasta das imagens, salvar imagem no computador, DRM recusado, busca e abas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { launch, extWith } from './helpers.js';

// PNG 1x1 válido
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function imgServer() {
  const srv = http.createServer((req, res) => {
    if (/^\/f\d\.png$/.test(req.url)) { res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length }); res.end(PNG); return; }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

const tiktokPhotos = (port) => `<!doctype html><html><head><meta charset="utf-8"><title>TikTok</title></head><body>
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: {
  desc: 'Receitas de marmita em fotos', author: { uniqueId: 'marmitas' }, createTime: 1763800000,
  imagePost: { images: [{ imageURL: { urlList: [`http://127.0.0.1:${port}/f1.png`] } }, { imageURL: { urlList: [`http://127.0.0.1:${port}/f2.png`] } }] },
} } } } })}</script></body></html>`;

test('Biblioteca de mídias: abas, busca, fotos do post, salvar imagem e DRM', async () => {
  const { srv, port } = await imgServer();
  const ext = extWith((m) => { m.host_permissions.push('https://*.tiktok.com/*'); m.permissions.push('downloads'); });
  const x = await launch({ ext });
  try {
    await x.ctx.route('https://www.tiktok.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: tiktokPhotos(port) }));
    const p = await x.open('src/newtab.html');
    // post de fotos do TikTok salvo pela aba
    const page = await x.ctx.newPage();
    await page.goto('https://www.tiktok.com/@marmitas/photo/777');
    const tabId = await p.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.tiktok.com/*' }))[0]?.id);
    const saved = await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'media:save', tabId: id }), tabId);
    assert.ok(saved.id, JSON.stringify(saved));
    // um item da Netflix (DRM) e uma imagem na biblioteca
    const now = Date.now();
    const brain = await x.storage(p, 'nt_brain');
    brain.push({ id: 'nf', type: 'media', title: 'Série da Netflix', text: '', url: 'https://www.netflix.com/watch/1', pageTitle: '', tags: [], summary: '', pinned: false, done: false, remindAt: null, notifiedAt: null, source: 'manual', createdAt: now - 5000, updatedAt: now, enriched: true, media: { platform: 'web', status: 'done' } });
    await x.seed(p, { nt_brain: brain }, { reload: false });
    await p.evaluate(async (b64) => {
      const { saveCapture } = await import(chrome.runtime.getURL('src/lib/captures.js'));
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await saveCapture({ blob: new Blob([bytes], { type: 'image/png' }), type: 'image/png', url: 'https://site.com/grafico.png', pageUrl: 'https://site.com/artigo', pageTitle: 'Artigo do gráfico', fileName: 'grafico.png' });
    }, PNG.toString('base64'));
    const drm = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'media:download', id: 'nf' }));
    assert.equal(drm.code, 'drm');

    const lib = await x.open('src/media.html');
    const cards = lib.locator('#grid .card');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3, 'imagem + 2 posts');
    // abas e busca
    await lib.click('#tabs button[data-tab="imagens"]');
    assert.equal(await cards.count(), 1);
    await lib.click('#tabs button[data-tab="posts"]');
    assert.equal(await cards.count(), 2);
    assert.match(await cards.filter({ hasText: 'Netflix' }).textContent(), /DRM/);
    assert.equal(await cards.filter({ hasText: 'Netflix' }).locator('button:has-text("Vídeo")').count(), 0);
    await lib.fill('#q', 'marmita');
    await lib.waitForTimeout(300);
    assert.equal(await cards.count(), 1);
    // fotos do post → 2 arquivos na pasta das imagens (o Playwright renomeia os arquivos; o nome pedido fica gravado aqui)
    const [sw] = x.ctx.serviceWorkers();
    await sw.evaluate(() => { const o = chrome.downloads.download.bind(chrome.downloads); globalThis.__dl = []; chrome.downloads.download = (opts) => { globalThis.__dl.push(opts.filename); return o(opts); }; });
    const post = cards.first();
    await post.locator('button:has-text("Fotos")').click();
    await post.locator('.files:has-text("Fotos (2)")').waitFor({ timeout: 30000 });
    const it = (await x.storage(lib, 'nt_brain')).find((i) => i.id === saved.id);
    assert.equal(it.media.photos.count, 2);
    const names = await sw.evaluate(() => globalThis.__dl);
    assert.equal(names.length, 2);
    assert.ok(names.every((f) => f.startsWith('NeuroTab/Imagens/')), names.join('\n'));
    assert.ok(names.some((f) => / 01\.png$/.test(f)) && names.some((f) => / 02\.png$/.test(f)), names.join('\n'));
    // aba "No computador"
    await lib.fill('#q', '');
    await lib.click('#tabs button[data-tab="arquivos"]');
    await lib.waitForTimeout(300);
    assert.equal(await cards.count(), 1);
    // salvar a imagem da biblioteca no computador e excluir com confirmação
    await lib.click('#tabs button[data-tab="imagens"]');
    await lib.evaluate(() => { const o = chrome.downloads.download.bind(chrome.downloads); globalThis.__dl = []; chrome.downloads.download = (opts) => { globalThis.__dl.push(opts.filename); return o(opts); }; });
    await cards.first().locator('button:has-text("Salvar")').click();
    await lib.waitForFunction(() => globalThis.__dl.length === 1);
    assert.deepEqual(await lib.evaluate(() => globalThis.__dl), ['NeuroTab/Imagens/grafico.png']);
    let asked = '';
    lib.once('dialog', (d) => { asked = d.message(); });
    await cards.first().locator('button[title="Excluir imagem"]').click();
    await lib.locator('#grid .empty').waitFor();
    assert.match(asked, /Excluir esta imagem/);
    if (process.env.NT_SHOTS) { await lib.click('#tabs button[data-tab="tudo"]'); await lib.waitForTimeout(300); await lib.screenshot({ path: 'test-results/media-lib.png' }); }
    await page.close();
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
    srv.close();
  }
});
