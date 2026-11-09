// Backup: importar NeuroTab e Speed Dial, exportar com chaves (com e sem senha) e restaurar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, fixture } from './helpers.js';

test('backup completo: importar, exportar com chaves protegidas e restaurar', async () => {
  const x = await launch();
  const tmp = mkdtempSync(join(tmpdir(), 'nt-bk-'));
  try {
    const o = await x.open('src/options.html#backup');
    await o.setInputFiles('#importFile', fixture('demo-backup.json'));
    await o.waitForFunction(() => /✓/.test(document.querySelector('#importMsg').textContent));
    assert.equal((await x.storage(o, 'nt_data')).links.length, 18);

    await x.settings(o, { ai: { keys: { gemini: 'AIzaSyTESTE-chave-1234567890' } }, brapiToken: 'BRAPI' });
    await o.click('[data-tab=backup]');
    await o.check('#inclKeys');
    await o.fill('#bkPwd', 'segredo123');
    await o.fill('#bkPwd2', 'segredo123');
    const [dl] = await Promise.all([o.waitForEvent('download'), o.click('#exportBtn')]);
    const file = join(tmp, 'b.json');
    await dl.saveAs(file);
    const text = readFileSync(file, 'utf8');
    const bk = JSON.parse(text);
    assert.equal(bk.secrets.protected, true);
    assert.ok(!text.includes('AIzaSyTESTE'), 'chave não aparece em texto puro');
    assert.deepEqual(bk.data.settings.ai.keys, {});

    // apaga a chave e restaura: senha errada mostra erro, senha certa restaura
    await x.settings(o, { ai: { keys: {} }, brapiToken: '' });
    await o.click('[data-tab=backup]');
    await o.setInputFiles('#importFile', file);
    await o.waitForSelector('#pwdDlg[open]');
    await o.fill('#pwdIn', 'errada');
    await o.click('#pwdOk');
    await o.waitForFunction(() => document.querySelector('#pwdErr').textContent.length > 0);
    await o.fill('#pwdIn', 'segredo123');
    await o.press('#pwdIn', 'Enter');
    await o.waitForFunction(() => /✓/.test(document.querySelector('#importMsg').textContent));
    const s = (await x.storage(o, 'nt_data')).settings;
    assert.equal(s.ai.keys.gemini, 'AIzaSyTESTE-chave-1234567890');
    assert.equal(s.brapiToken, 'BRAPI');

    // backup comum (sem marcar) nunca leva chaves
    await o.reload();
    await o.click('[data-tab=backup]');
    const [dl2] = await Promise.all([o.waitForEvent('download'), o.click('#exportBtn')]);
    await dl2.saveAs(join(tmp, 'c.json'));
    assert.ok(!readFileSync(join(tmp, 'c.json'), 'utf8').includes('AIzaSyTESTE'));
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('importar backup do Speed Dial (.spd)', async () => {
  const x = await launch();
  try {
    const o = await x.open('src/options.html#backup');
    await o.setInputFiles('#importFile', fixture('sample.spd'));
    await o.waitForFunction(() => /✓/.test(document.querySelector('#importMsg').textContent));
    const d = await x.storage(o, 'nt_data');
    assert.ok(d.links.some((l) => l.url === 'https://developer.mozilla.org/'));
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
