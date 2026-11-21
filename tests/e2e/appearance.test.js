// 0.7.8 "Do seu jeito": barra que se esconde (#64), estilo dos atalhos (#59), editor visual e "Como foi hoje?" (#58).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, png } from './helpers.js';

const until = async (fn, ms = 8000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 150)); } };
const shown = (p) => p.evaluate(() => document.body.classList.contains('dock-show'));

test('barra que se esconde: borda, alça, teclado, 📌 e configurações', async () => {
  const x = await launch();
  try {
    const o = await x.open('src/options.html#layout');
    assert.equal(await o.isHidden('#dockDelayOpt'), true, 'tempo só aparece quando esconde');
    await o.selectOption('#dockMode', 'auto');
    await o.waitForTimeout(300);
    assert.equal(await o.isVisible('#dockDelayOpt'), true);
    assert.equal(await o.isHidden('#dockPinOpt'), true);
    assert.equal((await x.storage(o, 'nt_data')).settings.dockMode, 'auto');

    const p = await x.open('src/newtab.html');
    assert.equal(await p.evaluate(() => document.body.classList.contains('dock-hide')), true);
    assert.equal(await shown(p), false);
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#center')).marginLeft), '0px', 'conteúdo usa a tela toda');
    const box = await p.locator('#dock').boundingBox();
    assert.ok(box.x + box.width <= 0, 'fora da tela');
    // chegar perto da borda traz a barra; afastar esconde depois do tempo
    await p.mouse.move(600, 400);
    await p.mouse.move(6, 400);
    await p.waitForTimeout(450);
    assert.equal(await shown(p), true);
    await p.mouse.move(40, 400); // em cima da barra: fica
    await p.waitForTimeout(1000);
    assert.equal(await shown(p), true, 'não some com o mouse em cima');
    await p.mouse.move(700, 400);
    await p.waitForTimeout(1200);
    assert.equal(await shown(p), false);
    // teclado: Ctrl+. abre com foco no primeiro grupo; Esc fecha
    await p.keyboard.press('Control+.');
    await p.waitForTimeout(350);
    assert.equal(await shown(p), true);
    assert.equal(await p.evaluate(() => document.activeElement.classList.contains('rail-btn')), true);
    await p.waitForTimeout(1000);
    assert.equal(await shown(p), true, 'com foco do teclado, não some');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    assert.equal(await shown(p), false);
    // a alça também abre (alternativa ao mouse: Esc devolveu o foco para ela) e o 📌 segura aberta
    assert.equal(await p.evaluate(() => document.activeElement.id), 'dockHandle');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(350);
    assert.equal(await shown(p), true);
    await p.click('#pinDock');
    assert.equal(await p.getAttribute('#pinDock', 'aria-pressed'), 'true');
    await p.mouse.move(700, 400);
    await p.mouse.click(700, 120);
    await p.waitForTimeout(1300);
    assert.equal(await shown(p), true, 'segurada pelo 📌');
    assert.equal((await x.storage(p, 'nt_data')).settings.dockPinned, false, '📌 não muda a configuração');
    await p.click('#pinDock');
    await p.mouse.move(700, 400);
    await p.waitForTimeout(1300);
    assert.equal(await shown(p), false);

    // recolhida no rodapé: só pela alça
    await x.settings(p, { dockMode: 'collapsed', dockPosition: 'bottom' });
    assert.equal(await p.isVisible('#dockHandle'), true);
    await p.mouse.move(600, 845);
    await p.waitForTimeout(300);
    assert.equal(await shown(p), false, 'recolhida não abre pela borda');
    await p.click('#dockHandle');
    await p.waitForTimeout(350);
    assert.equal(await shown(p), true);
    await p.mouse.click(600, 300);
    await p.waitForTimeout(300);
    assert.equal(await shown(p), false, 'clicar fora fecha');

    // restaurar volta ao padrão
    await o.click('#dockReset');
    await o.waitForTimeout(300);
    const s = (await x.storage(o, 'nt_data')).settings;
    assert.deepEqual([s.dockMode, s.dockPosition], ['always', 'left']);
    await p.waitForFunction(() => !document.body.classList.contains('dock-hide'));
    assert.equal(await p.isHidden('#dockHandle'), true);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('estilo dos atalhos: presets, prévia, ícone e formato próprios, reserva', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.widgets.unshift({ id: 'shortcuts', size: 'l' });
    data.links[0].favicon = 'data:image/png;base64,AAAA'; // quebrado: cai na letra
    await x.seed(p, { nt_data: data });
    const tile = (i) => p.locator('.widget .grid .tile').nth(i);
    assert.equal(await tile(1).getAttribute('data-shape'), 'classic');
    await p.waitForTimeout(300);
    assert.equal(await tile(0).locator('.tic-letter').textContent(), 'G', 'favicon quebrado vira a inicial');

    const o = await x.open('src/options.html#estilo-atalhos');
    assert.equal(await o.getAttribute('.tile-preset[data-id="classico"]', 'aria-checked'), 'true');
    assert.ok(await o.locator('#tilePreview .tile').count() >= 3, 'prévia com atalhos');
    await o.click('.tile-preset[data-id="bolha"]');
    await o.waitForTimeout(300);
    let s = (await x.storage(o, 'nt_data')).settings;
    assert.equal(s.tiles.shape, 'circle');
    assert.equal(s.tileRadius, 12);
    assert.equal(await o.inputValue('[data-k="tiles.shape"]'), 'circle');
    await p.waitForFunction(() => document.querySelector('.widget .grid .tile')?.dataset.shape === 'circle');
    // uma cor só: aparece o campo da cor
    assert.equal(await o.isHidden('#tileColorOpt'), true);
    await o.selectOption('#tileFill', 'single');
    await o.waitForTimeout(300);
    assert.equal(await o.isVisible('#tileColorOpt'), true);
    await o.selectOption('[data-k="tiles.size"]', 'l');
    await o.waitForTimeout(300);
    assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tile-scale').trim()), '1.2');

    // atalho com emoji e formato próprio
    await tile(1).click({ button: 'right' });
    await p.click('.ctx button:has-text("Editar")');
    await p.click('#linkLook summary');
    await p.selectOption('[name="iconKind"]', 'emoji');
    await p.fill('[name="iconText"]', '🎬');
    await p.selectOption('[name="shape"]', 'square');
    assert.equal(await p.locator('#preview .tile').getAttribute('data-shape'), 'square');
    assert.equal(await p.locator('#preview .tic-emoji').textContent(), '🎬');
    await p.click('#linkForm button[value="ok"]');
    let l = await until(async () => { const v = (await x.storage(p, 'nt_data')).links[1]; return v.icon ? v : null; });
    assert.deepEqual(l.icon, { kind: 'emoji', value: '🎬' });
    assert.equal(l.shape, 'square');
    assert.equal(await tile(1).getAttribute('data-shape'), 'square');
    // imagem enviada: arquivo errado é recusado; PNG vira ícone de 64 px
    await tile(2).click({ button: 'right' });
    await p.click('.ctx button:has-text("Editar")');
    await p.click('#linkLook summary');
    p.once('filechooser', (fc) => fc.setFiles([]).catch(() => {}));
    await p.selectOption('[name="iconKind"]', 'image');
    await p.setInputFiles('[name="iconFile"]', { name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
    assert.match(await p.textContent('#iconErr'), /Formato/);
    await p.setInputFiles('[name="iconFile"]', { name: 'logo.png', mimeType: 'image/png', buffer: png(200, 120) });
    await p.waitForFunction(() => document.querySelector('#preview .tic img')?.src.startsWith('data:image/png'));
    assert.equal(await p.textContent('#iconErr'), '');
    await p.click('#linkForm button[value="ok"]');
    l = await until(async () => { const v = (await x.storage(p, 'nt_data')).links[2]; return v.icon ? v : null; });
    assert.equal(l.icon.kind, 'image');
    const dim = await p.evaluate((src) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = src; }), l.icon.src);
    assert.deepEqual(dim, [64, 64]);
    // painel da barra usa o mesmo ícone
    await p.hover('#railGroups .rail-btn');
    await p.waitForSelector('#panel:not([hidden])');
    assert.equal(await p.locator('#panelLinks .plink').nth(1).locator('.tic-emoji').textContent(), '🎬');
    // restaurar a aparência do atalho
    await tile(1).click({ button: 'right' });
    await p.click('.ctx button:has-text("Editar")');
    await p.click('#lookReset');
    await p.click('#linkForm button[value="ok"]');
    l = await until(async () => { const v = (await x.storage(p, 'nt_data')).links[1]; return v.icon ? null : v; });
    assert.equal('icon' in l, false);
    assert.equal('shape' in l, false);
    // restaurar o estilo geral não mexe nos atalhos
    await o.click('#tileReset');
    await o.waitForTimeout(300);
    s = (await x.storage(o, 'nt_data'));
    assert.equal(s.settings.tiles.shape, 'classic');
    assert.equal(s.links.length, data.links.length);
    assert.equal(s.links[2].icon.kind, 'image', 'ícones próprios ficam');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('editor visual: prévia sem aplicar, aplicar, temas salvos, arquivo, avisos e reset', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    const o = await x.open('src/options.html#editor');
    assert.equal(await o.isVisible('#page-editor'), true);
    assert.equal(await o.isDisabled('#edApply'), true, 'nada para aplicar ainda');
    // paleta muda só a prévia
    await o.click('.ed-pal:has-text("Oceano")');
    assert.equal(await o.isVisible('#edDirty'), true);
    assert.equal(await o.evaluate(() => getComputedStyle(document.querySelector('#edPreview')).getPropertyValue('--accent').trim()), '#38bdf8');
    assert.equal(await p.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '', 'nova aba ainda igual');
    // cancelar descarta
    await o.click('#edCancel');
    assert.equal(await o.isHidden('#edDirty'), true);
    // ajustar e aplicar
    await o.click('.ed-pal:has-text("Oceano")');
    await o.selectOption('#edWidget', 'solid');
    await o.selectOption('#edDensity', 'compact');
    await o.click('#edApply');
    await o.waitForTimeout(400);
    let s = (await x.storage(o, 'nt_data')).settings;
    assert.equal(s.look.accent, '#38bdf8');
    assert.equal(s.look.widgetStyle, 'solid');
    assert.equal(s.theme, 'futurista');
    await p.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent') === '#38bdf8');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.wstyle), 'solid');
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.widget')).backdropFilter), 'none');
    // a próxima aba já abre com os ajustes (theme-boot.js), sem piscar
    const n = await x.open('src/newtab.html', { wait: 0 });
    await n.waitForLoadState('domcontentloaded');
    assert.equal(await n.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '#38bdf8');
    assert.equal(await o.isVisible('#lookNote'), false, 'aviso fica na página Tema');

    // salvar como tema, duplicar, excluir (prompt aceita o nome sugerido)
    await o.evaluate(() => { window.prompt = (_m, d) => d; });
    await o.click('#edSave');
    await o.waitForTimeout(300);
    s = (await x.storage(o, 'nt_data')).settings;
    assert.equal(s.customThemes.length, 1);
    assert.equal(s.customThemes[0].look.accent, '#38bdf8');
    assert.equal(await o.locator('.ed-theme.on').count(), 1, 'marcado como em uso');
    await o.click('.ed-theme button:has-text("Duplicar")');
    await o.waitForTimeout(300);
    assert.equal((await x.storage(o, 'nt_data')).settings.customThemes.length, 2);
    await o.locator('.ed-theme').nth(1).locator('button:has-text("Excluir")').click();
    await o.waitForTimeout(300);
    assert.equal((await x.storage(o, 'nt_data')).settings.customThemes.length, 1);

    // exportar e importar
    const [dl] = await Promise.all([o.waitForEvent('download'), o.click('#edExport')]);
    const file = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    assert.equal(file.format, 'neurotab-theme');
    assert.equal(file.look.accent, '#38bdf8');
    await o.setInputFiles('#edImport', { name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...file, name: 'Importado', look: { ...file.look, accent: '#ff00aa' } })) });
    await o.waitForTimeout(400);
    s = (await x.storage(o, 'nt_data')).settings;
    assert.equal(s.customThemes.at(-1).name, 'Importado');
    assert.equal(s.look.accent, '#38bdf8', 'importar não aplica sozinho');
    await o.setInputFiles('#edImport', { name: 'ruim.json', mimeType: 'application/json', buffer: Buffer.from('{"oi":1}') });
    await o.waitForTimeout(300);
    assert.equal((await x.storage(o, 'nt_data')).settings.customThemes.length, 2, 'arquivo ruim é recusado');
    await o.locator('.ed-theme', { hasText: 'Importado' }).locator('button:has-text("Usar")').click();
    await o.waitForTimeout(400);
    assert.equal((await x.storage(o, 'nt_data')).settings.look.accent, '#ff00aa');

    // cores ilegíveis geram aviso antes de aplicar
    await o.fill('#edc-text', '#1f1d3d').catch(async () => {
      await o.evaluate(() => { const i = document.querySelector('#edc-text'); i.value = '#1f1d3d'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    });
    await o.waitForTimeout(200);
    assert.ok(await o.locator('#edWarn li').count() >= 1, 'aviso de contraste');

    // options.html#reset-tema volta tudo ao padrão
    const r = await x.open('src/options.html#reset-tema');
    await r.waitForTimeout(500);
    s = (await x.storage(r, 'nt_data')).settings;
    assert.equal(s.theme, 'futurista');
    assert.equal(s.look.accent, '');
    assert.equal(s.customThemes.length, 2, 'temas salvos ficam');
    assert.equal(await r.isVisible('#page-editor'), true);
    await p.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent') === '');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('"Como foi hoje?": registra, edita, mostra histórico, exporta e apaga — só no computador', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.widgets.unshift({ id: 'mood', size: 's' });
    await x.seed(p, { nt_data: data });
    const w = p.locator('.widget', { has: p.locator('.mood') });
    await w.locator('.mood-face[aria-label="Bom"]').click();
    await w.locator('.mood-bar').nth(1).click();
    await w.locator('.mood-note').fill('Dia produtivo');
    await w.locator('.mood-note').press('Enter');
    await p.waitForTimeout(400);
    const today = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    let st = await x.storage(p, 'nt_mood');
    assert.deepEqual({ ...st.days[today], at: 0 }, { mood: 4, energy: 2, note: 'Dia produtivo', at: 0 });
    assert.equal(await w.locator('.mood-face[aria-checked="true"]').getAttribute('aria-label'), 'Bom');
    assert.match(await w.locator('.mood-status').textContent(), /Registrado/);
    // clicar de novo na mesma carinha desmarca
    await w.locator('.mood-face[aria-label="Bom"]').click();
    await p.waitForTimeout(200);
    assert.equal((await x.storage(p, 'nt_mood')).days[today].mood, null);
    await w.locator('.mood-face[aria-label="Muito bom"]').click();

    // histórico: gráfico, médias e calendário; editar um dia passado
    await w.locator('header button[title="Histórico"]').click();
    assert.equal(await w.locator('.mood-chart').count(), 1);
    assert.match(await w.locator('.mood-sum').textContent(), /1 dia registrado · humor médio 5,0/);
    await w.locator('.chip:has-text("7 dias")').click();
    assert.equal(await w.locator('.mood-range .chip.sel').textContent(), '7 dias');
    const past = w.locator('.mc:not(.today):not(:disabled)').first();
    if (await past.count()) {
      await past.click();
      assert.match(await w.locator('.mood-when').textContent(), /Editando/);
      await w.locator('.mood-face[aria-label="Ruim"]').click();
      await p.waitForTimeout(200);
      assert.equal(Object.keys((await x.storage(p, 'nt_mood')).days).length, 2);
      await w.locator('.mood-when .linkish').click();
      assert.match(await w.locator('.mood-when').textContent(), /Hoje/);
    }
    // nunca vai para o cérebro/IA nem para a sincronização
    const brain = await p.evaluate(async () => (await import('./newtab/context.js')).brainExtras('como eu estava?'));
    assert.equal(JSON.stringify(brain).includes('Dia produtivo'), false);

    // exportar planilha e apagar tudo (com desfazer)
    await w.locator('header button[title="Histórico"]').click();
    const [dl] = await Promise.all([p.waitForEvent('download'), w.locator('.chip:has-text("Exportar planilha")').click()]);
    const csv = readFileSync(await dl.path(), 'utf8');
    assert.match(csv, /^data,humor,energia,frase\n/);
    assert.match(csv, new RegExp(`${today},5,2,Dia produtivo`));
    await w.locator('.chip:has-text("Apagar tudo")').click();
    await p.waitForTimeout(300);
    assert.deepEqual((await x.storage(p, 'nt_mood')).days, {});
    await p.click('.toast button');
    await p.waitForTimeout(300);
    st = await x.storage(p, 'nt_mood');
    assert.ok(st.days[today], 'desfazer devolve os registros');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
