// Compartilhar a área de transferência (0.7.7.2), de ponta a ponta:
//  1. a tela 📤 e o QR de um item;
//  2. a rede local DE VERDADE: extensão ↔ NeuroTab Ponte (compilada do ponte/) ↔ página do celular;
//  3. a página do celular do site (/cola/) nos modos ntfy e nuvem, com os servidores simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { launch, extWith, EXT } from './helpers.js';

const S = await import('../../src/lib/clipboard-share.js');
const Crypto = await import('../../src/lib/sync-crypto.js');

async function clipWidget(x, p) {
  const data = await x.storage(p, 'nt_data');
  data.settings.widgets = [{ id: 'clipboard', w: 6 }];
  await x.seed(p, { nt_data: data }, { reload: true });
  return p.locator('.widget[data-id="clipboard"]');
}
const paste = (card, text) => card.locator('.clip-drop').evaluate((el, t) => {
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);

test('tela 📤: regras e ntfy com pareamento por QR; QR de um item', async () => {
  const ext = extWith((m) => { m.host_permissions.push('https://*/*'); });
  const x = await launch({ ext });
  try {
    const p = await x.open('src/newtab.html');
    const card = await clipWidget(x, p);
    await paste(card, 'Senha do Wi-Fi da clínica: harmonize2026');
    await card.locator('.clip-item').first().waitFor();
    // QR do item
    await card.locator('.clip-item button[title="Mostrar QR para o celular"]').click();
    await p.locator('dialog.clip-qr[open] svg').waitFor();
    await p.locator('dialog.clip-qr[open] button[value="ok"]').click();
    // rede local (0.9.2.2): o QR leva o Wi-Fi recomendado; a VPN fica como alternativa marcada
    await p.evaluate(() => chrome.storage.local.set({ nt_clipshare_state: { lan: { status: 'on', urls: ['http://172.16.0.2:41414', 'http://192.168.1.2:41414'], addrs: [
      { url: 'http://192.168.1.2:41414', ip: '192.168.1.2', iface: 'Wi-Fi', publicNet: true },
      { url: 'http://172.16.0.2:41414', ip: '172.16.0.2', iface: 'CloudflareWARP', virtual: true }] } } }));
    await card.locator('..').locator('button[title="Compartilhar com outros aparelhos"]').click();
    await p.locator('dialog.share-dlg[open] button:has-text("Abrir no celular")').last().click();
    const lanDlg = p.locator('dialog.lan-qr[open]');
    await lanDlg.locator('.clip-qr-img svg').waitFor();
    if (process.env.NT_SHOTS) await p.screenshot({ path: 'test-results/lan-qr.png' });
    assert.equal(await lanDlg.locator('.lan-link').textContent(), 'http://192.168.1.2:41414/');
    assert.match(await lanDlg.locator('.lan-warn').textContent(), /Pública|Public/);
    await lanDlg.locator('summary').first().click();
    await lanDlg.locator('.lan-opt:has-text("CloudflareWARP")').click();
    assert.equal(await lanDlg.locator('.lan-link').textContent(), 'http://172.16.0.2:41414/');
    // rede bloqueada: "Usar ntfy em vez disso" liga o ntfy e abre o QR de pareamento
    await lanDlg.locator('button:has-text("Usar ntfy em vez disso")').click();
    await p.locator('dialog.clip-qr:not(.lan-qr)[open] .clip-qr-img svg').waitFor();
    await p.locator('dialog.clip-qr:not(.lan-qr)[open] button[value="ok"]').click();
    assert.equal(await p.locator('dialog.share-dlg[open] .share-card:has-text("ntfy") input[type="checkbox"]').first().isChecked(), true);
    await p.locator('dialog.share-dlg[open] button[value="cancel"]').click();
    await p.evaluate(() => chrome.storage.local.remove('nt_clipshare_state'));
    // tela de compartilhar
    await card.locator('..').locator('button[title="Compartilhar com outros aparelhos"]').click();
    const dlg = p.locator('dialog.share-dlg[open]');
    await dlg.locator('label:has-text("Compartilhar a área de transferência") input').check();
    await dlg.locator('label:has-text("Nome deste aparelho") input').fill('Notebook');
    await dlg.locator('label:has-text("O que enviar") select').selectOption('all');
    assert.equal(await dlg.locator('.share-card:has-text("Minha nuvem") input[type="checkbox"]').isDisabled(), true, 'nuvem pede a sincronização ligada');
    await dlg.locator('.share-card:has-text("ntfy") input[type="checkbox"]').first().check();
    await dlg.locator('button:has-text("Parear celular")').click();
    await p.locator('dialog.clip-qr[open] svg').waitFor();
    await p.locator('dialog.clip-qr[open] button[value="ok"]').click();
    await dlg.locator('button[value="ok"]').click();
    await p.waitForTimeout(400);
    const share = (await x.storage(p, 'nt_clipboard_cfg')).share;
    assert.equal(share.enabled, true);
    assert.equal(share.what, 'all');
    assert.equal(share.name, 'Notebook');
    assert.ok(share.ntfy.on && share.ntfy.topic.startsWith('nt-') && share.ntfy.key.length >= 40, 'canal e chave criados');
    // com o compartilhamento ligado, cada item ganha o 📤
    assert.equal(await card.locator('.clip-item button[title^="Enviar"]').count(), 1);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('rede local de verdade: extensão ↔ Ponte ↔ página do celular, nos dois sentidos', async (t) => {
  let ponte;
  try {
    ponte = join(mkdtempSync(join(tmpdir(), 'ponte-')), 'neurotab-ponte');
    execFileSync('go', ['build', '-o', ponte, '.'], { cwd: join(EXT, 'ponte'), stdio: 'pipe' });
  } catch {
    return t.skip('sem Go para compilar a Ponte');
  }
  const ext = extWith((m) => { m.permissions.push('nativeMessaging'); });
  const x = await launch({ ext });
  try {
    // "instala" a Ponte para este perfil do navegador de teste
    mkdirSync(join(x.dir, 'NativeMessagingHosts'), { recursive: true });
    writeFileSync(join(x.dir, 'NativeMessagingHosts', 'com.neurotab.ponte.json'), JSON.stringify({ name: 'com.neurotab.ponte', description: 'teste', path: ponte, type: 'stdio', allowed_origins: [`chrome-extension://${x.id}/`] }));
    const p = await x.open('src/newtab.html');
    const card = await clipWidget(x, p);
    const port = 47600 + Math.floor(Math.random() * 300);
    const token = S.newToken();
    await x.seed(p, { nt_clipboard_cfg: { retention: 'session', protect: true, max: 200, maxImages: 30, paused: false, ignore: [], share: { enabled: true, what: 'all', name: 'Notebook', images: 'small', direction: 'both', lan: { on: true, port, token } } } }, { reload: false });
    let st;
    for (let i = 0; i < 50 && (st = (await x.storage(p, 'nt_clipshare_state'))?.lan)?.status !== 'on'; i++) await p.waitForTimeout(200);
    assert.equal(st?.status, 'on', 'a Ponte ligou: ' + JSON.stringify(st));
    const real = st.port;
    assert.ok(Array.isArray(st.addrs) && st.addrs.length === st.urls.length && (!st.urls.length || st.addrs[0].url === st.urls[0]), 'endereços com o nome da placa, na mesma ordem: ' + JSON.stringify(st));

    // o celular abre a página pelo endereço do QR
    const phone = await x.ctx.newPage();
    await phone.goto(`http://127.0.0.1:${real}/#t=${encodeURIComponent(token)}`);
    await phone.locator('text=Nada por aqui ainda.').waitFor();
    assert.equal(await phone.locator('#pc').textContent(), 'Notebook');
    // token errado: recusado
    const bad = await x.ctx.request.get(`http://127.0.0.1:${real}/api/items`, { headers: { 'X-NT-Token': 'errado' } });
    assert.equal(bad.status(), 401);

    // computador → celular (ao vivo)
    await paste(card, 'Protocolo 2026-118 da Unimed');
    await phone.locator('.card:has-text("Protocolo 2026-118")').waitFor({ timeout: 8000 });
    // celular → computador
    await phone.fill('#box', 'Foto da receita chegou?');
    await phone.click('#send');
    await card.locator('.clip-item:has-text("Foto da receita chegou?")').waitFor({ timeout: 8000 });
    const items = (await x.storage(p, 'nt_clipboard')).items;
    const fromPhone = items.find((i) => i.text === 'Foto da receita chegou?');
    assert.equal(fromPhone.origin, 'remote');
    assert.equal(fromPhone.from.name, 'Celular');
    assert.match(await card.locator('.clip-item:has-text("Foto da receita")').textContent(), /📥 Celular/);
    // o que veio do celular não volta para ele duplicado (eco)
    await phone.waitForTimeout(800);
    assert.equal(await phone.locator('.card:has-text("Foto da receita chegou?")').count(), 1);

    // desligar: a Ponte fecha
    const cfg = await x.storage(p, 'nt_clipboard_cfg');
    cfg.share.lan.on = false;
    await x.seed(p, { nt_clipboard_cfg: cfg }, { reload: false });
    for (let i = 0; i < 30 && (await x.storage(p, 'nt_clipshare_state'))?.lan?.status === 'on'; i++) await p.waitForTimeout(200);
    assert.equal((await x.storage(p, 'nt_clipshare_state')).lan.status, 'off');
    assert.deepEqual(x.errors.filter((e) => !e.includes('127.0.0.1')), []);
  } finally {
    await x.close();
  }
});

// ---------- página do celular (site) ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
async function sitePage() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'pt-BR' });
  await ctx.route('https://mpjbiologo.github.io/NeuroTab/**', (r) => {
    let path = new URL(r.request().url()).pathname.replace('/NeuroTab/', '');
    if (!path || path.endsWith('/')) path += 'index.html';
    const file = join(EXT, 'docs', path);
    if (!existsSync(file)) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, contentType: TYPES[extname(file)] || 'application/octet-stream', body: readFileSync(file) });
  });
  return { browser, ctx };
}

