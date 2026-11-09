// Permissões sob demanda (#3): painel nas configurações e widgets pedindo acesso só quando usados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

test('painel de permissões lista cada recurso com o motivo', async () => {
  const x = await launch();
  try {
    const o = await x.open('src/options.html');
    await o.waitForSelector('#permList .opt');
    const text = await o.textContent('#permList');
    for (const label of ['Clima e fusos horários', 'Cotações e conversão de moedas', 'Endereços do widget Trânsito', 'Fotos do dia nos slides', 'Provedores de IA']) assert.ok(text.includes(label), label);
    assert.match(text, /Sempre ativo/);
    assert.match(text, /Não permitido/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('widget Cotações pede acesso antes de buscar dados', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { widgets: [{ id: 'quotes', w: 4 }] });
    await p.waitForSelector('.widget[data-id=quotes] .btn.primary');
    assert.match(await p.textContent('.widget[data-id=quotes]'), /Permitir acesso às cotações/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
