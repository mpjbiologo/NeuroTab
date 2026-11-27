// Mídias nos seus aparelhos (0.9.3.2, #80), de ponta a ponta:
//  1. rede local DE VERDADE (Ponte compilada do ponte/): o celular vê as mídias recentes, abre a imagem,
//     o vídeo toca em pedaços (Range) e uma foto do celular chega em Downloads/NeuroTab/Do celular e na biblioteca;
//  2. a página do celular do site (/cola/), modo ntfy: abre um anexo cifrado e manda uma foto (cifrada).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { launch, extWith, EXT } from './helpers.js';

const S = await import('../../src/lib/clipboard-share.js');
const B = await import('../../src/lib/bytes-crypto.js');

// PNG 1×1 de verdade
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('rede local de verdade: o celular vê e baixa as mídias, e manda uma foto para o computador', async (t) => {
  let ponte;
  try {
    ponte = join(mkdtempSync(join(tmpdir(), 'ponte-')), 'neurotab-ponte');
    execFileSync('go', ['build', '-o', ponte, '.'], { cwd: join(EXT, 'ponte'), stdio: 'pipe' });
  } catch {
    return t.skip('sem Go para compilar a Ponte');
  }
  const dl = mkdtempSync(join(tmpdir(), 'nt-downloads-'));
  mkdirSync(join(dl, 'NeuroTab', 'Videos'), { recursive: true });
  const video = join(dl, 'NeuroTab', 'Videos', 'Receita de bolo.mp4');
  const vbytes = Buffer.alloc(300_000, 7);
  writeFileSync(video, vbytes);
  const ext = extWith((m) => { m.permissions.push('nativeMessaging'); });
  const x = await launch({ ext, env: { NEUROTAB_DOWNLOAD_DIR: dl } });
  try {
    mkdirSync(join(x.dir, 'NativeMessagingHosts'), { recursive: true });
    writeFileSync(join(x.dir, 'NativeMessagingHosts', 'com.neurotab.ponte.json'), JSON.stringify({ name: 'com.neurotab.ponte', description: 'teste', path: ponte, type: 'stdio', allowed_origins: [`chrome-extension://${x.id}/`] }));
    const p = await x.open('src/media.html');
    // um vídeo baixado e uma imagem na biblioteca
    await x.seed(p, { nt_brain: [{ id: 'v1', type: 'media', createdAt: Date.now() - 1000, url: 'https://x.com/a/status/1', title: 'Receita de bolo', summary: 'Bolo de cenoura em 3 passos.', media: { platform: 'x', status: 'processado', download: { file: video, size: vbytes.length, via: 'ponte' } } }] }, { reload: false });
    await p.evaluate(async (b64) => {
      const { saveCapture } = await import('/src/lib/captures.js');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await saveCapture({ blob: new Blob([bytes], { type: 'image/png' }), fileName: 'Mapa da clínica', pageUrl: 'https://site.test/mapa' });
    }, PNG.toString('base64'));
    const port = 47900 + Math.floor(Math.random() * 300);
    const token = S.newToken();
    await x.seed(p, { nt_clipboard_cfg: { retention: 'session', protect: true, max: 200, maxImages: 30, paused: false, ignore: [], share: { enabled: true, what: 'manual', name: 'Notebook', images: 'small', direction: 'both', lan: { on: true, port, token, mirror: true } } } }, { reload: false });
    let st;
    for (let i = 0; i < 50 && (st = (await x.storage(p, 'nt_clipshare_state'))?.lan)?.status !== 'on'; i++) await p.waitForTimeout(200);
    assert.equal(st?.status, 'on', 'a Ponte ligou: ' + JSON.stringify(st));
    const base = `http://127.0.0.1:${st.port}`;

    const phone = await x.ctx.newPage();
    await phone.goto(`${base}/#t=${encodeURIComponent(token)}`);
    await phone.click('#tabM');
    await phone.locator('.card:has-text("Receita de bolo")').waitFor({ timeout: 10000 });
    await phone.locator('.card:has-text("Mapa da clínica")').waitFor({ timeout: 10000 });
    assert.match(await phone.locator('.card:has-text("Receita de bolo")').textContent(), /Bolo de cenoura/, 'resumo junto');
    // a imagem carrega de verdade
    await phone.waitForFunction(() => [...document.querySelectorAll('.card img')].some((i) => i.complete && i.naturalWidth === 1), null, { timeout: 8000 });
    // o vídeo: só o pedaço pedido (o celular toca sem baixar tudo)
    const vsrc = await phone.locator('.card:has-text("Receita de bolo") video').getAttribute('src');
    const part = await x.ctx.request.get(base + vsrc, { headers: { Range: 'bytes=0-99' } });
    assert.equal(part.status(), 206);
    assert.equal((await part.body()).length, 100);
    assert.equal(part.headers()['content-type'], 'video/mp4');
    // sem token: recusado; id inventado: não existe
    assert.equal((await x.ctx.request.get(base + vsrc.replace(/\?t=.*/, ''))).status(), 401);
    assert.equal((await x.ctx.request.get(`${base}/api/file/../../etc/passwd?t=${token}`)).status(), 404);

    // celular → computador: uma foto
    await phone.click('#tabM');
    await phone.setInputFiles('#fileM', { name: 'foto do prato.png', mimeType: 'image/png', buffer: PNG });
    const inDir = join(dl, 'NeuroTab', 'Do celular');
    for (let i = 0; i < 50 && !(existsSync(inDir) && readdirSync(inDir).includes('foto do prato.png')); i++) await p.waitForTimeout(200);
    assert.deepEqual(readFileSync(join(inDir, 'foto do prato.png')), PNG, 'arquivo inteiro na pasta');
    let inbox;
    for (let i = 0; i < 50 && !(inbox = await x.storage(p, 'nt_media_inbox'))?.[0]?.imported; i++) await p.waitForTimeout(200);
    assert.equal(inbox?.[0]?.name, 'foto do prato.png');
    assert.ok(inbox[0].imported, 'a foto também entrou na biblioteca: ' + JSON.stringify(inbox));
    // mandar de novo com o mesmo nome não sobrescreve
    await phone.setInputFiles('#fileM', { name: 'foto do prato.png', mimeType: 'image/png', buffer: PNG });
    for (let i = 0; i < 50 && readdirSync(inDir).length < 2; i++) await p.waitForTimeout(200);
    assert.deepEqual(readdirSync(inDir).sort(), ['foto do prato (1).png', 'foto do prato.png']);

    // a Biblioteca mostra a aba 📥 Do celular
    await p.reload();
    await p.click('#tabs button[data-tab="celular"]');
    await p.locator('.card:has-text("foto do prato.png")').first().waitFor();
    assert.match(await p.locator('.card:has-text("foto do prato.png")').first().textContent(), /Do celular/);
    // e a foto aparece em Imagens
    await p.click('#tabs button[data-tab="imagens"]');
    await p.locator('.card:has-text("foto do prato")').first().waitFor();
    // 📤 numa entrada antiga: pela rede local já vale
    await p.click('#tabs button[data-tab="posts"]');
    await p.locator('.card:has-text("Receita de bolo") button[title^="Mandar para o celular"]').click();
    await p.locator('.toast:has-text("rede local")').waitFor();
    assert.deepEqual(x.errors.filter((e) => !e.includes('127.0.0.1')), []);
  } finally {
    await x.close();
  }
});