test('página do celular · ntfy: lê o que o computador mandou (cifrado) e envia de volta', async () => {
  const { browser, ctx } = await sitePage();
  try {
    const key = S.newShareKey();
    const msgs = [];
    const posted = [];
    msgs.push({ id: 'm1', time: Math.floor(Date.now() / 1000), event: 'message', message: await S.sealNtfy({ v: 1, id: 'a', at: Date.now(), from: { id: 'pc', name: 'Notebook' }, text: 'Endereço do consultório: Rua X, 10' }, key) });
    await ctx.route('https://ntfy.test/**', async (r) => {
      const req = r.request();
      if (req.method() === 'POST') { posted.push(req.postData()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"m2"}', headers: { 'access-control-allow-origin': '*' } }); }
      if (req.url().endsWith('/sse')) return r.fulfill({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n', headers: { 'access-control-allow-origin': '*' } });
      return r.fulfill({ status: 200, contentType: 'application/x-ndjson', body: msgs.map((m) => JSON.stringify(m)).join('\n'), headers: { 'access-control-allow-origin': '*' } });
    });
    const page = await ctx.newPage();
    await page.goto(S.ntfyPairLink({ name: 'Notebook', ntfy: { server: 'https://ntfy.test', topic: 'nt-teste', key } }));
    await page.locator('.item:has-text("Rua X, 10")').waitFor();
    assert.ok(!page.url().includes(key), 'a chave sai da barra de endereço');
    await page.fill('textarea', 'Chego às 14h');
    await page.click('button:has-text("Enviar para o computador")');
    await page.waitForTimeout(300);
    assert.equal(posted.length, 1);
    assert.ok(!posted[0].includes('14h'), 'vai cifrado');
    const back = await S.openNtfy(posted[0], key);
    assert.equal(back.text, 'Chego às 14h');
    assert.ok(back.from.id.startsWith('cel-'));
  } finally {
    await browser.close();
  }
});

test('página do celular · nuvem: entra com a conta, digita a senha, lê e envia (tudo cifrado)', async () => {
  const { browser, ctx } = await sitePage();
  try {
    const salt = Crypto.newSalt();
    const key = await Crypto.deriveKey('senha-da-ana', salt, 1000);
    const files = {
      meta: { id: 'meta', name: 'nt-sync-meta.json', version: '1', body: { schema: 1, mode: 'key', salt, iterations: 1000, check: await Crypto.seal('neurotab-sync-ok', key) } },
      clip: { id: 'clip', name: 'nt-clipboard.json', version: '3', body: await Crypto.seal({ items: [{ v: 1, id: 'p1', at: Date.now(), from: { id: 'pc', name: 'Notebook' }, text: 'Link da aula: https://meet.google.com/abc' }] }, key) },
    };
    let patched = null;
    await ctx.route('https://www.googleapis.com/**', async (r) => {
      const req = r.request();
      assert.equal(req.headers().authorization, 'Bearer tok-celular');
      const u = new URL(req.url());
      if (u.pathname === '/drive/v3/files') return r.fulfill({ json: { files: Object.values(files).map(({ id, name, version }) => ({ id, name, version })) } });
      const id = u.pathname.split('/').pop();
      if (req.method() === 'PATCH') { patched = JSON.parse(req.postData()); return r.fulfill({ json: { id, version: '4' } }); }
      return r.fulfill({ json: files[id].body });
    });
    await ctx.addInitScript(() => sessionStorage.setItem('nt_cola_state', 'estado-1'));
    const page = await ctx.newPage();
    await page.goto('https://mpjbiologo.github.io/NeuroTab/cola/#access_token=tok-celular&expires_in=3600&token_type=Bearer&state=estado-1');
    await page.locator('input[type="password"]').fill('senha-errada');
    await page.click('button:has-text("Abrir")');
    await page.locator('#status:has-text("Senha incorreta")').waitFor();
    await page.locator('input[type="password"]').fill('senha-da-ana');
    await page.click('button:has-text("Abrir")');
    await page.locator('.item:has-text("meet.google.com/abc")').waitFor();
    assert.ok(!page.url().includes('tok-celular'), 'o acesso sai da barra de endereço');
    await page.fill('textarea', 'Anotado, obrigado');
    await page.click('button:has-text("Enviar para o computador")');
    for (let i = 0; i < 20 && !patched; i++) await page.waitForTimeout(100);
    assert.equal(patched.alg, 'A256GCM');
    const data = await Crypto.open(patched, key);
    assert.deepEqual(data.items.map((i) => i.text), ['Anotado, obrigado', 'Link da aula: https://meet.google.com/abc']);
  } finally {
    await browser.close();
  }
});
