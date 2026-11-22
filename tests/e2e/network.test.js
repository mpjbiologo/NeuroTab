// Widget Rede (#52): velocidade, DNS, monitor de travadas e "Quem usa" — com servidores simulados
// e, no segundo teste, a NeuroTab Ponte de verdade (compilada do ponte/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, extWith, EXT } from './helpers.js';

const ORIGINS = ['https://speed.cloudflare.com/*', 'https://cloudflare-dns.com/*', 'https://dns.google/*', 'https://dns.quad9.net/*', 'https://dns.adguard-dns.com/*', 'https://doh.opendns.com/*', 'https://dns.nextdns.io/*'];

async function fakeNet(x, { slowDns = 'quad9' } = {}) {
  await x.ctx.route('https://speed.cloudflare.com/**', async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/__down') return r.fulfill({ status: 200, body: Buffer.alloc(Math.min(Number(u.searchParams.get('bytes')), 2e6)), headers: { 'access-control-allow-origin': '*' } });
    if (u.pathname === '/__up') return r.fulfill({ status: 200, body: 'ok', headers: { 'access-control-allow-origin': '*' } });
    return r.fulfill({ status: 404 });
  });
  const answer = Buffer.alloc(12);
  answer[2] = 0x81; answer[3] = 0x80; answer[7] = 1;
  for (const o of ORIGINS.slice(1)) {
    await x.ctx.route(o.replace('/*', '/**'), async (r) => {
      if (r.request().url().includes(slowDns)) await new Promise((res) => setTimeout(res, 120));
      return r.fulfill({ status: 200, body: answer, headers: { 'content-type': 'application/dns-message', 'access-control-allow-origin': '*' } });
    });
  }
}

async function addWidget(x, p, tab) {
  const data = await x.storage(p, 'nt_data');
  data.settings.widgets.unshift({ id: 'network', size: 'l', ...(tab ? { tab } : {}) });
  data.settings.net = { plan: 'light', monitor: { every: 3 } };
  await x.seed(p, { nt_data: data });
  return p.locator('.widget', { has: p.locator('.net') });
}

