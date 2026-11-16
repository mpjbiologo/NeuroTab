// Mapa próprio do trajeto (widget Trânsito) e funções de rota do OpenStreetMap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, fitView, tilesFor, toScreen, simplifyScreen, TILE, PROVIDERS, chooseProvider, resetProvider } from '../../src/lib/route-map.js';
import { streetRoute, geocode, stepText } from '../../src/lib/places.js';

test('projeção Web Mercator: ida e volta e pontos conhecidos', () => {
  assert.deepEqual(project(0, 0, 0).map(Math.round), [128, 128]);
  const [x, y] = project(-44.576, -20.075, 14);
  const [lon, lat] = unproject(x, y, 14);
  assert.ok(Math.abs(lon + 44.576) < 1e-9 && Math.abs(lat + 20.075) < 1e-9);
});

test('enquadra o trajeto no maior zoom que cabe', () => {
  const pts = [[-44.576, -20.075], [-44.56, -20.06]];
  const v = fitView(pts, 600, 400, 30);
  for (const [lon, lat] of pts) {
    const [sx, sy] = toScreen(lon, lat, v, 600, 400);
    assert.ok(sx >= 30 - 1 && sx <= 570 + 1 && sy >= 30 - 1 && sy <= 370 + 1, `${sx},${sy}`);
  }
  const bigger = fitView(pts, 600, 400, 30, 18);
  assert.ok(fitView(pts, 300, 200, 30).z < bigger.z || bigger.z === 18, 'tela menor, zoom menor');
  assert.equal(fitView([], 600, 400), null);
});

test('ladrilhos cobrem a tela inteira, sem buracos', () => {
  const v = { z: 13, lon: -44.57, lat: -20.07 };
  const ts = tilesFor(v, 700, 500);
  assert.ok(ts.length >= 6);
  for (const [px, py] of [[0, 0], [699, 0], [0, 499], [699, 499], [350, 250]]) {
    assert.ok(ts.some((t) => px >= t.left && px < t.left + TILE && py >= t.top && py < t.top + TILE), `ponto ${px},${py}`);
  }
  // o centro da tela é o ponto pedido
  const [cx, cy] = toScreen(v.lon, v.lat, v, 700, 500);
  assert.deepEqual([Math.round(cx), Math.round(cy)], [350, 250]);
});

test('simplifica pontos no mesmo pixel e mantém o último', () => {
  const s = simplifyScreen([[0, 0], [0.2, 0.1], [0.4, 0.3], [5, 5], [5.1, 5]]);
  assert.deepEqual(s, [[0, 0], [5, 5], [5.1, 5]]);
});

test('streetRoute: linha, tempo e passo a passo do OSRM', async () => {
  let url = '';
  const fetchFn = async (u) => { url = u; return { ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 2300, duration: 420, geometry: { coordinates: [[-44.576, -20.075], [-44.57, -20.07], [-44.56, -20.06]] }, legs: [{ steps: [{ maneuver: { type: 'depart', modifier: 'left' }, name: 'Rua A', distance: 300 }, { maneuver: { type: 'turn', modifier: 'right' }, name: 'Av. B', distance: 2000 }, { maneuver: { type: 'arrive' }, name: 'Av. B', distance: 0 }] }] }] }) }; };
  const r = await streetRoute({ lat: -20.075, lon: -44.576 }, { lat: -20.06, lon: -44.56 }, 'walking', fetchFn);
  assert.match(url, /routed-foot\/route\/v1\/foot\/-44\.576,-20\.075;-44\.56,-20\.06\?overview=full&geometries=geojson&steps=true/);
  assert.equal(r.km, 2.3);
  assert.equal(r.min, 7);
  assert.equal(r.coords.length, 3);
  assert.deepEqual(r.steps.map((s) => stepText(s)), ['Saia na Rua A', 'Vire à direita na Av. B', '🏁 Chegada — Av. B']);
  assert.equal(stepText({ type: 'roundabout', modifier: 'right', name: 'Rua C' }, 'en'), 'At the roundabout, exit on Rua C');
  assert.equal(await streetRoute({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, 'driving', async () => ({ ok: true, json: async () => ({ code: 'NoRoute', routes: [] }) })), null);
});

