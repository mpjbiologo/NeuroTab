// Clima: escolher a cidade pela busca (o pedido de consentimento acontece no clique) e ver a temperatura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

test('definir cidade pela busca e mostrar o clima', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html', { wait: 1200 });
    await p.click('#heroWx');
    await p.waitForSelector('#wxPop input');
    await p.fill('#wxPop input', 'Lisboa');
    await p.press('#wxPop input', 'Enter');
    await p.waitForSelector('#wxPop .item');
    await p.click('#wxPop .item');
    await p.waitForTimeout(800);
    const places = (await x.storage(p, 'nt_data')).settings.places;
    assert.equal(places[0].name, 'Lisboa');
    assert.match(await p.textContent('#heroWx'), /24°/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