test('Rede pelo navegador: velocidade, histórico, DNS, monitor e configurações', async () => {
  const ext = extWith((m) => { m.host_permissions.push(...ORIGINS); });
  const x = await launch({ ext });
  try {
    await fakeNet(x);
    const p = await x.open('src/newtab.html');
    const w = await addWidget(x, p);
    assert.match(await w.locator('.net-start small').textContent(), /MB de dados/, 'volume informado antes');
    // velocidade
    await w.locator('button:has-text("Testar a velocidade")').click();
    await w.locator('.net-card').waitFor({ timeout: 30000 });
    const st = await x.storage(p, 'nt_net');
    assert.equal(st.tests.length, 1);
    const r = st.tests[0];
    assert.ok(r.down > 0 && r.up > 0, JSON.stringify(r));
    assert.ok(Number.isFinite(r.latency.median));
    assert.ok(await w.locator('.net-verdict li').count() >= 4, 'veredito por atividade');
    assert.match(await w.locator('.net-note').textContent(), /medida pela web/);
    // segundo teste → histórico
    await w.locator('button:has-text("Testar a velocidade")').click();
    await p.waitForFunction(async () => (await chrome.storage.local.get('nt_net')).nt_net?.tests?.length === 2, null, { timeout: 30000 });
    await w.locator('.net-hist summary').click();
    assert.equal(await w.locator('.net-bars span').count(), 2);

    // DNS: só três, quad9 mais lento
    await w.locator('header button[title="Configurar o widget Rede"]').click();
    const dlg = p.locator('.net-dlg');
    for (const id of ['cloudflare', 'adguard', 'opendns', 'nextdns']) await dlg.locator(`input[value="${id}"]`).uncheck();
    await dlg.locator('label:has-text("Considerar travada") input').fill('120');
    await dlg.locator('button[value="ok"]').click();
    await p.waitForTimeout(300);
    const n = (await x.storage(p, 'nt_data')).settings.net;
    assert.deepEqual(n.dns, ['google', 'quad9']);
    assert.equal(n.monitor.lagMs, 120);
    await w.locator('.net-tabs button:has-text("DNS")').click();
    await w.locator('button:has-text("Comparar DNS")').click();
    await w.locator('.net-dns tbody tr').nth(1).waitFor({ timeout: 20000 });
    assert.equal(await w.locator('.net-dns tbody tr').count(), 2);
    assert.match(await w.locator('.net-dns tr.best').textContent(), /Google/);
    assert.match(await w.locator('.net-how').textContent(), /8\.8\.8\.8/);
    assert.match(await w.locator('.net-how').textContent(), /dns\.google\/dns-query/);

    // monitor de travadas
    await w.locator('.net-tabs button:has-text("Travadas")').click();
    await w.locator('button:has-text("Vigiar a conexão")').click();
    await p.waitForFunction(async () => (await chrome.storage.local.get('nt_net')).nt_net?.samples?.length >= 2, null, { timeout: 15000 });
    assert.equal((await x.storage(p, 'nt_data')).settings.net.monitor.on, true);
    assert.equal(await w.locator('.net-chart').count(), 1);
    await w.locator('button:has-text("Parar o monitor")').click();
    assert.equal((await x.storage(p, 'nt_data')).settings.net.monitor.on, false);
    // em segundo plano: o alarme existe só com a opção ligada
    const data = await x.storage(p, 'nt_data');
    data.settings.net.monitor = { ...data.settings.net.monitor, on: true, background: true };
    await x.seed(p, { nt_data: data }, { reload: false });
    await p.waitForFunction(async () => !!(await chrome.alarms.get('netmon')), null, { timeout: 5000 });
    data.settings.net.monitor.background = false;
    await x.seed(p, { nt_data: data }, { reload: false });
    await p.waitForFunction(async () => !(await chrome.alarms.get('netmon')), null, { timeout: 5000 });

    // sem a Ponte: "Quem usa" explica e oferece o download
    await w.locator('.net-tabs button:has-text("Quem usa")').click();
    assert.match(await w.locator('.net').textContent(), /NeuroTab Ponte/);
    assert.match(await w.locator('a:has-text("Baixar a Ponte")').getAttribute('href'), /neurotab-ponte-/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Rede com a NeuroTab Ponte: aparelhos, uso, DNS por UDP e nomes dos aparelhos', async (t) => {
  let ponte;
  try {
    ponte = join(mkdtempSync(join(tmpdir(), 'ponte-')), 'neurotab-ponte');
    execFileSync('go', ['build', '-o', ponte, '.'], { cwd: join(EXT, 'ponte'), stdio: 'pipe' });
  } catch {
    return t.skip('sem Go para compilar a Ponte');
  }
  const ext = extWith((m) => { m.permissions.push('nativeMessaging'); m.host_permissions.push(...ORIGINS); });
  const x = await launch({ ext });
  try {
    mkdirSync(join(x.dir, 'NativeMessagingHosts'), { recursive: true });
    writeFileSync(join(x.dir, 'NativeMessagingHosts', 'com.neurotab.ponte.json'), JSON.stringify({ name: 'com.neurotab.ponte', description: 'teste', path: ponte, type: 'stdio', allowed_origins: [`chrome-extension://${x.id}/`] }));
    await fakeNet(x);
    const p = await x.open('src/newtab.html');
    const w = await addWidget(x, p, 'who');
    await w.locator('.net-devs li').first().waitFor({ timeout: 20000 });
    assert.ok(await w.locator('.net-devs .tag:has-text("este computador")').count() >= 1, 'o próprio computador aparece');
    assert.match(await w.locator('.net-usage').textContent(), /Mbps/);
    // dar nome a um aparelho
    await p.evaluate(() => { window.prompt = () => 'Notebook do escritório'; });
    await w.locator('.net-devs li').first().locator('button[title="Dar um nome"]').click();
    await w.locator('.net-devs b:has-text("Notebook do escritório")').waitFor();
    const devs = (await x.storage(p, 'nt_net')).devices;
    assert.ok(Object.values(devs).some((d) => d.label === 'Notebook do escritório'));
    // DNS pelo jeito clássico (UDP) quando a Ponte está lá
    await w.locator('.net-tabs button:has-text("DNS")').click();
    await w.locator('button:has-text("Comparar DNS")').click();
    await p.waitForFunction(async () => (await chrome.storage.local.get('nt_net')).nt_net?.dns?.method === 'udp', null, { timeout: 40000 });
    assert.match(await w.locator('.net-note').textContent(), /UDP/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
