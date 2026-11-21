// Barra de pesquisa universal (#57): a pessoa escolhe o que o Enter faz; padrão é pesquisar na internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const PAGE = { status: 200, contentType: 'text/html', body: '<title>ok</title>ok' };

async function setup(x, enter) {
  await x.ctx.route('https://www.google.com/**', (r) => r.fulfill(PAGE));
  await x.ctx.route('https://gatos.example/**', (r) => r.fulfill(PAGE));
  const p = await x.open('src/newtab.html');
  const data = await x.storage(p, 'nt_data');
  data.links.unshift({ id: 'lg', groupId: data.groups[0].id, title: 'Gatos fofos', url: 'https://gatos.example/', color: '', favicon: '' });
  if (enter) data.settings.searchEnter = enter;
  await x.seed(p, { nt_data: data });
  return p;
}

async function type(p, text) {
  await p.click('#omni');
  await p.keyboard.type(text);
  await p.waitForTimeout(300);
}

test('padrão: Enter pesquisa na internet, mesmo com um atalho na lista; as setas ainda escolhem outro item', async () => {
  const x = await launch();
  try {
    let p = await setup(x);
    await type(p, 'gatos');
    assert.match(await p.textContent('.omni-item.sel'), /Pesquisar "gatos" no Google.*Enter/);
    await p.keyboard.press('Enter');
    await p.waitForURL(/google\.com\/search\?q=gatos/);

    p = await x.open('src/newtab.html');
    await type(p, 'gatos');
    for (let i = 0; i < 5; i++) await p.keyboard.press('ArrowUp');
    assert.match(await p.textContent('.omni-item.sel'), /Gatos fofos/);
    await p.keyboard.press('Enter');
    await p.waitForURL('https://gatos.example/');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('"Abrir o primeiro resultado" abre o atalho; sem resultado, pesquisa', async () => {
  const x = await launch();
  try {
    let p = await setup(x, 'first');
    await type(p, 'gatos');
    await p.keyboard.press('Enter');
    await p.waitForURL('https://gatos.example/');
    p = await x.open('src/newtab.html');
    await type(p, 'zzqx nada');
    await p.keyboard.press('Enter');
    await p.waitForURL(/google\.com\/search/);
  } finally {
    await x.close();
  }
});

test('"Salvar como tarefa" cria a tarefa com o lembrete do texto; Shift+Enter continua salvando nota', async () => {
  const x = await launch();
  try {
    const p = await setup(x, 'task');
    await type(p, 'pagar a conta de luz amanhã às 9h');
    assert.match(await p.textContent('.omni-item.sel'), /Salvar como tarefa.*Enter/);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    let brain = await x.storage(p, 'nt_brain');
    const task = brain.find((i) => i.type === 'task');
    assert.ok(task, 'tarefa criada');
    assert.equal(new Date(task.remindAt).getHours(), 9);
    assert.equal(await p.inputValue('#omni'), '');

    await type(p, 'uma ideia solta');
    await p.keyboard.press('Shift+Enter');
    await p.waitForTimeout(400);
    brain = await x.storage(p, 'nt_brain');
    assert.ok(brain.find((i) => i.type === 'note' && i.text === 'uma ideia solta'));
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Opções: o Enter da barra pode ser trocado', async () => {
  const x = await launch();
  try {
    const o = await x.open('src/options.html#pesquisa');
    assert.equal(await o.inputValue('select[data-k="searchEnter"]'), 'web');
    await o.selectOption('select[data-k="searchEnter"]', 'ask');
    await o.waitForTimeout(300);
    assert.equal((await x.storage(o, 'nt_data')).settings.searchEnter, 'ask');
  } finally {
    await x.close();
  }
});
