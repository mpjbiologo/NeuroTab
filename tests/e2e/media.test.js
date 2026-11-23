// "Salvar no cérebro com resumo" (#67): link colado na Captura rápida → aba escondida lê a página → IA resume →
// item "Mídia" no cérebro, com categoria, pontos-chave, legenda/transcrição, reprocessar e exportar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { launch, extWith } from './helpers.js';

const MEDIA = ['https://www.instagram.com/*', 'https://www.tiktok.com/*', 'https://www.youtube.com/*', 'https://x.com/*', 'https://api.fxtwitter.com/*'];

function fakeAI() {
  const calls = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', '*');
      if (req.method === 'OPTIONS') return res.end();
      const j = JSON.parse(body || '{}');
      calls.push(j);
      const user = j.messages?.at(-1)?.content || '';
      const yt = /YouTube/.test(user);
      const answer = yt
        ? { titulo: 'Como podar roseiras', resumo: 'Poda de inverno em três passos.\nCorte acima da gema.', pontos_chave: ['tesoura limpa', 'corte em bisel'], categoria: 'casa', tags: ['plantas', 'jardim'] }
        : { titulo: 'Bolo de cenoura fofinho', resumo: 'Receita rápida com cobertura de chocolate.', pontos_chave: ['3 cenouras', '40 min a 180 °C'], categoria: 'receitas', tags: ['bolo', 'sobremesa'] };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, calls, port: srv.address().port })));
}

const IG = `<!doctype html><html><head><meta charset="utf-8">
<meta property="og:title" content="Ana Doces on Instagram: &quot;Bolo de cenoura fofinho 🥕 receita na legenda&quot;">
<meta property="og:description" content="1.234 likes, 56 comments - anadoces on November 20, 2026: &quot;Bolo de cenoura fofinho 🥕 receita na legenda&quot;">
<meta property="og:image" content="https://www.instagram.com/foto.jpg"></head><body><article><time datetime="2026-11-20T10:00:00Z"></time></article></body></html>`;

const YT = `<!doctype html><html><head><meta charset="utf-8"><title>Poda - YouTube</title></head><body><script>
window.ytInitialPlayerResponse = { videoDetails: { title: 'Poda de roseiras no inverno', author: 'Jardim da Lu', shortDescription: 'Aprenda a podar.', lengthSeconds: '420' },
  microformat: { playerMicroformatRenderer: { publishDate: '2026-06-01' } },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en', languageCode: 'en' }, { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=pt', languageCode: 'pt', kind: 'asr' }] } } };
</script></body></html>`;

