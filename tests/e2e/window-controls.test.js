// Maximizar, minimizar e restaurar widgets (#18), no modo grade e no modo livre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const rect = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; });

for (const mode of ['grid', 'free']) {
  test(`controles de janela no modo ${mode === 'grid' ? 'grade' : 'livre'}`, async () => {
    const x = await launch({ viewport: { width: 1366, height: 850 } });
    try {
      const p = await x.open('src/newtab.html');
      const data = await x.storage(p, 'nt_data');
      data.settings.layoutMode = mode;
      data.settings.widgets = [{ id: 'calc', w: 4 }, { id: 'capture', w: 4 }, { id: 'reminders', w: 4 }];
      await x.seed(p, { nt_data: data });
      const card = '.widget[data-id="calc"]';
      await p.fill(`${card} input`, '2+3'); // estado do widget, para conferir que não se perde
      const before = await rect(p, card);

      // Maximizar: ocupa a área útil, sem sair da tela nem cobrir a barra de atalhos e o botão de voz
      await p.click(`${card} .wwin-max`);
      const big = await rect(p, card);
      const vw = 1366; const vh = 850;
      assert.ok(big.w > vw * 0.6 && big.h > vh * 0.75, `maximizado grande: ${JSON.stringify(big)}`);
      assert.ok(big.l >= 0 && big.t >= 0 && big.r <= vw && big.b <= vh, 'dentro da tela');
      const fab = await rect(p, '.voice-fab');
      assert.ok(big.r <= fab.l, 'não cobre o botão de voz');
      const rail = await p.$eval('.dock', (e) => e.getBoundingClientRect().right);
      assert.ok(big.l >= rail, 'não cobre a barra de atalhos');
      assert.equal(await p.inputValue(`${card} input`), '2+3', 'o conteúdo continua');
      assert.equal(await p.locator('.wmax-backdrop').count(), 1);

      // Esc restaura o tamanho e a posição de antes
      await p.keyboard.press('Escape');
      assert.deepEqual(await rect(p, card), before);
      assert.equal(await p.locator('.wmax-backdrop').count(), 0);

      // Clique fora também restaura
      await p.click(`${card} .wwin-max`);
      await p.mouse.click(700, 6); // no fundo escurecido, acima do widget
      assert.deepEqual(await rect(p, card), before);

      // Minimizar: só o cabeçalho; fica salvo; restaurar devolve o conteúdo
      await p.click(`${card} .wwin-min`);
      assert.equal(await p.isVisible(`${card} .wbody`), false);
      const small = await rect(p, card);
      assert.ok(small.h < 70, `minimizado baixo: ${small.h}`);
      await p.waitForTimeout(300);
      const saved = await x.storage(p, 'nt_data');
      assert.equal(saved.settings.widgets[0].min, true, 'estado salvo');
      const p2 = await x.open('src/newtab.html');
      assert.equal(await p2.isVisible(`${card} .wbody`), false, 'continua minimizado ao abrir outra aba');
      await p2.click(`${card} .wwin-min`);
      assert.equal(await p2.isVisible(`${card} .wbody`), true);
      await p2.waitForTimeout(300);
      assert.equal((await x.storage(p2, 'nt_data')).settings.widgets[0].min, undefined);
      assert.deepEqual(x.errors, []);
    } finally {
      await x.close();
    }
  });
}

for (const mode of ['grid', 'free']) {
  test(`maximizado fica salvo: aba nova e recarregar voltam maximizadas (${mode === 'grid' ? 'grade' : 'livre'})`, async () => {
    const x = await launch({ viewport: { width: 1366, height: 850 } });
    try {
      const p = await x.open('src/newtab.html');
      const data = await x.storage(p, 'nt_data');
      data.settings.layoutMode = mode;
      data.settings.widgets = [{ id: 'calc', w: 4 }, { id: 'capture', w: 4, min: true }, { id: 'reminders', w: 4 }];
      await x.seed(p, { nt_data: data });
      const ws = async (pg) => (await x.storage(pg, 'nt_data')).settings.widgets.map((w) => `${w.id}:${w.max ? 'max' : w.min ? 'min' : '-'}`);

      await p.click('.widget[data-id="calc"] .wwin-max');
      await p.waitForTimeout(300);
      assert.deepEqual(await ws(p), ['calc:max', 'capture:min', 'reminders:-']);

      // Aba nova: volta maximizado, com o foco na busca (não no botão do widget)
      const p2 = await x.open('src/newtab.html');
      await p2.waitForSelector('.widget[data-id="calc"].maximized');
      assert.equal(await p2.locator('.wmax-backdrop').count(), 1);
      assert.equal(await p2.evaluate(() => document.activeElement?.classList.contains('wwin-max')), false);
      assert.equal(await p2.isVisible('.widget[data-id="capture"] .wbody'), false, 'o minimizado continua minimizado');

      // Maximizar outro: só um fica marcado; maximizar um minimizado tira o "minimizado"
      await p2.click('.widget[data-id="calc"] .wwin-max'); // restaura
      await p2.click('.widget[data-id="capture"] .wwin-max');
      await p2.waitForTimeout(300);
      assert.deepEqual(await ws(p2), ['calc:-', 'capture:max', 'reminders:-']);
      // a outra aba aberta acompanha
      await p.waitForSelector('.widget[data-id="capture"].maximized');
      assert.equal(await p.locator('.widget.maximized').count(), 1);

      // Recarregar mantém; Esc desfaz e apaga o estado salvo
      await p2.reload();
      await p2.waitForSelector('.widget[data-id="capture"].maximized');
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(300);
      assert.deepEqual(await ws(p2), ['calc:-', 'capture:-', 'reminders:-']);
      const p3 = await x.open('src/newtab.html');
      await p3.waitForTimeout(500);
      assert.equal(await p3.locator('.widget.maximized').count(), 0);
      assert.deepEqual(x.errors, []);
    } finally {
      await x.close();
    }
  });
}
