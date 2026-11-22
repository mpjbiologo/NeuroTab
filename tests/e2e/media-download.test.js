// Baixar o vídeo de um item da Mídia (0.7.11): pelo navegador (TikTok com .mp4 direto) e pela NeuroTab Ponte de
// verdade (compilada do ponte/) com um yt-dlp de mentira, no Instagram (vídeo e áudio separados). YouTube: nunca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, extWith, EXT } from './helpers.js';

const VIDEO = Buffer.alloc(300 * 1024, 7);

function videoServer() {
  const srv = http.createServer((req, res) => {
    if (req.url === '/v.mp4') { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': VIDEO.length }); res.end(VIDEO); return; }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

const tiktok = (port) => `<!doctype html><html><head><meta charset="utf-8"><title>TikTok</title></head><body>
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: {
  desc: 'Pão de queijo em 10 minutos', author: { uniqueId: 'cozinha' }, createTime: 1763800000,
  video: { duration: 30, playAddr: `http://127.0.0.1:${port}/v.mp4`, bitrateInfo: [{ Bitrate: 900, PlayAddr: { Height: 720, UrlList: [`http://127.0.0.1:${port}/v.mp4`] } }] },
} } } } })}</script></body></html>`;

const IG = `<!doctype html><html><head><meta charset="utf-8">
<meta property="og:title" content="Ana on Instagram: &quot;Treino de 5 minutos&quot;"></head><body><article><video src="blob:https://www.instagram.com/x"></video></article></body></html>`;

async function brainFirst(x, p) {
  const data = await x.storage(p, 'nt_data');
  data.settings.widgets = [{ id: 'brain' }, ...data.settings.widgets.filter((w) => w.id !== 'brain')];
  await x.seed(p, { nt_data: data });
}

async function openItem(p, text) {
  const brain = p.locator('.widget', { has: p.locator('.items') }).first();
  await brain.locator('button:has-text("Mídia")').click();
  await brain.locator('.item', { hasText: text }).click();
  const panel = p.locator('#itemMedia');
  await panel.waitFor();
  return panel;
}

test('Baixar vídeo pelo navegador (TikTok) e YouTube bloqueado', async () => {
  const { srv, port } = await videoServer();
  const ext = extWith((m) => { m.host_permissions.push('https://*.tiktok.com/*', 'https://www.youtube.com/*'); m.permissions.push('downloads'); });
  const x = await launch({ ext });
  try {
    await x.ctx.route('https://www.tiktok.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: tiktok(port) }));
    await x.ctx.route('https://www.youtube.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Vídeo - YouTube</title>' }));
    const p = await x.open('src/newtab.html');
    const page = await x.ctx.newPage();
    await page.goto('https://www.tiktok.com/@cozinha/video/123');
    const tabId = await p.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.tiktok.com/*' }))[0]?.id);
    const saved = await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'media:save', tabId: id }), tabId);
    assert.ok(saved.id, JSON.stringify(saved));
    // YouTube: recusado antes de qualquer coisa
    const yt = await x.ctx.newPage();
    await yt.goto('https://www.youtube.com/watch?v=abc');
    const ytTab = await p.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.youtube.com/*' }))[0]?.id);
    const ytSaved = await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'media:save', tabId: id }), ytTab);
    const ytRes = await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'media:download', id }), ytSaved.id);
    assert.equal(ytRes.code, 'youtube');
    await yt.close();

    await brainFirst(x, p);
    const panel = await openItem(p, 'Pão de queijo');
    await panel.locator('button:has-text("Baixar vídeo")').click();
    await panel.locator('text=Vídeo baixado').waitFor({ timeout: 30000 });
    const it = (await x.storage(p, 'nt_brain')).find((i) => i.id === saved.id);
    assert.equal(it.media.download.via, 'browser');
    assert.ok(Number.isInteger(it.media.download.downloadId));
    const [d] = await p.evaluate((id) => chrome.downloads.search({ id }), it.media.download.downloadId);
    assert.equal(d.state, 'complete');
    assert.equal(d.bytesReceived, VIDEO.length);
    assert.ok(await panel.locator('button:has-text("Mostrar na pasta")').count());
    await page.close();

    // item do YouTube: explica e não oferece o botão
    await p.keyboard.press('Escape');
    const ytPanel = await openItem(p, 'YouTube');
    assert.match(await ytPanel.textContent(), /YouTube não permite baixar/);
    assert.equal(await ytPanel.locator('button:has-text("Baixar vídeo")').count(), 0);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
    srv.close();
  }
});

test('Baixar vídeo pela NeuroTab Ponte (Instagram, yt-dlp) com o login do site', async (t) => {
  let ponte;
  try {
    ponte = join(mkdtempSync(join(tmpdir(), 'ponte-')), 'neurotab-ponte');
    execFileSync('go', ['build', '-o', ponte, '.'], { cwd: join(EXT, 'ponte'), stdio: 'pipe' });
  } catch {
    return t.skip('sem Go para compilar a Ponte');
  }
  if (process.platform === 'win32') return t.skip('yt-dlp de mentira em shell');
  const bin = mkdtempSync(join(tmpdir(), 'ytdlp-'));
  writeFileSync(join(bin, 'yt-dlp'), `#!/bin/sh
