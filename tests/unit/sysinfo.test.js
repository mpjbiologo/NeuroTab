// Widget Sistema (0.7.10): configurações, LibreHardwareMonitor, junção das fontes e alertas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SYS, sanitizeSys, validLhmUrl, fmtBytes, fmtTemp, fmtUptime, lhmValue, parseLhm, mergeSys, evalAlerts, memUsedPct, diskFreePct, readLhm } from '../../src/lib/sysinfo.js';
import { mergeSettings } from '../../src/lib/store.js';

export const LHM = {
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

test('configurações: limites e endereço do LibreHardwareMonitor validados', () => {
  assert.deepEqual(sanitizeSys(null), DEFAULT_SYS);
  const s = sanitizeSys({ unit: 'K', every: 0, alerts: { cpuTemp: 300, diskFree: 0 }, lhm: { on: 1, url: 'https://site.com' }, show: { gpu: false, x: true } });
  assert.equal(s.unit, 'C');
  assert.equal(s.every, 1);
  assert.equal(s.alerts.cpuTemp, 110);
  assert.equal(s.alerts.diskFree, 1);
  assert.equal(s.lhm.url, 'http://localhost:8085', 'só endereço local');
  assert.equal(s.show.gpu, false);
  assert.equal('x' in s.show, false);
  assert.ok(validLhmUrl('http://127.0.0.1:9000/'));
  assert.deepEqual(mergeSettings({}).system, DEFAULT_SYS);
});

test('formatos', () => {
  assert.equal(fmtBytes(16 * 1024 ** 3), '16,0 GB');
  assert.equal(fmtBytes(512 * 1024 ** 3), '512 GB');
  assert.equal(fmtTemp(67.4), '67 °C');
  assert.equal(fmtTemp(100, 'F'), '212 °F');
  assert.equal(fmtUptime(90061), '1 d 1 h');
  assert.equal(fmtUptime(3700), '1 h 1 min');
  assert.equal(lhmValue('45,3 °C'), 45.3);
  assert.equal(lhmValue('2048.0 MB'), 2048 * 1024 ** 2);
  assert.equal(lhmValue('—'), null);
});

test('LibreHardwareMonitor: CPU, GPU, RAM e SSD a partir do data.json', () => {
  const l = parseLhm(LHM);
  assert.deepEqual(l.cpu, { model: 'AMD Ryzen 7 5800X', usage: 23.5, temp: 67.4 });
  assert.equal(l.gpus.length, 1);
  assert.deepEqual([l.gpus[0].usage, l.gpus[0].temp, l.gpus[0].memUsed, l.gpus[0].memTotal], [31, 58, 2048 * 1024 ** 2, 12288 * 1024 ** 2]);
  assert.equal(Math.round(memUsedPct(l.mem)), 63);
  assert.deepEqual(l.disks, [{ name: 'Samsung SSD 980 1TB', temp: 41, usedPct: 72 }]);
  assert.ok(l.temps.length >= 5);
});

test('junção: Ponte manda, LHM completa as temperaturas e a GPU, navegador é o último recurso', () => {
  const ponte = { os: 'windows', cpu: { model: 'AMD Ryzen 7 5800X', cores: 16, usage: 20 }, mem: { total: 100, available: 40 }, disks: [{ mount: 'C:', total: 1000, free: 50 }], gpus: [], temps: [], notes: ['temp-windows'] };
  const v = mergeSys({ ponte, lhm: parseLhm(LHM) });
  assert.equal(v.cpu.usage, 20, 'uso da Ponte');
  assert.equal(v.cpu.temp, 67.4, 'temperatura do LHM');
  assert.equal(v.gpus[0].name, 'NVIDIA GeForce RTX 3060');
  assert.equal(v.disks[0].temp, 41);
  assert.deepEqual(v.sources, ['lhm', 'ponte']);
  const b = mergeSys({ browser: { cpu: { model: 'Intel', cores: 4, usage: 10 }, mem: { total: 8, available: 2 } } });
  assert.equal(b.cpu.usage, 10);
  assert.equal(memUsedPct(b.mem), 75);
  assert.equal(b.cpu.temp, null);
  assert.equal(diskFreePct({ total: 200, free: 20 }), 10);
});

test('alertas: temperatura, disco e RAM alta por mais de 1 minuto', () => {
  const v = { cpu: { temp: 95 }, gpus: [{ name: 'RTX', temp: 70 }], disks: [{ mount: 'C:', label: 'Sistema', total: 1000, free: 50 }], mem: { total: 100, available: 5 } };
  const st = {};
  let a = evalAlerts(v, {}, st, 0);
  assert.deepEqual(a.map((x) => x.id), ['cpuTemp', 'disk:C:']);
  assert.match(a[1].title, /Sistema \(C:\)/);
  a = evalAlerts(v, {}, st, 61e3);
  assert.ok(a.some((x) => x.id === 'ram'));
  a = evalAlerts({ ...v, mem: { total: 100, available: 50 } }, {}, st, 62e3);
  assert.ok(!a.some((x) => x.id === 'ram'));
  assert.equal(st.ramSince, null);
  assert.deepEqual(evalAlerts(v, { alerts: { cpuTemp: 100, diskFree: 2 } }, {}, 0).map((x) => x.id), []);
});

test('lê o LibreHardwareMonitor pelo servidor web', async () => {
  const fake = async (url) => { assert.equal(url, 'http://localhost:8085/data.json'); return new Response(JSON.stringify(LHM)); };
  const l = await readLhm('http://localhost:8085/', { fetchFn: fake });
  assert.equal(l.cpu.temp, 67.4);
  await assert.rejects(readLhm('http://localhost:8085', { fetchFn: async () => new Response('', { status: 404 }) }), /404/);
});
