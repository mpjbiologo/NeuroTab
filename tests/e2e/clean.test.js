// Modo Clean (#69): Alt+Z liga e desliga sem perder o layout; busca universal dentro dele; só ícones; grupo;
// fonte; opções nas Configurações; nada sobreposto em telas comuns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('Modo Clean: Alt+Z, busca, atalhos só com ícones, grupo e fonte', async () => {
  const x = await launch({ viewport: { width: 1600, height: 900 } });
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { userName: 'Marcos', widgets: [{ id: 'brain', w: 6 }, { id: 'capture', w: 6 }] });
    const widgets = await p.locator('#widgets .widget').count();
    assert.ok(widgets >= 2);
    await p.keyboard.press('Alt+z');
    await p.locator('#clean:not([hidden])').waitFor();
    assert.equal(await p.isVisible('#widgets'), false);
    assert.equal(await p.isVisible('#dock'), false);
    assert.match(await p.textContent('#clGreet'), /^Bom (dia|tarde|noite)|^Boa (tarde|noite|madrugada)/);
    assert.match(await p.textContent('#clGreet'), /Marcos/);
    assert.match(await p.textContent('#clDate'), /^[A-ZÁÉÍÓÚÇ]{3} · \d{1,2} [A-ZÇ]{3}$/);
    assert.equal(await p.locator('#clClock .cl-sep i').count(), 2);
    assert.ok(parseFloat(await p.evaluate(() => document.querySelector('#clDay').style.width)) >= 0);
    assert.equal((await x.storage(p, 'nt_data')).settings.clean.on, true, 'fica salvo');
    // a busca universal mudou de lugar e continua funcionando (Ctrl+K e resultados)
    assert.equal(await p.locator('#clOmniSlot #omni').count(), 1);
    await p.keyboard.press('Control+k');
    await p.keyboard.type('gmail');
    await p.locator('#omniResults:not([hidden]) .omni-item').first().waitFor();
    await p.keyboard.press('Escape');
    // atalhos: ícone + nome, depois só ícones e outro grupo
    const first = await p.locator('#clLinks .cl-link').count();
    assert.ok(first > 0 && first <= 8);
    assert.ok(await p.locator('#clLinks .cl-name').count() > 0);
    const data = await x.storage(p, 'nt_data');
    const g2 = { id: 'g2', name: 'Trabalho', icon: '💼' };
    data.groups.push(g2);
    data.links.push({ id: 'w1', groupId: 'g2', title: 'Planilha', url: 'https://planilha.example/' }, { id: 'w2', groupId: 'g2', title: 'Agenda', url: 'https://agenda.example/' });
    data.settings.clean = { ...data.settings.clean, on: true, links: 'icon', group: 'g2', font: 'inter' };
    await x.seed(p, { nt_data: data });
    await p.reload();
    await p.locator('#clLinks.icons').waitFor();
    assert.equal(await p.locator('#clLinks .cl-name').count(), 0);
    assert.deepEqual(await p.$$eval('#clLinks .cl-link', (as) => as.map((a) => a.dataset.id)), ['w1', 'w2'], 'atalhos do grupo escolhido');
    assert.match(await p.evaluate(() => getComputedStyle(document.querySelector('#clClock')).fontFamily), /Inter NT/);
    // desliga com Alt+Z: tudo volta como estava (busca no lugar de sempre)
    await p.keyboard.press('Alt+z');
    await p.locator('#clean[hidden]').waitFor({ state: 'attached' });
    assert.equal(await p.locator('#widgets .widget').count(), widgets);
    assert.equal(await p.locator('#center > #omniWrap, #widgets #omniWrap').count(), 1);
    assert.equal(await p.isVisible('#omni'), true);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Modo Clean: nada sobreposto em 1366×768, 1920×1080 e celular; opções nas Configurações', async () => {
  const x = await launch({ viewport: { width: 1366, height: 768 } });
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { userName: 'Marcos', clean: { on: true, seconds: true, h12: true } });
    for (const [w, hgt] of [[1366, 768], [1920, 1080], [400, 860]]) {
      await p.setViewportSize({ width: w, height: hgt });
      await p.waitForTimeout(250);
      const r = await p.evaluate(() => Object.fromEntries(['#clClock', '#clLinks', '#clOmniSlot', '#clDate', '.cl-top-r', '.voice-fab'].map((s) => [s, document.querySelector(s)?.getBoundingClientRect().toJSON()])));
      assert.ok(!overlap(r['#clClock'], r['#clLinks']), `relógio × atalhos em ${w}`);
      assert.ok(!overlap(r['#clClock'], r['#clOmniSlot']), `relógio × busca em ${w}`);
      assert.ok(!overlap(r['#clLinks'], r['.voice-fab']), `atalhos × 🎙 em ${w}`);
      assert.ok(r['#clClock'].x >= 0 && r['#clClock'].x + r['#clClock'].width <= w + 1, `relógio cabe em ${w}`);
    }
    assert.equal(await p.locator('#clClock .cl-sec').count(), 1);
    assert.equal(await p.locator('#clClock .cl-ampm').count(), 1);
    const o = await x.open('src/options.html#clean');
    assert.equal(await o.isChecked('#cleanOn'), true);
    assert.ok(await o.locator('#cleanGroup option').count() >= 2);
    await o.selectOption('#cleanFont', 'georgia');
    await o.waitForTimeout(400);
    assert.equal((await x.storage(o, 'nt_data')).settings.clean.font, 'georgia');
    assert.match(await o.evaluate(() => document.querySelector('#cleanFontPv').style.fontFamily), /Georgia/);
    await o.click('label:has(#cleanOn)');
    await o.waitForTimeout(400);
    assert.equal((await x.storage(o, 'nt_data')).settings.clean.on, false);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