test('geocode: procura perto da casa e devolve coordenadas', async () => {
  let url;
  const fetchFn = async (u) => { url = new URL(u); return { ok: true, json: async () => [{ name: 'Shopping Itaúna', display_name: 'Shopping Itaúna, Centro, Itaúna, MG', lat: '-20.07', lon: '-44.57' }, { display_name: 'sem coordenada' }] }; };
  const r = await geocode('shopping itaúna', { near: { lat: -20.075, lon: -44.576 }, fetchFn });
  assert.equal(url.origin, 'https://nominatim.openstreetmap.org');
  assert.equal(url.searchParams.get('q'), 'shopping itaúna');
  assert.equal(url.searchParams.get('limit'), '1');
  assert.ok(url.searchParams.get('viewbox'), 'tem a região de preferência');
  assert.deepEqual(r, [{ name: 'Shopping Itaúna', address: 'Shopping Itaúna, Centro, Itaúna, MG', lat: -20.07, lon: -44.57 }]);
});

test('ladrilhos: se o OpenStreetMap recusar (sem Referer), usa o próximo servidor', async () => {
  const asked = [];
  const res = (ok, type) => ({ ok, headers: { get: () => type } });
  resetProvider();
  const p = await chooseProvider(async (u) => { asked.push(new URL(u).host); return u.includes('tile.openstreetmap.org') ? res(false, 'image/png') : u.includes('.de/') ? res(true, 'text/html') : res(true, 'image/png'); });
  assert.equal(p.id, 'osm-fr');
  assert.deepEqual(asked, ['tile.openstreetmap.org', 'tile.openstreetmap.de', 'a.tile.openstreetmap.fr']);
  assert.equal(await chooseProvider(async () => { throw new Error('não devia testar de novo'); }), p, 'escolha guardada');
  resetProvider();
  assert.equal((await chooseProvider(async () => { throw new Error('offline'); })).id, PROVIDERS[0].id, 'sem rede: o primeiro');
  resetProvider();
  assert.match(PROVIDERS.find((x) => x.id === 'esri').url(5, 10, 20), /tile\/5\/20\/10$/, 'Esri usa z/y/x');
});

test('rota: se o primeiro servidor recusar, usa o Valhalla (e explica as falhas)', async () => {
  const { decodePolyline } = await import('../../src/lib/places.js');
  const asked = [];
  // polilinha precisão 6 de dois pontos
  const enc = (pts) => { let out = '', plat = 0, plon = 0; const e = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); }; for (const [lon, lat] of pts) { const a = Math.round(lat * 1e6), b = Math.round(lon * 1e6); out += e(a - plat) + e(b - plon); plat = a; plon = b; } return out; };
  const shape = enc([[-43.94, -19.92], [-43.93, -19.91]]);
  assert.deepEqual(decodePolyline(shape, 6), [[-43.94, -19.92], [-43.93, -19.91]]);
  const fetchFn = async (u) => {
    const host = new URL(u).host;
    asked.push(host);
    if (host === 'routing.openstreetmap.de') return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, json: async () => ({ trip: { status: 0, summary: { length: 1.6, time: 300 }, legs: [{ shape, maneuvers: [{ instruction: 'Siga para o norte na Rua X.', length: 1.6, type: 1 }, { instruction: 'Você chegou ao seu destino.', length: 0, type: 4 }] }] } }) };
  };
  const r = await streetRoute({ lat: '-19.92', lon: '-43.94' }, { lat: -19.91, lon: -43.93 }, 'driving', fetchFn);
  assert.deepEqual(asked, ['routing.openstreetmap.de', 'valhalla1.openstreetmap.de']);
  assert.equal(r.router, 'fossgis-valhalla');
  assert.equal(r.km, 1.6);
  assert.equal(r.min, 5);
  assert.equal(r.coords.length, 2);
  assert.deepEqual(r.steps.map((s) => stepText(s)), ['Siga para o norte na Rua X.', '🏁 Você chegou ao seu destino.']);
  assert.deepEqual(streetRoute.lastErrors, ['fossgis-osrm: HTTP 403']);
  // todos fora: null e os três motivos
  assert.equal(await streetRoute({ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, 'driving', async () => { throw new Error('Failed to fetch'); }), null);
  assert.equal(streetRoute.lastErrors.length, 3);
  // a pé: o servidor de demonstração (só carro) não é tentado
  await streetRoute({ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, 'walking', async () => { throw new Error('x'); });
  assert.equal(streetRoute.lastErrors.length, 2);
});
