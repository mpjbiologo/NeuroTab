// Fumaça: as páginas abrem sem erros de JavaScript nos três idiomas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

for (const [locale, word] of [['pt-BR', 'Captura rápida'], ['en-US', 'Quick capture'], ['es-ES', 'Captura rápida']]) {
  test(`nova aba, configurações e popup abrem sem erros (${locale})`, async () => {
    const x = await launch({ locale });
    try {
      const nt = await x.open('src/newtab.html', { wait: 1200 });
      assert.ok(await nt.isVisible('#clock'), 'relógio visível');
      assert.ok((await nt.textContent('body')).includes(word), `widget de captura em ${locale}`);
      const opt = await x.open('src/options.html');
      // todas as sub-abas da lateral abrem sem erro
      for (const page of await opt.$$eval('.side-link', (els) => els.map((e) => e.dataset.page))) {
        await opt.evaluate((pg) => { location.hash = pg; }, page);
        await opt.waitForSelector(`#page-${page}:not([hidden])`);
      }
      await x.open('src/popup.html');
      assert.deepEqual(x.errors, []);
    } finally {
      await x.close();
    }
  });
}
