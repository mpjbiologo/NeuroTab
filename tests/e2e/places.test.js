// O cérebro lê o widget de mapas: responde sobre locais e trajetos, sem IA e com IA (#43).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const PLACES = [
  { id: 'c', name: 'Casa', icon: '🏠', address: 'Rua A, 10, Itaúna - MG', lat: -20.075, lon: -44.576 },
  { id: 't', name: 'Trabalho', icon: '💼', address: 'Av. B, 200, Itaúna - MG', lat: -20.06, lon: -44.56 },
];

async function setup({ withAi = false, sharePlaces } = {}) {
  let sysSeen = '';
  const x = await launch({ ai: (sys) => { if (sys.includes('NOTAS DO USUÁRIO')) { sysSeen = sys; return 'Usei seus locais salvos: de Casa até o Trabalho são uns 2,3 km.'; } return null; } });
  const p = await x.open('src/newtab.html');
  const data = await x.storage(p, 'nt_data');
  data.settings.ai = { ...data.settings.ai, keys: withAi ? { gemini: 'K' } : {}, autoEnrich: false, semantic: false, ...(sharePlaces === false ? { sharePlaces: false } : {}) };
  data.settings.mapPlaces = PLACES;
  data.settings.mapRoutes = [{ id: 'r', from: 'c', to: 't', mode: 'driving', name: 'Ida ao trabalho' }];
  data.settings.widgets = [{ id: 'ask', w: 12 }];
  await x.seed(p, { nt_data: data, nt_brain: [] });
  const ask = async (q) => {
    await p.fill('.widget[data-id="ask"] input', q);
    await p.keyboard.press('Enter');
    await p.waitForSelector('.widget[data-id="ask"] .msg.bot:not(.typing) >> nth=-1');
    await p.waitForTimeout(300);
    return p.locator('.widget[data-id="ask"] .msg.bot').last();
  };
  return { x, p, ask, sys: () => sysSeen };
}

test('sem IA: distância, endereço e botões do Google Maps e do Waze', async () => {
  const { x, ask } = await setup();
  try {
    const m = await ask('quanto tempo até o trabalho?');
    assert.match(await m.textContent(), /linha reta, de Casa até Trabalho são [\d,]+ km/);
    const links = await m.locator('a').evaluateAll((as) => as.map((a) => a.href));
    assert.ok(links.some((u) => u.startsWith('https://www.google.com/maps/dir/') && u.includes('destination=-20.06%2C-44.56')), links.join(' '));
    assert.ok(links.some((u) => u.startsWith('https://waze.com/ul?ll=-20.06,-44.56')), links.join(' '));
    assert.equal(await m.locator('button', { hasText: 'Tempo pela rua' }).count(), 1);
    const e = await ask('qual o endereço do trabalho');
    assert.match(await e.textContent(), /Av\. B, 200/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('com IA: locais e rotas vão no contexto só quando a pergunta é sobre lugares', async () => {
  const { x, ask, sys } = await setup({ withAi: true });
  try {
    const m = await ask('quanto tempo até o trabalho?');
    assert.match(await m.textContent(), /Usei seus locais salvos/);
    assert.match(sys(), /LOCAIS E ROTAS SALVOS NO WIDGET DE MAPAS[\s\S]*💼 Trabalho — Av\. B, 200[\s\S]*Ida ao trabalho/);
    assert.equal(await m.locator('a', { hasText: 'Waze' }).count(), 1, 'botões do trajeto junto da resposta da IA');
    await ask('qual a receita de bolo?');
    assert.doesNotMatch(sys(), /LOCAIS E ROTAS/, 'pergunta que não é sobre lugares não leva os endereços');
  } finally {
    await x.close();
  }
});

test('opção de não enviar endereços à IA', async () => {
  const { x, ask, sys } = await setup({ withAi: true, sharePlaces: false });
  try {
    await ask('quanto tempo até o trabalho?');
    assert.doesNotMatch(sys(), /LOCAIS E ROTAS|Av\. B/);
  } finally {
    await x.close();
  }
});