test('Salvar mídia: Captura rápida → Instagram e YouTube resumidos, categoria, reprocessar e exportar', async () => {
  const ai = await fakeAI();
  const ext = extWith((m) => { m.host_permissions.push(...MEDIA, 'http://127.0.0.1/*'); });
  const x = await launch({ ext });
  try {
    await x.ctx.route('https://www.instagram.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: IG }));
    await x.ctx.route('https://www.youtube.com/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/timedtext') {
        const pt = u.searchParams.get('lang') === 'pt';
        return r.fulfill({ json: { events: [{ segs: [{ utf8: pt ? 'olá pessoal ' : 'hello ' }] }, { segs: [{ utf8: pt ? 'hoje vamos podar' : 'today we prune' }] }] } });
      }
      return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: YT });
    });
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.ai = { ...data.settings.ai, provider: 'ollama', models: { ollama: 'qwen3' }, baseUrls: { ollama: `http://127.0.0.1:${ai.port}/v1` }, autoEnrich: false };
    data.settings.widgets = [{ id: 'capture' }, { id: 'brain' }, ...data.settings.widgets.filter((w) => !['capture', 'brain'].includes(w.id))];
    await x.seed(p, { nt_data: data });

    // colar o link do Reel na Captura rápida: aparece o botão "Salvar com resumo"
    const cap = p.locator('.widget', { has: p.locator('textarea') }).first();
    await cap.locator('textarea').fill('https://instagram.com/reel/DejkA_8xi5P?igsh=abc');
    await cap.locator('.media-offer').waitFor();
    assert.match(await cap.locator('.muted').last().textContent(), /Instagram/);
    await cap.locator('textarea').fill('');

    // a página aberta (como no botão direito / no botão da extensão): lê com a sessão da pessoa
    const page = await x.ctx.newPage();
    await page.goto('https://www.instagram.com/reel/DejkA_8xi5P/?igsh=abc');
    const tabId = await p.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.instagram.com/*' }))[0]?.id);
    const res = await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'media:save', tabId: id }), tabId);
    assert.equal(res.status, 'processado', JSON.stringify(res));
    const items = (await x.storage(p, 'nt_brain')).filter((it) => it.type === 'media');
    const ig = items[0];
    assert.equal(ig.url, 'https://www.instagram.com/reel/DejkA_8xi5P/', 'link padronizado');
    assert.equal(ig.title, 'Bolo de cenoura fofinho');
    assert.equal(ig.media.platform, 'instagram');
    assert.equal(ig.media.author, 'Ana Doces');
    assert.equal(ig.media.caption, 'Bolo de cenoura fofinho 🥕 receita na legenda');
    assert.equal(ig.media.category, 'receitas');
    assert.deepEqual(ig.media.points, ['3 cenouras', '40 min a 180 °C']);
    assert.deepEqual(ig.tags, ['bolo', 'sobremesa']);
    const sys = ai.calls[0].messages[0].content;
    assert.match(sys, /receitas: culinária/, 'categorias no pedido');
    assert.match(ai.calls[0].messages[1].content, /<conteudo>[\s\S]*Ana Doces/);

    // a mesma página de novo: não duplica
    const again = await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'media:save', tabId: id }), tabId);
    assert.equal(again.existed, true);
    assert.equal((await x.storage(p, 'nt_brain')).filter((it) => it.type === 'media').length, 1);

    // YouTube: legenda do próprio vídeo (pt antes de en)
    await page.goto('https://www.youtube.com/watch?v=abc&si=x');
    const yt = await p.evaluate((id) => chrome.runtime.sendMessage({ type: 'media:save', tabId: id }), tabId);
    assert.equal(yt.status, 'processado', JSON.stringify(yt));
    const ytItem = (await x.storage(p, 'nt_brain')).find((it) => it.url === 'https://www.youtube.com/watch?v=abc');
    assert.equal(ytItem.media.content, 'olá pessoal hoje vamos podar');
    assert.equal(ytItem.media.contentType, 'legenda');
    assert.equal(ytItem.media.author, 'Jardim da Lu');
    assert.equal(ytItem.media.published, '2026-06-01');
    assert.equal(ytItem.media.category, 'casa');
    await page.close();

    // no cérebro: filtro Mídia, categoria na lista, painel com pontos-chave, troca de categoria e exportar
    const brain = p.locator('.widget', { has: p.locator('.items') }).first();
    await brain.locator('button:has-text("Mídia")').click();
    await brain.locator('.item').nth(1).waitFor();
    assert.equal(await brain.locator('.item').count(), 2);
    assert.ok(await brain.locator('.item .tag.cat:has-text("receitas")').count());
    await brain.locator('.item', { hasText: 'Bolo de cenoura' }).click();
    const panel = p.locator('#itemMedia');
    await panel.waitFor();
    assert.match(await panel.textContent(), /Instagram/);
    assert.equal(await panel.locator('.im-points li').count(), 2);
    await panel.locator('select[title="Categoria"]').selectOption('humor');
    await p.waitForTimeout(300);
    assert.equal((await x.storage(p, 'nt_brain')).find((it) => it.id === ig.id).media.category, 'humor');
    const [dl] = await Promise.all([p.waitForEvent('download'), panel.locator('button:has-text(".md")').click()]);
    const md = readFileSync(await dl.path(), 'utf8');
    assert.match(md, /^---\ncriado: \d{4}-\d{2}-\d{2}\ntipo: link\nplataforma: instagram/);
    assert.match(md, /categoria: humor/);
    assert.match(dl.suggestedFilename(), /instagram - Bolo de cenoura fofinho\.md$/);
    // reprocessar
    const before = ai.calls.length;
    await panel.locator('button:has-text("Reprocessar")').click();
    await p.waitForFunction(() => !document.querySelector('#itemDlg').open, null, { timeout: 15000 });
    assert.equal(ai.calls.length, before + 1);
    assert.equal((await x.storage(p, 'nt_brain')).find((it) => it.id === ig.id).media.category, 'receitas');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
    ai.srv.close();
  }
});

test('Salvar mídia: IA na internet espera autorização; sem permissão do site, fica pendente com o motivo', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.ai = { ...data.settings.ai, provider: 'gemini', keys: { gemini: 'chave-de-teste' }, autoEnrich: false };
    await x.seed(p, { nt_data: data });
    const r = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'media:save', url: 'https://www.tiktok.com/@u/video/123?_r=1' }));
    assert.equal(r.pending, true);
    const it = (await x.storage(p, 'nt_brain')).find((i) => i.type === 'media');
    assert.equal(it.url, 'https://www.tiktok.com/@u/video/123');
    assert.match(it.media.error, /Configurações → Mídia/);
    // configurações: página Salvar mídia com categorias e créditos ao Kora
    const o = await x.open('src/options.html#salvar-midia');
    assert.match(await o.inputValue('#mediaCats'), /^programação: /);
    await o.fill('#mediaCats', 'viagem: lugares e roteiros\noutros: resto');
    await o.click('#mediaCatsSave');
    await o.waitForTimeout(300);
    assert.deepEqual((await x.storage(o, 'nt_data')).settings.mediaSave.categoryList.map(([k]) => k), ['viagem', 'outros']);
    assert.match(await o.locator('#page-salvar-midia').textContent(), /Kora/);
    await o.goto(o.url().split('#')[0] + '#creditos');
    assert.match(await o.locator('#page-creditos').textContent(), /Joao V Santos/);
    // endereço antigo da página de vídeos continua funcionando
    await o.goto(o.url().split('#')[0] + '#videos');
    await o.waitForTimeout(300);
    assert.equal(await o.isVisible('#page-salvar-midia'), true);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
