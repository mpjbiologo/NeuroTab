// Rota traçada dentro do widget Trânsito (maximizado), sem abrir site externo, e favoritos salvos ali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const CORS = { 'access-control-allow-origin': '*' };
const PLACES = [
  { id: 'c', name: 'Casa', icon: '🏠', address: 'Rua A, 10, Itaúna - MG', lat: -20.075, lon: -44.576 },
  { id: 't', name: 'Trabalho', icon: '💼', address: 'Av. B, 200, Itaúna - MG', lat: -20.06, lon: -44.56 },
];
const OSRM = {
  code: 'Ok',
  routes: [{
    distance: 2300, duration: 420,
    geometry: { coordinates: [[-44.576, -20.075], [-44.572, -20.071], [-44.566, -20.068], [-44.561, -20.066]] },
    legs: [{ steps: [
      { maneuver: { type: 'depart' }, name: 'Rua A', distance: 300 },
      { maneuver: { type: 'turn', modifier: 'right' }, name: 'Av. Jove Soares', distance: 2000 },
      { maneuver: { type: 'arrive' }, name: '', distance: 0 },
    ] }],
  }],
};

async function setup({ widgets = [{ id: 'ask', w: 6 }, { id: 'traffic', w: 6 }], access = true } = {}) {
  const x = await launch({ ai: () => 'NÃO DEVIA PERGUNTAR À IA' });
  const net = { geo: [], osrm: [] };
  if (access) await x.ctx.addInitScript(() => { if (globalThis.chrome?.permissions) { chrome.permissions.contains = async () => true; chrome.permissions.request = async () => true; } });
  await x.ctx.route('https://nominatim.openstreetmap.org/**', (r) => {
    net.geo.push(new URL(r.request().url()).searchParams.get('q'));
    r.fulfill({ json: [{ name: 'Shopping Itaúna', display_name: 'Shopping Itaúna, Centro, Itaúna, MG, Brasil', lat: '-20.066', lon: '-44.561' }], headers: CORS });
  });
  await x.ctx.route('https://routing.openstreetmap.de/**', (r) => { net.osrm.push(r.request().url()); r.fulfill({ json: OSRM, headers: CORS }); });
  const p = await x.open('src/newtab.html');
  const data = await x.storage(p, 'nt_data');
  data.settings.ai = { ...data.settings.ai, keys: { gemini: 'K' }, autoEnrich: false, semantic: false };
  data.settings.mapPlaces = PLACES;
  data.settings.mapRoutes = [];
  data.settings.widgets = widgets;
  await x.seed(p, { nt_data: data, nt_brain: [] });
  const ask = async (q) => {
    await p.fill('.widget[data-id="ask"] input', q);
    await p.keyboard.press('Enter');
    await p.waitForSelector('.widget[data-id="ask"] .msg.bot:not(.typing) >> nth=-1');
    return p.locator('.widget[data-id="ask"] .msg.bot').last();
  };
  const traffic = p.locator('.widget[data-id="traffic"]');
  return { x, p, ask, traffic, net };
}

