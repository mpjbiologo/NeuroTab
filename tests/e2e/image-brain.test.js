// Cérebro lê as imagens (#17) e "Analisar imagem" (#54): texto lido no computador, item no cérebro,
// busca, exclusão, descrição pela IA só com autorização, endereço → rota no widget Trânsito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

// Imagem com texto e endereço, desenhada na própria página e salva na biblioteca.
const saveSample = (p, temp = false) => p.evaluate(async (temp) => {
  const c = new OffscreenCanvas(900, 260);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 260); g.fillStyle = '#111';
  g.font = 'bold 44px sans-serif'; g.fillText('Padaria Pão Quente', 30, 80);
  g.font = '34px sans-serif'; g.fillText('Rua da Bahia, 1148 - Centro', 30, 150); g.fillText('Aberto das 6h às 20h', 30, 210);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const { saveCapture } = await import('/src/lib/captures.js');
  return (await saveCapture({ blob, pageUrl: 'https://exemplo.com/padaria', pageTitle: 'Padaria', fileName: 'padaria.png', temp })).id;
}, temp);

// Espera até a condição sobre o cérebro valer (waitForFunction não espera promessas).
async function until(x, p, fn, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    const items = (await x.storage(p, 'nt_brain')) || [];
    if (fn(items)) return items;
    if (Date.now() - t0 > ms) throw new Error('tempo esgotado esperando o cérebro');
    await p.waitForTimeout(300);
  }
}

const AI_JSON = { titulo: 'Placa da padaria', descricao: 'Placa de uma padaria com endereço e horário.', texto: 'Padaria Pão Quente\nRua da Bahia, 1148 - Centro', tags: ['padaria'], endereco: 'Rua da Bahia, 1148 - Centro, Belo Horizonte', resposta: 'Abre às 6h.' };

test('imagem salva é lida no computador e vira item do cérebro; busca encontra; excluir tira do cérebro', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.widgets = [{ id: 'image-library', w: 12 }];
    await x.seed(p, { nt_data: data });
    const id = await saveSample(p);
    const item = (await until(x, p, (l) => l.some((i) => i.type === 'image'))).find((i) => i.type === 'image');
    assert.equal(item.captureId, id);
    assert.match(item.text, /Rua da Bahia, 1148/);
    assert.match(item.text, /Endereço: Rua da Bahia, 1148 - Centro/);
    assert.equal(item.title, 'Padaria Pão Quente');
    assert.equal(item.url, 'https://exemplo.com/padaria');
    // a biblioteca mostra que já está no cérebro
    await p.waitForSelector('.nt-image-status.done');

    // busca universal encontra pelo texto da imagem
    await p.click('#omni');
    await p.keyboard.type('bahia');
    await p.waitForSelector('.omni-item:has-text("Padaria Pão Quente")');
    await p.keyboard.press('Escape');

    // excluir na biblioteca tira o item do cérebro
    await p.click('.nt-image-card button:has-text("Excluir")');
    await until(x, p, (l) => !l.some((i) => i.type === 'image'), 10000);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Analisar imagem: texto e endereço na hora; IA na internet só depois de autorizar; rota abre no Trânsito', async () => {
  const x = await launch({ ai: (sys) => (sys.includes('analisa imagens') ? JSON.stringify(AI_JSON) : undefined) });
  try {
    await x.ctx.addInitScript(() => { if (globalThis.chrome?.permissions) { chrome.permissions.contains = async () => true; chrome.permissions.request = async () => true; } });
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.ai = { ...data.settings.ai, keys: { gemini: 'K' }, autoEnrich: false };
    data.settings.imageOcr = false; // a nova aba não lê sozinha: quem lê é a janela de análise
    await x.seed(p, { nt_data: data });
    const id = await saveSample(p);
    data.settings.imageOcr = true;
    await x.seed(p, { nt_data: data }, { reload: false });

    const a = await x.open('src/analyze.html?id=' + id);
    await a.waitForSelector('#read:has-text("Rua da Bahia")', { timeout: 60000 });
    assert.equal(await a.inputValue('#addr'), 'Rua da Bahia, 1148 - Centro');
    // Gemini é serviço na internet: pede autorização e nada foi enviado ainda
    assert.equal(await a.isVisible('#consent'), true);
    assert.match(await a.textContent('#target'), /Gemini/);
    assert.equal(x.calls.ai.filter((s) => s.includes('analisa imagens')).length, 0);

    await a.fill('#question', 'Que horas abre?');
    await a.check('#always');
    await a.click('#describe');
    await a.waitForSelector('#desc:has-text("Placa de uma padaria")');
    assert.match(await a.textContent('#answer'), /Abre às 6h/);
    assert.equal(await a.inputValue('#addr'), 'Rua da Bahia, 1148 - Centro, Belo Horizonte');
    assert.equal((await x.storage(a, 'nt_data')).settings.ai.imagesAllowed, true, '"não perguntar de novo" ficou salvo');
    const item = (await x.storage(a, 'nt_brain')).find((i) => i.captureId === id);
    assert.equal(item.title, 'Placa da padaria');
    assert.match(item.text, /Descrição: Placa de uma padaria/);
    assert.deepEqual(item.tags, ['padaria']);

    // rota: abre a nova aba com o widget Trânsito e o destino preenchido
    const [tab] = await Promise.all([x.ctx.waitForEvent('page'), a.click('#route')]);
    await tab.waitForLoadState();
    await tab.waitForSelector('[data-id="traffic"], .w-traffic, #widgets :text("Trânsito")', { timeout: 15000 });
    assert.ok(!tab.url().includes('route='), 'o pedido some do endereço');
    assert.ok((await x.storage(tab, 'nt_data')).settings.widgets.some((w) => w.id === 'traffic'));
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

// Ollama falso: /api/tags lista os modelos, /api/show diz quais enxergam, /v1/chat responde.
async function fakeOllama(x, { installed, vision }) {
  const chats = [];
  await x.ctx.route('http://localhost:11434/**', async (r) => {
    const u = new URL(r.request().url());
    const body = JSON.parse(r.request().postData() || '{}');
    const cors = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/api/tags') return r.fulfill({ json: { models: installed.map((name) => ({ name })) }, headers: cors });
    if (u.pathname === '/api/show') return r.fulfill({ json: { capabilities: vision.includes(body.model) ? ['completion', 'vision'] : ['completion'] }, headers: cors });
    chats.push(body);
    return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ ...AI_JSON, resposta: '' }) } }] }, headers: cors });
  });
  return chats;
}

