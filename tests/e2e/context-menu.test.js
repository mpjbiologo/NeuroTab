// Central do botão direito (#55/#56/#12): revisão antes de salvar (nota, tarefa, lembrete, juntar, dados),
// IA com aviso de onde roda, resumir a página, pesquisar em nova aba, documento e personalização do menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, extWith } from './helpers.js';

const SITE = 'https://artigo.example/';
const HTML = '<title>Artigo de teste</title><main><h1>Fotossíntese</h1><p>As plantas transformam luz em energia. Ligue (31) 3333-4444 até 25/12/2026.</p></main>';
const sw = (x) => x.ctx.serviceWorkers()[0];

async function setup(ai) {
  const ext = extWith((m) => { m.host_permissions.push('<all_urls>'); });
  const x = await launch({ ext, ai });
  await x.ctx.route(SITE + '**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: HTML }));
  await x.ctx.route('https://www.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
  const n = await x.open('src/newtab.html');
  const page = await x.ctx.newPage();
  await page.goto(SITE);
  const tabId = await sw(x).evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, SITE);
  /** Clica numa ação do menu (como se fosse pelo botão direito); devolve a janelinha, se abrir uma. */
  const click = async (id, info = {}, { window = true } = {}) => {
    const wait = window ? x.ctx.waitForEvent('page') : null;
    await sw(x).evaluate(async ([id, info, tabId]) => __nt.onMenuClick({ menuItemId: 'nt-' + id, pageUrl: 'https://artigo.example/', ...info }, await chrome.tabs.get(tabId)), [id, info, tabId]);
    if (!wait) return null;
    const w = await wait;
    await w.waitForLoadState();
    await w.locator('#body > *').first().waitFor();
    return w;
  };
  const items = async () => (await x.storage(n, 'nt_brain')) || [];
  const waitItem = async (fn) => {
    for (let i = 0; i < 50; i++) { const it = (await items()).find(fn); if (it) return it; await n.waitForTimeout(150); }
    throw new Error('item não criado');
  };
  return { x, n, page, click, items, waitItem };
}

test('texto: nota com comentário e etiqueta, tarefa, lembrete, juntar e dados', async () => {
  const { x, click, waitItem, n } = await setup();
  try {
    // nota com comentário e etiqueta (projeto)
    let w = await click('sel-note', { selectionText: 'As plantas transformam luz em energia.' });
    assert.match(await w.textContent('#title'), /Salvar como nota/);
    assert.match(await w.textContent('#src'), /Artigo de teste/);
    await w.fill('#comment', 'cair na prova');
    await w.fill('#tags', '#biologia #prova');
    await w.click('#save');
    const note = await waitItem((i) => /plantas transformam/.test(i.text));
    assert.equal(note.type, 'clip');
    assert.match(note.text, /💬 cair na prova/);
    assert.deepEqual(note.tags, ['biologia', 'prova']);
    assert.equal(note.url, SITE);
    assert.equal(note.pageTitle, 'Artigo de teste');
    // lembrete: a data do trecho já vem preenchida; sem data, não salva
    w = await click('sel-remind', { selectionText: 'Reunião com a Ana amanhã às 9h' });
    assert.ok(await w.inputValue('#when'), 'data sugerida a partir do texto');
    await w.fill('#when', '');
    await w.click('#save');
    await w.locator('#msg', { hasText: 'Escolha quando lembrar' }).waitFor();
    await w.fill('#when', '2030-01-02T09:00');
    await w.click('#save');
    const rem = await waitItem((i) => i.type === 'task' && /Ana/.test(i.title + i.text));
    assert.equal(new Date(rem.remindAt).getHours(), 9);
    // tarefa (sem data)
    w = await click('sel-task', { selectionText: 'Revisar o capítulo 3' });
    assert.equal(await w.inputValue('#ttl'), 'Revisar o capítulo 3');
    await w.click('#save');
    await waitItem((i) => i.type === 'task' && i.title === 'Revisar o capítulo 3' && !i.remindAt);
    // juntar a uma nota existente
    w = await click('sel-join', { selectionText: 'Clorofila é verde.' });
    await w.fill('#find', 'plantas');
    await w.locator('#pick button').first().click();
    await w.click('#save');
    await waitItem((i) => i.id === note.id && /> Clorofila é verde\.\n— Artigo de teste/.test(i.text));
    // dados (sem IA)
    w = await click('sel-extract', { selectionText: 'Ligue (31) 3333-4444 ou ana@ex.com até 25/12/2026.' });
    assert.match(await w.textContent('#body'), /3333-4444/);
    assert.match(await w.textContent('#body'), /ana@ex\.com/);
    await w.click('#save');
    await waitItem((i) => /^Dados de/.test(i.title) && /ana@ex\.com/.test(i.text));
    assert.deepEqual(x.errors, []);
    void n;
  } finally {
    await x.close();
  }
});

test('IA: aviso da nuvem uma vez, resumo salvo; resumir a página; pesquisar em nova aba; documento', async () => {
  const sent = [];
  const { x, click, waitItem, n } = await setup((sys, body) => {
    const text = body.contents.map((c) => c.parts.map((p) => p.text).join('')).join('\n');
    sent.push({ sys, text });
    if (/Resuma o texto/.test(sys)) return 'Plantas fazem fotossíntese.';
    if (/Traduza o texto abaixo para Inglês/.test(sys)) return 'Plants turn light into energy.';
    if (/Resuma esta página/.test(sys)) return '- Fotossíntese\n- Energia';
    return undefined;
  });
  try {
    await x.settings(n, { ai: { keys: { gemini: 'K' } } });
    let w = await click('ai-summary', { selectionText: 'As plantas transformam luz em energia.' });
    assert.match(await w.textContent('.where'), /☁/);
    assert.equal(sent.length, 0, 'não envia antes de confirmar');
    await w.check('#remember');
    await w.click('#go');
    await w.locator('#result', { hasText: 'Plantas fazem fotossíntese' }).waitFor();
    await w.click('#save');
    await waitItem((i) => /^Resumo: /.test(i.title) && /Plantas fazem/.test(i.text) && /> As plantas/.test(i.text));
    // segunda vez: já liberado, vai direto
    w = await click('ai-translate', { selectionText: 'As plantas transformam luz em energia.' });
    await w.selectOption('#target', 'en');
    await w.locator('#result', { hasText: 'Plants turn light' }).waitFor();
    assert.equal(await w.locator('#go').count(), 0);
    await w.close();
    // resumir a página: lê o texto da página (só com o clique)
    w = await click('page-summary');
    await w.locator('#result', { hasText: 'Fotossíntese' }).waitFor();
    assert.ok(sent.some((s) => /As plantas transformam luz/.test(s.text)), 'mandou o texto da página');
    await w.close();
    // pesquisar em nova aba
    await click('sel-search', { selectionText: 'fotossíntese' }, { window: false });
    const opened = await sw(x).evaluate(async () => {
      for (let i = 0; i < 60; i++) {
        const tabs = await chrome.tabs.query({});
        const t = tabs.find((tb) => /google\.com\/search\?q=fotoss/.test(tb.pendingUrl || tb.url || ''));
        if (t) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return (await chrome.action.getTitle({})) || 'nenhuma aba';
    });
    assert.equal(opened, true, 'a pesquisa abriu numa aba nova');
    // documento (sem baixar)
    await click('link-doc', { linkUrl: 'https://artigo.example/files/relatorio%20anual.pdf' }, { window: false });
    const doc = await waitItem((i) => i.title === 'relatorio anual.pdf');
    assert.match(doc.text, /📄 PDF · encontrado em Artigo de teste/);
    assert.deepEqual(doc.tags, ['documento']);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Configurações: favoritar, ocultar, reordenar e prévia do menu', async () => {
  const x = await launch();
  try {
    const o = await x.open('src/options.html#botao-direito');
    await o.locator('.menu-act').first().waitFor();
    assert.match(await o.textContent('#menuPv'), /Salvar como nota/);
    // ocultar "Pesquisar"
    await o.locator('.menu-act[data-id="sel-search"] label.sw').click();
    await o.waitForTimeout(300);
    assert.deepEqual((await x.storage(o, 'nt_data')).settings.menu.hidden, ['sel-search']);
    assert.doesNotMatch(await o.textContent('#menuPv'), /Pesquisar/);
    // favoritar "Criar lembrete" e subir para o topo
    await o.click('.menu-act[data-id="sel-remind"] .ma-fav');
    await o.waitForTimeout(200);
    for (let i = 0; i < 2; i++) { await o.click('.menu-act[data-id="sel-remind"] .ma-move button:first-child'); await o.waitForTimeout(200); }
    const m = (await x.storage(o, 'nt_data')).settings.menu;
    assert.ok(m.fav.includes('sel-remind'));
    assert.equal(m.order[0], 'sel-remind');
    assert.match(await o.textContent('#menuPv li:first-child'), /Criar lembrete/);
    await o.click('#menuCtx [data-ctx="image"]');
    assert.match(await o.textContent('#menuPv'), /Salvar imagem na biblioteca/);
    assert.doesNotMatch(await o.textContent('#menuPv'), /Criar lembrete/);
    assert.match(await o.textContent('#menuKeys'), /Alt\+Shift\+S|Recortar/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