test('"traçar rota para…" desenha o trajeto no widget Trânsito maximizado, sem a IA e sem site externo', async () => {
  const { x, p, ask, traffic, net } = await setup();
  try {
    const pages = x.ctx.pages().length;
    const m = await ask('Traçar rota para o Shopping Itaúna');
    assert.match(await m.textContent(), /Rota até Shopping Itaúna no widget Trânsito/);
    await p.waitForSelector('.widget[data-id="traffic"].maximized .rmap-route');
    assert.equal(x.calls.ai.filter((s) => s.includes('NOTAS DO USUÁRIO')).length, 0, 'a IA não foi chamada');
    assert.equal(x.ctx.pages().length, pages, 'nenhuma aba nova foi aberta');
    assert.deepEqual(net.geo, ['Shopping Itaúna'], 'destino procurado pelo nome');
    assert.match(net.osrm[0], /routed-car\/route\/v1\/driving\/-44\.576,-20\.075;-44\.561,-20\.066/, 'sai de Casa');
    assert.match(await traffic.locator('.route-sum').textContent(), /2,3 km · 7 min[\s\S]*Casa → .*Shopping Itaúna/);
    const d = await traffic.locator('.rmap-route').getAttribute('d');
    assert.ok(d.startsWith('M') && d.split('L').length >= 3, d);
    assert.equal(await traffic.locator('.rmap-pin').count(), 2);
    assert.equal(await traffic.locator('.route-steps li').count(), 3);
    // O mapa fica dentro da área do widget maximizado.
    const card = await traffic.boundingBox();
    const map = await traffic.locator('.rmap').boundingBox();
    assert.ok(map.width > 400 && map.height > 200 && map.x >= card.x && map.x + map.width <= card.x + card.width + 1, JSON.stringify({ card, map }));

    // Salvar o destino nos favoritos, ali mesmo.
    await traffic.getByRole('button', { name: '⭐ Salvar destino' }).click();
    await traffic.locator('.save-place input').fill('Shopping');
    await traffic.locator('.save-place .chip', { hasText: '🛒' }).click();
    await traffic.getByRole('button', { name: '⭐ Salvar nos favoritos' }).click();
    await p.waitForTimeout(300);
    const saved = (await x.storage(p, 'nt_data')).settings.mapPlaces;
    assert.deepEqual(saved.map((s) => [s.name, s.icon, s.lat, s.lon]).at(-1), ['Shopping', '🛒', -20.066, -44.561]);
    // Agora origem e destino são favoritos: dá para salvar a rota.
    await traffic.getByRole('button', { name: '🧭 Salvar rota' }).click();
    await p.waitForTimeout(300);
    const rs = (await x.storage(p, 'nt_data')).settings.mapRoutes;
    assert.equal(rs.length, 1);
    assert.equal(rs[0].from, 'c');

    await p.keyboard.press('Escape');
    assert.equal(await traffic.evaluate((el) => el.classList.contains('maximized')), false, 'Esc restaura o tamanho');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('sem o widget Trânsito na tela, ele é acrescentado e mostra a rota', async () => {
  const { x, p, ask, traffic } = await setup({ widgets: [{ id: 'ask', w: 12 }] });
  try {
    await ask('rota para o trabalho');
    await p.waitForSelector('.widget[data-id="traffic"].maximized .rmap-route');
    assert.match(await traffic.locator('.route-sum').textContent(), /Casa → 💼 Trabalho/);
    const ids = (await x.storage(p, 'nt_data')).settings.widgets.map((w) => w.id);
    assert.deepEqual(ids, ['ask', 'traffic']);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('formulário 🧭 do widget e botão ⭐ Salvar local sempre à vista', async () => {
  const { x, p, traffic, net } = await setup({ widgets: [{ id: 'traffic', w: 12 }] });
  try {
    assert.equal(await traffic.getByRole('button', { name: '⭐ Salvar local' }).count(), 1);
    await traffic.locator('button[title="Traçar rota"]').click();
    await traffic.locator('.route-form input').fill('Trabalho');
    await traffic.getByRole('button', { name: 'Traçar' }).click();
    await p.waitForSelector('.widget[data-id="traffic"] .rmap-route');
    assert.deepEqual(net.geo, [], 'local salvo não precisa procurar endereço');
    assert.equal(await traffic.evaluate((el) => el.classList.contains('maximized')), false, 'pelo formulário não maximiza sozinho');
    assert.equal(await traffic.getByRole('button', { name: '⭐ Salvar destino' }).count(), 0, 'destino já é favorito');
  } finally {
    await x.close();
  }
});

test('sem acesso ao OpenStreetMap, pede permissão em vez de falhar', async () => {
  const { x, p, ask, traffic } = await setup({ access: false });
  try {
    await ask('traçar rota para o centro');
    await p.waitForSelector('.widget[data-id="traffic"].maximized .route-msg');
    assert.equal(await traffic.getByRole('button', { name: /Permitir e traçar/ }).count(), 1);
  } finally {
    await x.close();
  }
});
