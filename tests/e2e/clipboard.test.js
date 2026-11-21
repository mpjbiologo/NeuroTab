// Área de transferência (#51, 0.7.7): widget (colar, copiar de novo, fixar, virar nota, configurar) e a captura
// de verdade: ao copiar num site (content script) e acompanhando tudo (documento oculto), com o ● no ícone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, extWith } from './helpers.js';

const SITE = 'https://exemplo.test/artigo';
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Artigo de teste</title></head><body>
  <p id="p">A fotossíntese transforma luz em energia química.</p>
  <input id="pwd" type="password" value="Tr0ca@Senha">
  <button id="btn">copiar</button></body></html>`;

async function addWidget(x, p) {
  const data = await x.storage(p, 'nt_data');
  data.settings.widgets = [{ id: 'clipboard', w: 6 }];
  await x.seed(p, { nt_data: data }, { reload: true });
  return p.locator('.widget[data-id="clipboard"]');
}

test('widget: colar, copiar de novo, fixar, virar nota, pesquisar, configurar e excluir', async () => {
  const x = await launch();
  try {
    await x.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const p = await x.open('src/newtab.html');
    const card = await addWidget(x, p);
    await card.locator('.clip-empty').waitFor();
    assert.match(await card.locator('.clip-status').textContent(), /Só o que você colar aqui/);

    const paste = (text) => card.locator('.clip-drop').evaluate((el, t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    await paste('https://pt.wikipedia.org/wiki/Fotossíntese');
    await paste('Comprar pão amanhã às 8h');
    await card.locator('.clip-item').nth(1).waitFor();
    assert.equal(await card.locator('.clip-item[data-kind="link"]').count(), 1);
    // colar o mesmo de novo: não duplica
    await paste('https://pt.wikipedia.org/wiki/Fotossíntese');
    await p.waitForTimeout(400);
    assert.equal(await card.locator('.clip-item').count(), 2);
    assert.match(await card.locator('.clip-item').first().textContent(), /wikipedia/);

    // copiar de novo
    await card.locator('.clip-item:has-text("Comprar pão") .clip-main').click();
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), 'Comprar pão amanhã às 8h');

    // fixar e virar tarefa
    await card.locator('.clip-item:has-text("Comprar pão") button[title^="Fixar"]').click();
    await card.locator('.clip-item.pinned').waitFor();
    await card.locator('.clip-item:has-text("Comprar pão") button[title="Salvar como tarefa"]').click();
    await p.waitForTimeout(400);
    const brain = await x.storage(p, 'nt_brain');
    const task = brain.find((b) => b.text === 'Comprar pão amanhã às 8h');
    assert.equal(task?.type, 'task');
    assert.ok(task.remindAt, 'o lembrete foi entendido');

    // pesquisa e filtro
    await card.locator('.clip-search').fill('fotossintese');
    assert.equal(await card.locator('.clip-item').count(), 1);
    await card.locator('.clip-search').fill('');
    await card.locator('.clip-filter').selectOption('pinned');
    assert.equal(await card.locator('.clip-item').count(), 1);
    await card.locator('.clip-filter').selectOption('');

    // configurar: prazo de 1 dia
    await card.locator('..').locator('button[title="Configurar a área de transferência"]').click();
    const dlg = p.locator('dialog.clip-dlg[open]');
    assert.match(await dlg.textContent(), /Ao fechar o navegador ou desligar o computador/);
    await dlg.locator('label:has-text("Apagar sozinho") select').selectOption('1d');
    await dlg.locator('button[value="ok"]').click();
    await p.waitForTimeout(300);
    assert.equal((await x.storage(p, 'nt_clipboard_cfg')).retention, '1d');

    // limpar mantém o fixado; excluir
    await card.locator('..').locator('button[title="Configurar a área de transferência"]').click();
    await p.locator('dialog.clip-dlg[open] button:has-text("Limpar histórico")').click();
    await p.locator('dialog.clip-dlg[open] button[value="cancel"]').click();
    await p.waitForTimeout(300);
    assert.equal(await card.locator('.clip-item').count(), 1);
    await card.locator('.clip-item button[title="Excluir"]').click();
    await card.locator('.clip-empty').waitFor();

    // nada disso vai para a sincronização nem para o backup: chaves próprias
    assert.ok((await x.storage(p, 'nt_clipboard')).items);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('captura de verdade: copiar num site (com a origem) e acompanhar tudo; senha fica de fora; ● no ícone', async () => {
  // permissões opcionais já concedidas (no uso real, a pessoa concede no widget)
  const ext = extWith((m) => {
    m.permissions.push('clipboardRead');
    m.host_permissions.push('https://*/*');
  });
  const x = await launch({ ext });
  try {
    await x.ctx.route(SITE, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
    await x.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const p = await x.open('src/newtab.html');
    const card = await addWidget(x, p);
    await x.seed(p, { nt_clipboard_cfg: { sites: true, monitor: true, retention: 'session', protect: true, max: 200, maxImages: 30, paused: false, ignore: ['nubank.com.br'] } }, { reload: false });
    await card.locator('.clip-status.on').waitFor();
    const sw = x.ctx.serviceWorkers()[0];
    // o fundo registrou a captura nos sites e abriu o documento oculto
    await sw.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        const reg = await chrome.scripting.getRegisteredContentScripts({ ids: ['nt-clip'] });
        const off = await chrome.offscreen.hasDocument();
        if (reg.length && off && (await chrome.action.getBadgeText({})) === '●') return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('captura não ligou');
    });
    assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '●');

    // 1) copiar um trecho num site: chega com o título e o endereço
    const site = await x.ctx.newPage();
    await site.goto(SITE);
    await site.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')); getSelection().removeAllRanges(); getSelection().addRange(r); });
    await site.keyboard.press('Control+c');
    await card.locator('.clip-item:has-text("fotossíntese")').waitFor({ timeout: 8000 });
    const items = (await x.storage(p, 'nt_clipboard')).items;
    const got = items.find((i) => i.text.includes('fotossíntese'));
    assert.equal(got.source.url, SITE);
    assert.equal(got.source.title, 'Artigo de teste');
    assert.equal(got.count, 1, 'site + acompanhamento = uma cópia só');

    // 2) um botão "copiar" que escreve direto (sem seleção): o acompanhamento pega
    await site.evaluate(() => navigator.clipboard.writeText('Código do pedido: PED-2026-0042'));
    await card.locator('.clip-item:has-text("PED-2026-0042")').waitFor({ timeout: 8000 });

    // 3) senha: nem pelo site (campo de senha) nem pelo acompanhamento (parece senha)
    await site.locator('#pwd').focus();
    await site.keyboard.press('Control+a');
    await site.keyboard.press('Control+c');
    await site.evaluate(() => navigator.clipboard.writeText('Tr0ca@Senha'));
    await p.waitForTimeout(3500);
    assert.ok(!(await x.storage(p, 'nt_clipboard')).items.some((i) => i.text.includes('Tr0ca')), 'senha não entra');

    // 4) pausar: para de capturar e o ● some
    await card.locator('.clip-status').click();
    await card.locator('.clip-status.paused').waitFor();
    await site.evaluate(() => navigator.clipboard.writeText('copiado com a captura pausada'));
    await p.waitForTimeout(3000);
    assert.ok(!(await x.storage(p, 'nt_clipboard')).items.some((i) => i.text.includes('pausada')));
    await sw.evaluate(async () => { for (let i = 0; i < 30 && (await chrome.action.getBadgeText({})) === '●'; i++) await new Promise((r) => setTimeout(r, 100)); });
    assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