async function ollamaPage(x, model) {
  await x.ctx.addInitScript(() => { if (globalThis.chrome?.permissions) { chrome.permissions.contains = async () => true; chrome.permissions.request = async () => true; } });
  const p = await x.open('src/newtab.html');
  const data = await x.storage(p, 'nt_data');
  data.settings.ai = { ...data.settings.ai, provider: 'ollama', models: { ollama: model }, autoEnrich: false };
  data.settings.imageOcr = false;
  await x.seed(p, { nt_data: data });
  return x.open('src/analyze.html?id=' + await saveSample(p));
}

test('Ollama (IA no computador) descreve sem pedir autorização, com o modelo que enxerga', async () => {
  const x = await launch();
  try {
    const chats = await fakeOllama(x, { installed: ['gemma3:4b'], vision: ['gemma3:4b'] });
    const a = await ollamaPage(x, 'gemma3:4b');
    await a.waitForSelector('#desc:has-text("Placa de uma padaria")', { timeout: 30000 });
    assert.equal(await a.isVisible('#consent'), false);
    assert.equal(chats[0].model, 'gemma3:4b');
    assert.equal(chats[0].messages.at(-1).content[0].type, 'image_url');
    assert.match(chats[0].messages.at(-1).content[0].image_url.url, /^data:image\/jpeg;base64,/);
    assert.match(await a.textContent('#model'), /gemma3:4b/);
  } finally {
    await x.close();
  }
});

test('Ollama com modelo só de texto: usa outro instalado que enxerga; sem nenhum, explica o que instalar', async () => {
  let x = await launch();
  try {
    const chats = await fakeOllama(x, { installed: ['llama3.2:latest', 'llava:7b'], vision: ['llava:7b'] });
    const a = await ollamaPage(x, 'llama3.2');
    await a.waitForSelector('#desc:has-text("Placa de uma padaria")', { timeout: 30000 });
    assert.equal(chats.length, 1);
    assert.equal(chats[0].model, 'llava:7b', 'a imagem não vai para o modelo que não enxerga');
    assert.match(await a.textContent('#model'), /llava:7b/);
  } finally {
    await x.close();
  }
  x = await launch();
  try {
    const chats = await fakeOllama(x, { installed: ['llama3.2:latest'], vision: [] });
    const a = await ollamaPage(x, 'llama3.2');
    await a.click('#describe');
    await a.waitForSelector('#status.err');
    assert.match(await a.textContent('#status'), /llama3\.2 só entende texto.*ollama pull gemma3/);
    assert.equal(chats.length, 0, 'nada enviado ao modelo que não enxerga');
  } finally {
    await x.close();
  }
});

const capture = (p, id) => p.evaluate(async (id) => (await import('/src/lib/image-index.js')).getCapture(id).then((r) => (r ? { temp: !!r.temp } : null)), id);
const library = (p) => p.evaluate(async () => (await (await import('/src/lib/image-index.js')).listCaptures()).length);

