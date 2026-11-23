// Central de IA (0.8.0): cadastrar servidores, Padrão e Reserva, modelo por tarefa, troca só desta vez,
// pedido de permissão antes de cair na Reserva da internet e exportar sem as chaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './helpers.js';

const cors = { 'access-control-allow-origin': '*' };

async function fakeOllama(x, state) {
  await x.ctx.route('http://localhost:11434/**', async (r) => {
    const u = new URL(r.request().url());
    const body = JSON.parse(r.request().postData() || '{}');
    if (u.pathname === '/v1/models') return r.fulfill({ json: { data: [{ id: 'llama3.2' }, { id: 'gemma3:4b' }, { id: 'nomic-embed-text' }] }, headers: cors });
    if (u.pathname === '/api/show') return r.fulfill({ json: { capabilities: body.model === 'gemma3:4b' ? ['completion', 'vision'] : body.model === 'nomic-embed-text' ? ['embedding'] : ['completion'] }, headers: cors });
    if (state.down) return r.abort('connectionrefused');
    state.chats.push(body);
    return r.fulfill({ json: { choices: [{ message: { content: 'Resposta do Ollama.' } }] }, headers: cors });
  });
}

test('Central de IA: servidores, Padrão e Reserva, modelo por tarefa e Reserva com permissão', async () => {
  const gemini = [];
  const x = await launch({ ai: (sys, body) => { gemini.push(body); return sys.includes('segundo cérebro') ? 'Resposta do Gemini.' : undefined; } });
  try {
    await x.ctx.addInitScript(() => { if (globalThis.chrome?.permissions) { chrome.permissions.contains = async () => true; chrome.permissions.request = async () => true; } });
    const state = { down: false, chats: [] };
    await fakeOllama(x, state);
    const o = await x.open('src/options.html#ia');
    await o.locator('#page-ia').waitFor();
    assert.match(await o.textContent('#aiServers'), /Nenhum servidor ainda/);

    // 1) Ollama no computador, carregando os modelos e o que cada um sabe fazer
    await o.click('#aiAdd');
    const dlg = o.locator('dialog.ai-dlg');
    await dlg.locator('select').first().selectOption('ollama');
    await dlg.locator('button:has-text("Carregar modelos")').click();
    await dlg.locator('.ai-mrow', { hasText: 'gemma3:4b' }).waitFor();
    const row = (m) => dlg.locator('.ai-mrow', { hasText: m });
    assert.equal(await row('gemma3:4b').locator('.ai-cap').first().locator('input').isChecked(), true, 'gemma3 lê imagens');
    assert.equal(await row('nomic-embed-text').locator('.ai-cap').nth(1).locator('input').isChecked(), true, 'nomic gera embeddings');
    for (const m of ['llama3.2', 'gemma3:4b', 'nomic-embed-text']) await row(m).locator('.ai-mon input').check();
    await dlg.locator('button[value="ok"]').click();
    await o.locator('.ai-server[data-id="ollama"]').waitFor();
    assert.match(await o.textContent('.ai-server[data-id="ollama"]'), /Este computador/);
    await o.locator('.ai-server[data-id="ollama"] .ok').waitFor({ timeout: 15000 }); // testado sozinho ao salvar
    // 2) Gemini com chave
    await o.click('#aiAdd');
    await dlg.locator('select').first().selectOption('gemini');
    await dlg.locator('input[type=password]').fill('CHAVE-G');
    await dlg.locator('input[placeholder="Outro modelo (nome exato)"]').fill('gemini-flash-latest');
    await dlg.locator('button:has-text("Adicionar")').click();
    await dlg.locator('button[value="ok"]').click();
    await o.locator('.ai-server[data-id="gemini"]').waitFor();
    assert.match(await o.textContent('.ai-server[data-id="gemini"]'), /Internet/);

    let ai = (await x.storage(o, 'nt_data')).settings.ai;
    assert.deepEqual(ai.primary, { server: 'ollama', model: 'llama3.2' }, 'o primeiro servidor vira o Padrão');
    assert.equal(ai.keys.gemini, 'CHAVE-G');
    // Reserva: Gemini
    await o.selectOption('#aiReserve', JSON.stringify({ server: 'gemini', model: 'gemini-flash-latest' }));
    // 3) Modelo por tarefa: Resumir mídia no Gemini; imagens herdam (Ollama com visão)
    await o.goto(o.url().replace(/#.*$/, '#ia-tarefas'));
    await o.locator('#aiTasks .ai-task').first().waitFor();
    const task = (label) => o.locator('.ai-task', { hasText: label });
    assert.match(await task('Busca por significado').textContent(), /nomic-embed-text/);
    await task('Resumir mídia').locator('select').selectOption(JSON.stringify({ server: 'gemini', model: 'gemini-flash-latest' }));
    await o.waitForTimeout(300);
    ai = (await x.storage(o, 'nt_data')).settings.ai;
    assert.deepEqual(ai.tasks.media, { server: 'gemini', model: 'gemini-flash-latest' });
    assert.deepEqual(ai.reserve, { server: 'gemini', model: 'gemini-flash-latest' });
    assert.match(await task('Resumir mídia').textContent(), /próprio/);
    assert.match(await task('Conversa').textContent(), /herdado do Padrão/);
    assert.match(await task('Transcrição').textContent(), /Configurada à parte/);

    // 4) Exportar: sem a chave
    await o.goto(o.url().replace(/#.*$/, '#ia'));
    await o.locator('#aiExport').waitFor();
    const [dl] = await Promise.all([o.waitForEvent('download'), o.click('#aiExport')]);
    const exported = readFileSync(await dl.path(), 'utf8');
    assert.match(exported, /"ai-config"/);
    assert.ok(!exported.includes('CHAVE-G'), 'a chave não vai no arquivo');

    // 5) Perguntar: usa o Ollama; o selo mostra e troca só desta vez
    const p = await x.open('src/newtab.html');
    const d = await x.storage(p, 'nt_data');
    d.settings.widgets = [{ id: 'ask' }, ...d.settings.widgets.filter((w) => w.id !== 'ask')];
    d.settings.ai.autoEnrich = false;
    await x.seed(p, { nt_data: d });
    const w = p.locator('.widget', { has: p.locator('.chat') });
    const chip = w.locator('select.ai-chip');
    assert.match(await chip.locator('option').first().textContent(), /Ollama · llama3\.2/);
    await w.locator('input[type=text]').fill('o que eu salvei?');
    await w.locator('button:has-text("Enviar")').click();
    await w.locator('.msg.bot', { hasText: 'Resposta do Ollama' }).waitFor({ timeout: 15000 });
    assert.equal(state.chats.at(-1).model, 'llama3.2');
    // Ollama fora do ar: pergunta antes de mandar para a Reserva na internet
    state.down = true;
    const before = gemini.length;
    const dialogs = [];
    p.on('dialog', (dd) => dialogs.push(dd.message()));
    await w.locator('input[type=text]').fill('e agora?');
    await w.locator('button:has-text("Enviar")').click();
    await w.locator('.msg.bot', { hasText: 'Resposta do Gemini' }).waitFor({ timeout: 15000 });
    assert.ok(dialogs.some((m) => /Reserva/.test(m) && /internet/.test(m)), 'perguntou antes');
    assert.equal(gemini.length, before + 1);
    // troca só desta vez: Gemini direto, sem pergunta
    state.down = false;
    await chip.selectOption(JSON.stringify({ server: 'gemini', model: 'gemini-flash-latest' }));
    dialogs.length = 0;
    await w.locator('input[type=text]').fill('e com o gemini?');
    await w.locator('button:has-text("Enviar")').click();
    await p.waitForFunction((n) => document.querySelectorAll('.msg.bot').length >= n, 4);
    await w.locator('.msg.bot', { hasText: 'Resposta do Gemini' }).nth(1).waitFor({ timeout: 15000 });
    assert.equal(dialogs.length, 0);
    assert.deepEqual((await x.storage(p, 'nt_data')).settings.ai.primary, { server: 'ollama', model: 'llama3.2' }, 'a troca não mexe no Padrão');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Central de IA: configuração antiga migra sozinha e a aba IA mostra o servidor', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    const d = await x.storage(p, 'nt_data');
    d.settings.ai = { provider: 'openai', keys: { openai: 'K1', gemini: 'K2' }, models: { openai: 'gpt-5-mini' }, embedModels: {}, baseUrls: {}, autoEnrich: true };
    await x.seed(p, { nt_data: d });
    const o = await x.open('src/options.html#ia');
    await o.locator('.ai-server[data-id="openai"]').waitFor();
    assert.equal(await o.locator('.ai-server').count(), 2);
    assert.match(await o.locator('#aiPrimary option:checked').textContent(), /OpenAI · gpt-5-mini/);
    // remover não deixa o servidor voltar sozinho
    await o.locator('.ai-server[data-id="gemini"] button:has-text("Remover")').click();
    await o.waitForFunction(() => document.querySelectorAll('.ai-server').length === 1);
    await o.reload();
    await o.locator('.ai-server').first().waitFor();
    assert.equal(await o.locator('.ai-server').count(), 1);
    const ai = (await x.storage(o, 'nt_data')).settings.ai;
    assert.equal(ai.v, 2);
    assert.deepEqual(ai.keys, { openai: 'K1' });
    assert.deepEqual(ai.primary, { server: 'openai', model: 'gpt-5-mini' });
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
