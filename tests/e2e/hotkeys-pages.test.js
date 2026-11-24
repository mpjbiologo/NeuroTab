// Atalhos de teclado editáveis (Sistema → Teclado) e várias páginas de widgets (#75).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const settingsOf = (p) => p.evaluate(async () => (await chrome.storage.local.get('nt_data')).nt_data.settings);

test('teclado: mudar o atalho do Modo Clean, desligar e voltar ao padrão', async () => {
  const x = await launch();
  try {
    const o = await x.open('src/options.html#teclado');
    const row = o.locator('[data-action=clean]');
    await row.waitFor();
    assert.match(await row.textContent(), /Alt\+Z.*painel da NVIDIA/);
    await o.click('[data-hk=clean]');
    await o.locator('[data-hk=clean].rec').waitFor();
    await o.keyboard.press('Alt+Shift+KeyX');
    await row.locator('kbd', { hasText: 'Alt+Shift+X' }).waitFor();
    assert.equal((await settingsOf(o)).hotkeys.clean, 'Alt+Shift+X');
    // conflito: Alt+C já é do modo conversa
    await o.click('[data-hk=voice]');
    await o.keyboard.press('Alt+KeyC');
    await o.locator('[data-action=voice] .hk-warn', { hasText: 'Modo conversa' }).waitFor();
    // a nova aba obedece na hora
    const p = await x.open('src/newtab.html');
    await p.keyboard.press('Alt+KeyZ');
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => document.body.classList.contains('clean-mode')), false, 'Alt+Z não abre mais (NVIDIA)');
    await p.keyboard.press('Alt+Shift+KeyX');
    await p.waitForFunction(() => document.body.classList.contains('clean-mode'));
    await p.keyboard.press('Alt+Shift+KeyX');
    await p.waitForFunction(() => !document.body.classList.contains('clean-mode'));
    // Ctrl+K continua indo para a busca; desligado, não vai
    await p.keyboard.press('Control+KeyK');
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'omni');
    await p.evaluate(() => document.activeElement.blur());
    await o.bringToFront();
    await o.click('[data-off=search]');
    await o.locator('[data-action=search] kbd.off').waitFor();
    await p.bringToFront();
    await p.waitForFunction(async () => (await chrome.storage.local.get('nt_data')).nt_data.settings.hotkeys.search === '');
    await p.waitForTimeout(300);
    await p.keyboard.press('Control+KeyK');
    assert.notEqual(await p.evaluate(() => document.activeElement?.id), 'omni');
    assert.match(await p.getAttribute('#omni', 'placeholder'), /…\s*$/, 'a dica do atalho some do campo');
    // voltar tudo ao padrão
    await o.bringToFront();
    await o.click('#hkResetAll');
    await o.waitForFunction(async () => Object.keys((await chrome.storage.local.get('nt_data')).nt_data.settings.hotkeys).length === 0);
    assert.ok(await o.locator('#hkGlobal .opt').count() >= 2, 'mostra os atalhos de qualquer aba');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('páginas: criar, trocar (pontinhos, setas, teclado, deslizar, voz), mover widget e apagar', async () => {
  const x = await launch({ voice: true });
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { widgets: [{ id: 'brain', w: 6 }, { id: 'clock', w: 6 }] });
    assert.equal(await p.isVisible('#pager'), false, 'uma página só: nada muda');
    // criar pelo modo de edição
    await p.click('#editLayout');
    await p.evaluate(() => { window.prompt = () => 'Trabalho'; }); // o helper aceita os diálogos sozinho
    await p.click('#pageAdd');
    await p.locator('#pager .pg-dot').nth(1).waitFor();
    await p.waitForFunction(async () => { const s = (await chrome.storage.local.get('nt_data')).nt_data.settings; return s.pages[1] && s.page === s.pages[1].id; }); // abre a página nova
    let s = await settingsOf(p);
    assert.deepEqual(s.pages.map((g) => g.name), ['Início', 'Trabalho']);
    await p.locator('#widgets .widget').first().waitFor({ state: 'detached' }); // página nova, vazia
    // adicionar um widget nesta página
    await p.click('#addWidget');
    await p.locator('#widgetList button', { hasText: 'Agenda' }).first().click();
    await p.locator('#widgets .widget[data-id=agenda]').waitFor();
    await p.click('#doneEdit');
    // pontinhos
    await p.locator('#pager .pg-dot').first().click();
    await p.locator('#widgets .widget[data-id=brain]').waitFor();
    assert.equal(await p.locator('#widgets .widget[data-id=agenda]').count(), 0);
    // teclado: Alt+2 e Alt+[
    await p.keyboard.press('Alt+Digit2');
    await p.locator('#widgets .widget[data-id=agenda]').waitFor();
    await p.keyboard.press('Alt+BracketLeft');
    await p.locator('#widgets .widget[data-id=brain]').waitFor();
    // seta (aparece ao passar o mouse)
    await p.hover('#clock');
    await p.click('#pager .pg-arrow.next');
    await p.locator('#widgets .widget[data-id=agenda]').waitFor();
    // deslizar no touchpad
    await p.hover('#clock');
    for (let i = 0; i < 6; i++) await p.mouse.wheel(-40, 0);
    await p.locator('#widgets .widget[data-id=brain]').waitFor();
    // voz
    await p.click('#voiceFab');
    await p.waitForTimeout(150);
    await p.evaluate(() => { window.__lastSR.say('ir para a página trabalho'); window.__lastSR.stop(); });
    await p.locator('#voiceReply', { hasText: 'Página Trabalho.' }).waitFor();
    await p.locator('#widgets .widget[data-id=agenda]').waitFor();
    await p.keyboard.press('Escape');
    // mover um widget da página 1 para a 2
    await p.keyboard.press('Alt+Digit1');
    await p.locator('#widgets .widget[data-id=brain]').waitFor();
    await p.click('#editLayout');
    await p.locator('.widget[data-id=brain] .wpage').click();
    await p.locator('.pg-menu button', { hasText: 'Trabalho' }).click();
    await p.locator('#widgets .widget[data-id=brain]').waitFor({ state: 'detached' });
    await p.waitForFunction(async () => (await chrome.storage.local.get('nt_data')).nt_data.settings.pages[1].widgets.length === 2);
    s = await settingsOf(p);
    assert.deepEqual(s.pages[1].widgets.map((w) => w.id), ['agenda', 'brain']);
    // abrir sempre na primeira; relógio só na primeira
    await p.keyboard.press('Alt+Digit2');
    await p.locator('#widgets .widget[data-id=agenda]').waitFor();
    await p.click('#doneEdit');
    const o = await x.open('src/options.html#paginas');
    await o.locator('#pagesList [data-pg]').nth(1).waitFor();
    await o.selectOption('[data-k="pagesNav.start"]', 'first');
    await o.locator('label.sw:has([data-k="pagesNav.clockAll"])').click();
    await o.waitForFunction(async () => { const s = (await chrome.storage.local.get('nt_data')).nt_data.settings; return s.pagesNav.start === 'first' && s.pagesNav.clockAll === false; });
    const p2 = await x.open('src/newtab.html');
    await p2.locator('#widgets .widget[data-id=clock]').waitFor();
    assert.ok(await p2.isVisible('#clock'));
    await p2.keyboard.press('Alt+Digit2');
    await p2.locator('#widgets .widget[data-id=agenda]').waitFor();
    assert.equal(await p2.isVisible('#clock'), false, 'relógio só na primeira');
    assert.ok(await p2.isVisible('#pager'), 'os pontinhos continuam');
    // apagar a página "Trabalho" levando os widgets para a primeira
    await o.bringToFront();
    await o.reload();
    await o.locator('#pagesList [data-pg]').nth(1).locator('button[title=Apagar]').click();
    await o.waitForFunction(async () => (await chrome.storage.local.get('nt_data')).nt_data.settings.pages.length === 0);
    s = await settingsOf(o);
    assert.deepEqual(s.widgets.map((w) => w.id).sort(), ['agenda', 'brain', 'clock']);
    await p2.bringToFront();
    await p2.locator('#pager').waitFor({ state: 'hidden' });
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
