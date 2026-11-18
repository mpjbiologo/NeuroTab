// Sistema de design (#51): temas nas Opções valem na nova aba; ícones desenhados com nome acessível.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

test('tema escolhido nas Opções vale na nova aba (e já na próxima abertura, sem piscar)', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'futurista', 'padrão');
    const o = await x.open('src/options.html');
    assert.equal(await o.getAttribute('.theme-card[data-id="futurista"]', 'aria-checked'), 'true');
    await o.click('.theme-card[data-id="calorosa"]');
    await o.waitForTimeout(300);
    assert.equal(await o.evaluate(() => document.documentElement.dataset.theme), 'calorosa');
    assert.equal((await x.storage(o, 'nt_data')).settings.theme, 'calorosa');
    // a nova aba aberta acompanha
    await p.waitForFunction(() => document.documentElement.dataset.theme === 'calorosa');
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(bg, 'rgb(20, 20, 24)');
    // aba nova: o tema já está no <html> antes do JavaScript da página (theme-boot.js)
    const n = await x.open('src/newtab.html', { wait: 0 });
    await n.waitForLoadState('domcontentloaded');
    assert.equal(await n.evaluate(() => document.documentElement.dataset.theme), 'calorosa');
    // teclado nas Opções: setas trocam o tema
    await o.focus('.theme-card[data-id="calorosa"]');
    await o.keyboard.press('ArrowRight');
    await o.waitForTimeout(300);
    assert.equal((await x.storage(o, 'nt_data')).settings.theme, 'futurista');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('ícones desenhados: sem emoji nos títulos e botões; botão só com ícone tem nome', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const emoji = /\p{Extended_Pictographic}/u;
      const titles = [...document.querySelectorAll('.widget > header .wt')];
      const btns = [...document.querySelectorAll('.widget button, .rail-btn:not(.rail-groups .rail-btn), #voiceFab')].filter((b) => !b.closest('.rail-groups'));
      return {
        titles: titles.length,
        titleIcons: titles.filter((t) => t.querySelector('svg.ico')).length,
        emojiTitles: titles.filter((t) => emoji.test(t.textContent)).map((t) => t.textContent),
        unnamed: btns.filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label')).map((b) => b.outerHTML.slice(0, 80)),
        emojiBtns: btns.filter((b) => emoji.test(b.textContent)).map((b) => b.textContent.trim()).slice(0, 5),
      };
    });
    assert.ok(r.titles >= 4);
    assert.equal(r.titleIcons, r.titles, 'todo título de widget tem ícone');
    assert.deepEqual(r.emojiTitles, []);
    assert.deepEqual(r.unnamed, [], 'botões só com ícone têm aria-label');
    assert.deepEqual(r.emojiBtns, []);
    // texto trocado depois ("▶" → "⏸") também vira ícone
    await p.evaluate(() => { const b = document.createElement('button'); b.id = 'tst'; b.title = 'Teste'; b.textContent = '▶'; document.querySelector('.widget .wbody').append(b); });
    await p.waitForSelector('#tst svg[data-icon="play"]');
    await p.evaluate(() => { document.querySelector('#tst').textContent = '⏸ Pausar'; });
    await p.waitForSelector('#tst svg[data-icon="pause"]');
    assert.equal((await p.textContent('#tst')).trim(), 'Pausar');
  } finally {
    await x.close();
  }
});