// ---------- página do celular (site) ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
test('página do celular · ntfy: abre um anexo cifrado do computador e manda uma foto (cifrada)', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'pt-BR' });
  try {
    await ctx.route('https://mpjbiologo.github.io/NeuroTab/**', (r) => {
      let path = new URL(r.request().url()).pathname.replace('/NeuroTab/', '');
      if (!path || path.endsWith('/')) path += 'index.html';
      const file = join(EXT, 'docs', path);
      if (!existsSync(file)) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, contentType: TYPES[extname(file)] || 'application/octet-stream', body: readFileSync(file) });
    });
    const key = S.newShareKey();
    const k = S.keyB64(key);
    const files = new Map([['f1', Buffer.from(await B.sealBytes(new Uint8Array(PNG), k))]]);
    const cors = { 'access-control-allow-origin': '*' };
    const msgs = [
      { id: 'f1', time: 1, event: 'message', tags: ['nt-file'], message: 'anexo-bruto' },
      { id: 'm1', time: Math.floor(Date.now() / 1000), event: 'message', message: await S.sealNtfy({ v: 1, id: 'a', at: Date.now(), from: { id: 'pc', name: 'Notebook' }, kind: 'media', text: '📎 Mapa', media: { title: 'Mapa da clínica', summary: 'Como chegar', url: 'https://site.test/mapa' }, files: [{ id: '0', name: 'mapa.png', mime: 'image/png', size: PNG.length, ntfy: 'https://ntfy.test/file/f1.bin', enc: true }] }, key) },
    ];
    const puts = [];
    const posts = [];
    await ctx.route('https://ntfy.test/**', async (r) => {
      const req = r.request();
      const m = req.url().match(/\/file\/(\w+)\.bin$/);
      if (m) return r.fulfill({ status: 200, body: files.get(m[1]), headers: cors });
      if (req.method() === 'PUT') { puts.push(req.postDataBuffer()); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'f2', attachment: { url: 'https://ntfy.test/file/f2.bin' } }), headers: cors }); }
      if (req.method() === 'POST') { posts.push(req.postData()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"m2"}', headers: cors }); }
      if (req.url().endsWith('/sse')) return r.fulfill({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n', headers: cors });
      return r.fulfill({ status: 200, contentType: 'application/x-ndjson', body: msgs.map((x) => JSON.stringify(x)).join('\n'), headers: cors });
    });
    const page = await ctx.newPage();
    await page.goto(S.ntfyPairLink({ name: 'Notebook', ntfy: { server: 'https://ntfy.test', topic: 'nt-teste', key } }));
    const card = page.locator('.item:has-text("Mapa da clínica")');
    await card.waitFor();
    assert.equal(await page.locator('.item:has-text("anexo-bruto")').count(), 0, 'o evento do anexo não vira item');
    await card.locator('button:has-text("Abrir arquivo")').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.item img')].some((i) => i.complete && i.naturalWidth === 1));
    // celular → computador
    await page.setInputFiles('input[accept="image/*,video/*,audio/*"]', { name: 'prato.png', mimeType: 'image/png', buffer: PNG });
    for (let i = 0; i < 30 && !posts.length; i++) await page.waitForTimeout(100);
    assert.equal(puts.length, 1);
    assert.ok(B.isSealed(new Uint8Array(puts[0])), 'a foto vai cifrada');
    assert.deepEqual(Buffer.from(await B.openBytes(new Uint8Array(puts[0]), k)), PNG);
    const env = await S.openNtfy(posts[0], key);
    assert.equal(env.kind, 'media');
    assert.equal(env.files[0].ntfy, 'https://ntfy.test/file/f2.bin');
    assert.equal(env.files[0].name, 'prato.png');
  } finally {
    await browser.close();
  }
});
