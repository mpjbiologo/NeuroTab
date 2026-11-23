// Configurações → Sistema → Apps externos: justificativa de cada programa, aviso do antivírus e o estado da Ponte
// (com a NeuroTab Ponte de verdade, compilada do ponte/, e um yt-dlp de mentira).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, extWith, EXT } from './helpers.js';

test('Apps externos: programas, aviso do antivírus e estado da Ponte', async (t) => {
  let ponte;
  try {
    ponte = join(mkdtempSync(join(tmpdir(), 'ponte-')), 'neurotab-ponte');
    execFileSync('go', ['build', '-o', ponte, '.'], { cwd: join(EXT, 'ponte'), stdio: 'pipe' });
  } catch {
    return t.skip('sem Go para compilar a Ponte');
  }
  const bin = mkdtempSync(join(tmpdir(), 'ytdlp-'));
  writeFileSync(join(bin, 'yt-dlp'), '#!/bin/sh\necho 2026.11.01\n', { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH}`, XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'cache-')) };
  const x = await launch({ ext: extWith((m) => { m.permissions.push('nativeMessaging'); }), env });
  try {
    // sem a Ponte instalada
    const o = await x.open('src/options.html#apps');
    await o.locator('#page-apps').waitFor();
    const text = await o.textContent('#page-apps');
    for (const s of ['NeuroTab Ponte', 'yt-dlp', 'ffmpeg', 'LibreHardwareMonitor', 'Ollama', 'Por que existe', 'Executar assim mesmo', 'SHA256SUMS']) assert.ok(text.includes(s), s);
    assert.match(await o.getAttribute('#ponteDownload', 'href'), /releases\/latest\/download\/neurotab-ponte-/);
    await o.locator('#ponteStatus.bad').waitFor({ timeout: 15000 });
    assert.match(await o.textContent('#ponteStatus'), /Não instalada/);
    // instala (registra no perfil) e verifica de novo
    mkdirSync(join(x.dir, 'NativeMessagingHosts'), { recursive: true });
    writeFileSync(join(x.dir, 'NativeMessagingHosts', 'com.neurotab.ponte.json'), JSON.stringify({ name: 'com.neurotab.ponte', description: 'teste', path: ponte, type: 'stdio', allowed_origins: [`chrome-extension://${x.id}/`] }));
    await o.click('#ponteCheck');
    await o.locator('#ponteStatus.ok').waitFor({ timeout: 20000 });
    assert.match(await o.textContent('#ponteStatus'), /Instalada/);
    await o.locator('#ytdlpStatus.ok').waitFor({ timeout: 15000 });
    assert.match(await o.textContent('#ytdlpStatus'), /2026\.11\.01/);
    assert.match(await o.textContent('#ffmpegStatus'), /Não instalado|Instalado/);
    // link antigo
    const o2 = await x.open('src/options.html#ponte');
    await o2.waitForFunction(() => !document.querySelector('#page-apps').hidden);
    // em inglês
    await o.evaluate(async () => { const d = (await chrome.storage.local.get('nt_data')).nt_data; d.settings.lang = 'en'; await chrome.storage.local.set({ nt_data: d }); });
    await o.reload();
    await o.locator('#page-apps').waitFor();
    assert.match(await o.textContent('#page-apps'), /Why it exists/);
    assert.match(await o.textContent('#page-apps'), /Run anyway/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
