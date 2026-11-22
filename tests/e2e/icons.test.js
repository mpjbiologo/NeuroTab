// Ícones dos atalhos em alta resolução (fonte do Google/DuckDuckGo com permissão; guardados em 96 px).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, png, extWith } from './helpers.js';

test('ícones dos atalhos em alta resolução: fonte do Google, 96 px guardados, ícones próprios intocados', async () => {
  const ext = extWith((m) => { m.host_permissions.push('https://t1.gstatic.com/*'); });
  const x = await launch({ ext });
  try {
    let asked = 0;
    await x.ctx.route('https://t1.gstatic.com/**', (r) => { asked++; return r.fulfill({ status: 200, contentType: 'image/png', body: png(128, 128) }); });
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.links[0].icon = { kind: 'emoji', value: '⭐' };
    await x.seed(p, { nt_data: data });
    const o = await x.open('src/options.html#estilo-atalhos');
    await o.selectOption('#iconSource', 'google');
    await o.locator('.toast', { hasText: 'atualizado' }).waitFor({ timeout: 30000 });
    const d = await x.storage(o, 'nt_data');
    assert.equal(d.settings.iconSource, 'google');
    assert.ok(asked >= 1, 'buscou na fonte escolhida');
    const sizes = await o.evaluate((list) => Promise.all(list.map((src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i.width); i.onerror = () => r(0); i.src = src; }))), d.links.slice(1).map((l) => l.favicon));
    assert.ok(sizes.every((w) => w === 96), 'todos guardados em 96 px: ' + sizes);
    assert.deepEqual(d.links[0].icon, { kind: 'emoji', value: '⭐' });
    assert.match(await o.textContent('#iconSourceState'), /Ligado/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
