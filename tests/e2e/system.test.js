// Widget Sistema (0.7.10): com a NeuroTab Ponte de verdade (compilada do ponte/), o LibreHardwareMonitor simulado
// e o modo só do navegador (Chrome: system.cpu e system.memory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, extWith, EXT } from './helpers.js';

const LHM = {
  id: 0, Text: 'Sensor', Children: [{ id: 1, Text: 'DESKTOP-ABC', ImageURL: 'images_icon/computer.png', Children: [
    { id: 2, Text: 'AMD Ryzen 7 5800X', ImageURL: 'images_icon/cpu.png', HardwareId: '/amdcpu/0', Children: [
      { Text: 'Temperatures', ImageURL: 'images_icon/temperature.png', Children: [{ Text: 'Core (Tctl/Tdie)', Value: '67,4 °C', Type: 'Temperature' }, { Text: 'CCD1 (Tdie)', Value: '60,1 °C' }] },
      { Text: 'Load', ImageURL: 'images_icon/load.png', Children: [{ Text: 'CPU Total', Value: '23,5 %' }, { Text: 'CPU Core #1', Value: '40,0 %' }] }] },
    { id: 3, Text: 'NVIDIA GeForce RTX 3060', ImageURL: 'images_icon/nvidia.png', HardwareId: '/gpu-nvidia/0', Children: [
      { Text: 'Temperatures', Children: [{ Text: 'GPU Core', Value: '58.0 °C' }, { Text: 'GPU Hot Spot', Value: '70.2 °C' }] },
      { Text: 'Load', Children: [{ Text: 'GPU Core', Value: '31.0 %' }] },
      { Text: 'Data', Children: [{ Text: 'GPU Memory Used', Value: '2048.0 MB' }, { Text: 'GPU Memory Total', Value: '12288.0 MB' }] }] },
    { id: 4, Text: 'Generic Memory', ImageURL: 'images_icon/ram.png', HardwareId: '/ram', Children: [
      { Text: 'Data', Children: [{ Text: 'Memory Used', Value: '10,0 GB' }, { Text: 'Memory Available', Value: '6,0 GB' }] }] },
    { id: 5, Text: 'Samsung SSD 980 1TB', ImageURL: 'images_icon/hdd.png', HardwareId: '/nvme/0', Children: [
      { Text: 'Temperatures', Children: [{ Text: 'Temperature', Value: '41,0 °C' }] }, { Text: 'Load', Children: [{ Text: 'Used Space', Value: '72,0 %' }] }] }] }],
};

async function addWidget(x, p, system = {}) {
  const data = await x.storage(p, 'nt_data');
  data.settings.widgets.unshift({ id: 'system', size: 'l' });
  data.settings.system = { every: 1, ...system };
  await x.seed(p, { nt_data: data });
  return p.locator('.widget', { has: p.locator('.sys') });
}

test('Sistema com a Ponte e o LibreHardwareMonitor: CPU, memória, discos, programas, temperaturas, GPU e alerta', async (t) => {
  let ponte;
  try {
    ponte = join(mkdtempSync(join(tmpdir(), 'ponte-')), 'neurotab-ponte');
    execFileSync('go', ['build', '-o', ponte, '.'], { cwd: join(EXT, 'ponte'), stdio: 'pipe' });
  } catch {
    return t.skip('sem Go para compilar a Ponte');
  }
  const ext = extWith((m) => { m.permissions.push('nativeMessaging'); m.host_permissions.push('http://localhost/*'); });
  const x = await launch({ ext });
  try {
    mkdirSync(join(x.dir, 'NativeMessagingHosts'), { recursive: true });
    writeFileSync(join(x.dir, 'NativeMessagingHosts', 'com.neurotab.ponte.json'), JSON.stringify({ name: 'com.neurotab.ponte', description: 'teste', path: ponte, type: 'stdio', allowed_origins: [`chrome-extension://${x.id}/`] }));
    let lhmCalls = 0;
    await x.ctx.route('http://localhost:8085/**', (r) => { lhmCalls++; return r.fulfill({ json: LHM }); });
    const p = await x.open('src/newtab.html');
    const w = await addWidget(x, p, { lhm: { on: true, url: 'http://localhost:8085' }, alerts: { cpuTemp: 60 } });
    await w.locator('.sys-card').first().waitFor({ timeout: 20000 });
    await p.waitForFunction(() => document.querySelector('.sys-src.on')?.textContent.includes('Ponte'), null, { timeout: 20000 });
    const text = await w.locator('.sys').textContent();
    assert.match(text, /Processador/);
    assert.match(text, /Memória/);
    assert.match(text, /\d+%/);
    assert.ok(await w.locator('.sys-disk').count() >= 1, 'discos da Ponte');
    await w.locator('.sys-procs tbody tr').first().waitFor({ timeout: 20000 });
    // temperatura e GPU vieram do LHM
    assert.match(await w.locator('.sys-card').first().textContent(), /67 °C/);
    assert.ok(await w.locator('.sys-card', { hasText: 'NVIDIA GeForce RTX 3060' }).count());
    assert.ok(lhmCalls >= 1);
    // processador acima do limite (60 °C) → aviso registrado (no máximo um a cada 15 min)
    await p.waitForFunction(async () => !!(await chrome.storage.session.get('nt_sys_alerted')).nt_sys_alerted?.cpuTemp, null, { timeout: 10000 });
    // °F nas configurações
    await w.locator('header button[title="Configurar o widget Sistema"]').click();
    await p.locator('.net-dlg select').selectOption('F');
    await p.locator('.net-dlg button[value="ok"]').click();
    await p.waitForFunction(() => document.querySelector('.sys-card')?.textContent.includes('°F'), null, { timeout: 15000 });
    assert.equal((await x.storage(p, 'nt_data')).settings.system.unit, 'F');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Sistema sem a Ponte: convite para instalar e, no Chrome, processador e memória pelo navegador', async () => {
  const ext = extWith((m) => { m.permissions.push('system.cpu', 'system.memory'); });
  const x = await launch({ ext });
  try {
    const p = await x.open('src/newtab.html');
    const w = await addWidget(x, p, { usePonte: false });
    await w.locator('.sys-card').first().waitFor({ timeout: 15000 });
    await p.waitForFunction(() => /\d+%/.test(document.querySelector('.sys-card .sys-big')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await w.locator('.sys-top').textContent(), /Navegador/);
    assert.equal(await w.locator('.sys-disk').count(), 0, 'o navegador não vê os discos');
    // sem nenhuma fonte: explica e oferece a Ponte
    const data = await x.storage(p, 'nt_data');
    data.settings.system = { usePonte: true };
    const x2 = await launch();
    try {
      const p2 = await x2.open('src/newtab.html');
      const d2 = await x2.storage(p2, 'nt_data');
      d2.settings.widgets.unshift({ id: 'system', size: 'l' });
      await x2.seed(p2, { nt_data: d2 });
      const w2 = p2.locator('.widget', { has: p2.locator('.sys') });
      await w2.locator('a:has-text("Baixar a Ponte")').waitFor({ timeout: 15000 });
      assert.match(await w2.locator('a:has-text("Baixar a Ponte")').getAttribute('href'), /neurotab-ponte-/);
      assert.deepEqual(x2.errors, []);
    } finally {
      await x2.close();
    }
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
