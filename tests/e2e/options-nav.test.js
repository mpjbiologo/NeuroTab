// Configurações (#46): categorias na lateral com sub-abas, uma página por vez, busca, links antigos,
// voltar/avançar do navegador e gaveta em telas estreitas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const visible = (p) => p.$$eval('.pane', (ps) => ps.filter((x) => !x.hidden).map((x) => x.dataset.page));

test('lateral com sub-abas, links antigos, busca e histórico', async () => {
  const x = await launch({ viewport: { width: 1440, height: 900 } });
  try {
    const p = await x.open('src/options.html');
    assert.deepEqual(await visible(p), ['tema'], 'abre em Aparência › Tema, uma página por vez');
    assert.equal(await p.locator('.tabs').count(), 0, 'sem abas no topo');
    // todas as sub-abas existem e cada uma tem conteúdo
    const pages = await p.$$eval('.pane', (els) => els.map((e) => e.dataset.page));
    assert.equal(pages.length, 32, '11 categorias, 32 páginas');
    assert.equal(await p.locator('.side-cat').count(), 11);
    for (const id of pages) assert.ok((await p.textContent(`#page-${id}`)).trim().length > 20, `página vazia: ${id}`);
    // categoria com sub-abas abre e só ela fica aberta
    await p.click('.side-cat:has-text("Voz")');
    await p.click('a.side-link[data-page="voz-leitura"]');
    assert.deepEqual(await visible(p), ['voz-leitura']);
    assert.match(await p.textContent('#crumb'), /Voz\s*›\s*Leitura em voz alta/);
    assert.equal(await p.locator('.side-group.open').count(), 1);
    assert.ok(p.url().endsWith('#voz-leitura'));
    // voltar do navegador
    await p.goBack();
    await p.waitForFunction(() => !document.querySelector('#page-tema').hidden);
    // links antigos (#ia, #notas, #backup…) continuam levando ao lugar certo
    for (const [old, page] of [['ia', 'ia'], ['notas', 'keep'], ['backup', 'importar'], ['midia', 'imagens'], ['geral', 'tema'], ['contas', 'contas']]) {
      await p.evaluate((h) => { location.hash = h; }, old);
      await p.waitForFunction((pg) => !document.querySelector('#page-' + pg).hidden, page);
    }
    // busca: filtra a lateral e Enter abre a primeira
    await p.keyboard.press('Escape');
    await p.locator('body').click({ position: { x: 900, y: 20 } });
    await p.keyboard.press('/');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'setSearch', '"/" vai para a busca');
    await p.keyboard.type('whisper');
    const found = await p.$$eval('.side-link', (els) => els.filter((e) => !e.parentElement.hidden && e.closest('.side-group:not([hidden])')).map((e) => e.dataset.page));
    assert.equal(found[0], 'voz');
    assert.ok(found.every((f) => f.startsWith('voz')), 'só páginas de voz: ' + found);
    await p.keyboard.press('Enter');
    assert.deepEqual(await visible(p), ['voz']);
    await p.fill('#setSearch', 'xyzabc');
    assert.equal(await p.isVisible('.side-empty'), true);
    await p.press('#setSearch', 'Escape');
    assert.equal(await p.locator('.side-group[hidden]').count(), 0);
    // doar leva à página Apoie
    await p.click('#donateBtn');
    assert.deepEqual(await visible(p), ['apoie']);
    // opções simples lado a lado: a página usa a largura (2 colunas na tela grande)
    await p.evaluate(() => { location.hash = 'layout'; });
    await p.waitForFunction(() => !document.querySelector('#page-layout').hidden);
    const xs = await p.$$eval('#page-layout > .opt:not(.wide)', (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    assert.ok(xs.length >= 2, 'duas colunas de opções');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('celular: a lateral vira gaveta', async () => {
  const x = await launch({ viewport: { width: 390, height: 800 } });
  try {
    const p = await x.open('src/options.html#pesquisa');
    const box = async () => (await p.locator('#side').boundingBox());
    assert.ok((await box()).x + (await box()).width <= 1, 'gaveta fechada fora da tela');
    await p.click('#menuBtn');
    await p.waitForTimeout(350);
    assert.ok((await box()).x >= -1, 'gaveta aberta');
    assert.equal(await p.getAttribute('#menuBtn', 'aria-expanded'), 'true');
    await p.click('.side-cat:has-text("Backup")');
    await p.click('a.side-link[data-page="exportar"]');
    await p.waitForTimeout(350);
    assert.deepEqual(await visible(p), ['exportar']);
    assert.ok((await box()).x + (await box()).width <= 1, 'escolher fecha a gaveta');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