out=""; prev=""; url=""; cookies=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then out="$a"; fi
  if [ "$prev" = "--cookies" ]; then cookies="$a"; fi
  prev="$a"; url="$a"
done
if [ "$1" = "--version" ]; then echo 2026.11.01; exit 0; fi
f=$(echo "$out" | sed 's/%(ext)s/mp4/')
echo "NTP  40.0%|  2.00MiB|NA"
echo "NTP 100.0%|  2.00MiB|NA"
printf '%s' "$url" > "$f"
if [ -n "$cookies" ]; then cp "$cookies" "$f.cookies"; fi
echo "NTF $f"
`, { mode: 0o755 });
  const dl = mkdtempSync(join(tmpdir(), 'downloads-'));
  const env = { PATH: `${bin}:${process.env.PATH}`, NEUROTAB_DOWNLOAD_DIR: dl, XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'cache-')) };
  const ext = extWith((m) => { m.permissions.push('nativeMessaging', 'downloads', 'cookies'); m.host_permissions.push('https://*.instagram.com/*'); });
  const x = await launch({ ext, env });
  try {
    mkdirSync(join(x.dir, 'NativeMessagingHosts'), { recursive: true });
    writeFileSync(join(x.dir, 'NativeMessagingHosts', 'com.neurotab.ponte.json'), JSON.stringify({ name: 'com.neurotab.ponte', description: 'teste', path: ponte, type: 'stdio', allowed_origins: [`chrome-extension://${x.id}/`] }));
    await x.ctx.addCookies([{ name: 'sessionid', value: 'segredo123', domain: '.instagram.com', path: '/', secure: true, httpOnly: true, expires: Math.floor(Date.now() / 1000) + 3600 }]);
    await x.ctx.route('https://www.instagram.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: IG }));
    const p = await x.open('src/newtab.html');
    const page = await x.ctx.newPage();
    await page.goto('https://www.instagram.com/reel/ABC123/');
    const tabId = await p.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.instagram.com/*' }))[0]?.id);
    const saved = await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'media:save', tabId: id }), tabId);
    await brainFirst(x, p);
    const panel = await openItem(p, 'Treino de 5 minutos');
    await panel.locator('button:has-text("Baixar vídeo")').click();
    await panel.locator('text=Vídeo baixado').waitFor({ timeout: 30000 });
    assert.match(await panel.textContent(), /Ponte/);
    const it = (await x.storage(p, 'nt_brain')).find((i) => i.id === saved.id);
    assert.equal(it.media.download.via, 'ponte');
    assert.ok(it.media.download.file.startsWith(join(dl, 'NeuroTab')), it.media.download.file);
    assert.ok(existsSync(it.media.download.file));
    assert.equal(readFileSync(it.media.download.file, 'utf8'), 'https://www.instagram.com/reel/ABC123/');
    assert.match(readFileSync(it.media.download.file + '.cookies', 'utf8'), /#HttpOnly_\.instagram\.com\tTRUE\t\/\tTRUE\t\d+\tsessionid\tsegredo123/);
    assert.deepEqual(readdirSync(join(dl, 'NeuroTab')).filter((f) => f.endsWith('.mp4')).length, 1);
    await page.close();

    // Configurações → Mídia: a Ponte acha o yt-dlp
    const o = await x.open('src/options.html#salvar-midia');
    await o.locator('#dlTools').getByText('2026.11.01').waitFor({ timeout: 15000 });
    assert.match(await o.locator('#dlTools').textContent(), new RegExp(dl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