test('Mídia → "Perguntar": imagem só para análise não entra na biblioteca nem no cérebro até guardar', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    const id = await saveSample(p, true);
    assert.equal(await library(p), 0, 'temporária não aparece na biblioteca');
    const a = await x.open('src/analyze.html?id=' + id);
    await a.waitForSelector('#read:has-text("Rua da Bahia")', { timeout: 60000 });
    assert.equal(await a.isVisible('#keepBox'), true);
    assert.match(await a.textContent('#keepText'), /Guardar esta imagem na biblioteca\?/);
    assert.equal(((await x.storage(a, 'nt_brain')) || []).filter((i) => i.type === 'image').length, 0, 'nada no cérebro antes de guardar');
    await a.click('#keep');
    await a.waitForSelector('#keepBox', { state: 'hidden' });
    assert.deepEqual(await capture(a, id), { temp: false });
    assert.equal(await library(a), 1);
    const item = ((await x.storage(a, 'nt_brain')) || []).find((i) => i.captureId === id);
    assert.match(item.text, /Rua da Bahia/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('fechar a análise sem guardar descarta a imagem; "Não guardar" esconde a pergunta; temporárias antigas são limpas', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    const id = await saveSample(p, true);
    const a = await x.open('src/analyze.html?id=' + id);
    await a.waitForSelector('#read:has-text("Rua da Bahia")', { timeout: 60000 });
    await a.click('#noKeep');
    assert.equal(await a.isVisible('#keepBox'), false);
    await a.close({ runBeforeUnload: true });
    for (let i = 0; i < 50 && await capture(p, id); i++) await p.waitForTimeout(200);
    assert.equal(await capture(p, id), null, 'imagem temporária apagada ao fechar');

    const old = await saveSample(p, true);
    const n = await p.evaluate(async (old) => {
      const m = await import('/src/lib/image-index.js');
      await m.updateCapture(old, { capturedAt: Date.now() - 7 * 3600e3 });
      return m.purgeTemp();
    }, old);
    assert.equal(n, 1);
    assert.equal(await capture(p, old), null);
  } finally {
    await x.close();
  }
});

test('Mídia → "Não guardar": a janela oferece guardar sem perguntar; IA para imagens própria (Ollama) sem trocar a da conversa', async () => {
  const x = await launch();
  try {
    const chats = await fakeOllama(x, { installed: ['gemma3:4b'], vision: ['gemma3:4b'] });
    await x.ctx.addInitScript(() => { if (globalThis.chrome?.permissions) { chrome.permissions.contains = async () => true; chrome.permissions.request = async () => true; } });
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.ai = { ...data.settings.ai, provider: 'gemini', keys: { gemini: 'K' }, models: { ollama: 'gemma3:4b' }, autoEnrich: false };
    data.settings.media = { save: 'never', provider: 'ollama' };
    data.settings.imageOcr = false;
    await x.seed(p, { nt_data: data });
    const id = await saveSample(p, true);
    const a = await x.open('src/analyze.html?id=' + id);
    await a.waitForSelector('#desc:has-text("Placa de uma padaria")', { timeout: 30000 });
    assert.equal(await a.isVisible('#consent'), false, 'Ollama é local: não pergunta');
    assert.equal(chats[0].model, 'gemma3:4b');
    assert.match(await a.textContent('#keepText'), /não foi guardada/);
    assert.equal(await a.isVisible('#noKeep'), false);
    assert.equal((await x.storage(a, 'nt_data')).settings.ai.provider, 'gemini', 'a IA da conversa não mudou');
  } finally {
    await x.close();
  }
});

test('Configurações: aba Mídia com as opções de imagens', async () => {
  const x = await launch();
  try {
    const o = await x.open('src/options.html#midia');
    await o.waitForSelector('#page-imagens:not([hidden])');
    assert.equal(await o.inputValue('select[data-k="media.save"]'), 'ask');
    await o.selectOption('select[data-k="media.save"]', 'auto');
    await o.selectOption('#mediaProvider', 'openai');
    await o.waitForTimeout(300);
    const s = (await x.storage(o, 'nt_data')).settings;
    assert.equal(s.media.save, 'auto');
    assert.equal(s.media.provider, 'openai');
    assert.match(await o.textContent('#mediaProviderNote'), /Falta a chave de OpenAI/);
    assert.equal(await o.isVisible('#page-imagens #visionModel'), true);
    assert.equal(await o.locator('.pane[data-page^="ia"] >> text=Ler o texto das imagens salvas').count(), 0, 'saiu da aba IA');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
