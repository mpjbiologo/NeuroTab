// "Qual é a melhor IA para o meu computador?" (0.8.1, #61): detectar, completar à mão, Ollama (mock), baixar, usar e testar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, extWith, EXT } from './helpers.js';

const cors = { 'access-control-allow-origin': '*' };
function mockOllama(x, state) {
  return x.ctx.route('http://localhost:11434/**', async (r) => {
    const u = new URL(r.request().url()).pathname;
    if (u === '/api/version') return r.fulfill({ json: { version: '0.20.0' }, headers: cors });
    if (u === '/api/tags') return r.fulfill({ json: { models: state.installed.map((name) => ({ name, size: 3.4e9 })) }, headers: cors });
    if (u === '/api/ps') return r.fulfill({ json: { models: [{ name: 'qwen3.5:4b', size: 100, size_vram: 40 }] }, headers: cors });
    if (u === '/api/pull') {
      const { model } = JSON.parse(r.request().postData());
      state.pulled.push(model);
      state.installed.push(model);
      const lines = [{ status: 'pulling manifest' }, { status: 'pulling abc', total: 100, completed: 50 }, { status: 'pulling abc', total: 100, completed: 100 }, { status: 'success' }];
      return r.fulfill({ body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', headers: { ...cors, 'content-type': 'application/x-ndjson' } });
    }
    if (u === '/api/generate') return r.fulfill({ json: { response: 'Fotossíntese é…', eval_count: 120, eval_duration: 4e9 }, headers: cors });
    return r.fulfill({ status: 404, headers: cors });
  });
}

test('assistente: detecta, completa à mão, recomenda, baixa, usa no NeuroTab e testa', async () => {
  const x = await launch({ viewport: { width: 1100, height: 950 } });
  try {
    const state = { installed: ['qwen3.5:4b'], pulled: [] };
    await mockOllama(x, state);
    // o botão nas Configurações abre a página
    const o = await x.open('src/options.html#ia');
    assert.equal(await o.getAttribute('#aiAdvisor', 'href'), 'advisor.html');
    await o.close();

    const p = await x.open('src/advisor.html');
    await p.evaluate(() => { chrome.permissions.request = async () => true; const c = chrome.permissions.contains; chrome.permissions.contains = async (q) => (q.origins?.some((o) => o.includes('11434')) ? true : c.call(chrome.permissions, q)); });
    await p.click('#start');
    await p.locator('#hwSec:not([hidden])').waitFor();
    // sem a Ponte neste teste: o aviso de estimativa aparece
    await p.locator('#introMsg', { hasText: /estimar|Lido com/ }).waitFor();
    const ram = p.locator('.hw-row').first().locator('input[type=number]');
    await ram.fill('16');
    await ram.dispatchEvent('change');
    await p.locator('.hw-row').first().locator('.badge.b-manual').waitFor();
    const saved = await x.storage(p, 'nt_advisor');
    assert.equal(saved.manual.ramGB, 16);

    await p.click('#ollamaCheck');
    await p.locator('#ollamaStatus', { hasText: '0.20.0' }).waitFor();
    await p.click('#calc');
    await p.locator('#results:not([hidden]) .card').first().waitFor();
    assert.match(await p.textContent('#results .grade'), /Bom|Ótimo|Limitado/);
    // guia com o modelo recomendado e comandos copiáveis
    assert.match(await p.textContent('#guide'), /ollama pull /);

    // baixar um modelo que ainda não está instalado
    const card = p.locator('#results .card', { has: p.locator('button', { hasText: 'Baixar este modelo' }) }).first();
    const id = await card.locator('code').textContent();
    await card.locator('button', { hasText: 'Baixar este modelo' }).click();
    await p.locator('#results', { hasText: 'Baixado.' }).first().waitFor().catch(() => {});
    await p.waitForFunction((m) => [...document.querySelectorAll('#results .card')].some((c) => c.querySelector('code')?.textContent === m && c.textContent.includes('instalado')), id);
    assert.deepEqual(state.pulled, [id]);

    // usar o instalado como Padrão
    const inst = p.locator('#results .purpose').first().locator('.card', { hasText: 'qwen3.5:4b' }).first();
    await inst.locator('button', { hasText: 'Usar no NeuroTab' }).click();
    await p.locator('dialog select').selectOption('primary');
    await p.click('dialog button[value=ok]');
    await p.locator('#results', { hasText: 'Agora é o Padrão' }).waitFor();
    const ai = (await x.storage(p, 'nt_data')).settings.ai;
    const srv = ai.servers.find((s) => s.type === 'ollama');
    assert.ok(srv.models.some((m) => m.id === 'qwen3.5:4b'));
    assert.deepEqual(ai.primary, { server: srv.id, model: 'qwen3.5:4b' });

    // testar a velocidade: 120 tokens em 4 s = 30 tokens/s
    await inst.locator('button', { hasText: 'Testar no meu computador' }).click();
    await inst.locator('text=/30 tokens\\/s/').waitFor();
    assert.match(await inst.textContent(), /40% na placa de vídeo/);

    // reabrir mostra o diagnóstico guardado; apagar limpa
    await p.reload();
    await p.locator('#results:not([hidden]) .card').first().waitFor();
    await p.click('#forget');
    await p.locator('#hwSec[hidden]').waitFor({ state: 'attached' });
    assert.equal(await x.storage(p, 'nt_advisor'), undefined);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('assistente: computador fraco sugere IA na internet, com aviso de privacidade', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/advisor.html');
    await x.seed(p, { nt_advisor: { at: Date.now(), detected: { ramGB: { value: 4, src: 'estimate' }, threads: { value: 2, src: 'estimate' } }, sources: {}, manual: {} } });
    await p.locator('#cloud:not([hidden])').waitFor();
    assert.match(await p.textContent('#cloud'), /vai para o fornecedor/);
    assert.match(await p.textContent('#results'), /Nenhum modelo cabe|Não recomendado/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('assistente com a Ponte de verdade e o LibreHardwareMonitor: lê RAM, disco e a placa de vídeo', async (t) => {
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
    const LHM = { id: 0, Text: 'Sensor', Children: [{ id: 1, Text: 'PC', Children: [{ id: 3, Text: 'NVIDIA GeForce RTX 3060', ImageURL: 'images_icon/nvidia.png', HardwareId: '/gpu-nvidia/0', Children: [
      { Text: 'Data', Children: [{ Text: 'GPU Memory Used', Value: '512.0 MB' }, { Text: 'GPU Memory Total', Value: '12288.0 MB' }] }] }] }] };
    await x.ctx.route('http://localhost:8085/**', (r) => r.fulfill({ json: LHM }));
    const p = await x.open('src/advisor.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.system = { ...(data.settings.system || {}), lhm: { on: true, url: 'http://localhost:8085' } };
    await x.seed(p, { nt_data: data });
    await p.click('#start');
    await p.locator('#introMsg', { hasText: 'NeuroTab Ponte' }).waitFor({ timeout: 20000 });
    const row = (i) => p.locator('.hw-row').nth(i);
    assert.ok(Number(await row(0).locator('input:not([type=checkbox])').inputValue()) > 0, 'RAM lida pela Ponte');
    assert.ok(await row(0).locator('.badge.b-ponte').count());
    assert.equal(await row(3).locator('select').inputValue(), 'linux');
    assert.match(await row(6).locator('input:not([type=checkbox])').inputValue(), /RTX 3060/);
    assert.equal(Number(await row(7).locator('input:not([type=checkbox])').inputValue()), 12);
    assert.ok(await row(7).locator('.badge.b-lhm').count());
    assert.ok(Number(await row(8).locator('input:not([type=checkbox])').inputValue()) > 0, 'disco livre lido pela Ponte');
    await p.click('#calc');
    await p.locator('#results .card.main', { hasText: 'na placa de vídeo' }).first().waitFor();
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
