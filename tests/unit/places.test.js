// Locais e rotas do widget de mapas: o cérebro responde sobre lugares e trajetos (#43).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeTarget, isBareRouteAsk, haversineKm, formatKm, formatMin, placesIn, isPlacesQuestion, resolveTrip, localAnswer, placesContext, streetEstimate, gmapsRoute, wazeTo } from '../../src/lib/places.js';

const casa = { id: 'c', name: 'Casa', icon: '🏠', address: 'Rua A, 10, Itaúna - MG', lat: -20.0750, lon: -44.5760 };
const trab = { id: 't', name: 'Trabalho', icon: '💼', address: 'Av. B, 200, Itaúna - MG', lat: -20.0600, lon: -44.5600 };
const acad = { id: 'a', name: 'Academia Central', icon: '🏋️', lat: -20.0800, lon: -44.5900 };
const settings = { mapPlaces: [casa, trab, acad], mapRoutes: [{ id: 'r1', from: 'c', to: 't', mode: 'driving', name: 'Ida ao trabalho' }] };

test('distância em linha reta e formatação', () => {
  // Itaúna → Belo Horizonte: ~70 km em linha reta
  const bh = { lat: -19.9167, lon: -43.9345 };
  const d = haversineKm({ lat: -20.0750, lon: -44.5760 }, bh);
  assert.ok(d > 65 && d < 72, String(d));
  assert.equal(haversineKm(casa, casa), 0);
  assert.equal(formatKm(3.24), '3,2 km');
  assert.equal(formatKm(3.24, 'en'), '3.2 km');
  assert.equal(formatKm(0.853), '850 m');
  assert.equal(formatKm(23.6), '24 km');
  assert.equal(formatMin(12.4), '12 min');
  assert.equal(formatMin(95), '1 h 35 min');
  assert.equal(formatMin(120), '2 h');
});

test('acha os lugares citados (nome inteiro, sem acento, o mais longo primeiro)', () => {
  assert.deepEqual(placesIn('quanto tempo até a academia central?', settings.mapPlaces), [acad]);
  assert.deepEqual(placesIn('de casa ao TRABALHO', settings.mapPlaces).map((p) => p.id).sort(), ['c', 't']);
  assert.deepEqual(placesIn('casamento no sábado', settings.mapPlaces), [], 'casa dentro de outra palavra não conta');
  assert.equal(isPlacesQuestion('qual a distância até o trabalho', settings.mapPlaces), true);
  assert.equal(isPlacesQuestion('receita de bolo', settings.mapPlaces), false);
  assert.equal(isPlacesQuestion('qual a distância até o trabalho', []), false, 'sem locais salvos');
});

test('origem e destino: dois lugares, rota salva ou casa', () => {
  assert.deepEqual(resolveTrip('de trabalho até casa', settings.mapPlaces, settings.mapRoutes), { from: trab, to: casa, mode: 'driving' });
  assert.equal(resolveTrip('quanto tempo até o trabalho', settings.mapPlaces, settings.mapRoutes).from, casa, 'pela rota salva');
  assert.equal(resolveTrip('distância até a academia central', settings.mapPlaces, []).from, casa, 'casa como origem');
  assert.equal(resolveTrip('distância até casa', settings.mapPlaces, []).from, null, 'casa até casa não faz sentido');
  assert.equal(resolveTrip('e o mercado?', settings.mapPlaces, []), null);
});

test('respostas sem IA: endereço, distância, tempo, listas', () => {
  const a = localAnswer('qual o endereço do trabalho?', settings);
  assert.equal(a.kind, 'address');
  assert.match(a.text, /Av\. B, 200/);
  const d = localAnswer('qual a distância de casa até a academia central', settings);
  assert.match(d.text, /linha reta, de Casa até Academia Central são [\d,]+ km/);
  assert.equal(d.trip.to, acad);
  const t = localAnswer('quanto tempo até o trabalho agora?', settings);
  assert.equal(t.kind, 'time');
  assert.match(t.text, /Waze ou no Google Maps/);
  assert.match(localAnswer('quais são meus locais salvos?', settings).text, /🏠 Casa, 💼 Trabalho, 🏋️ Academia Central/);
  assert.match(localAnswer('quais rotas eu tenho salvas?', settings).text, /Ida ao trabalho \(carro\)/);
  assert.match(localAnswer('qual o endereço da academia central', settings).text, /só a posição no mapa/);
  assert.equal(localAnswer('qual a capital da França?', settings), null);
  assert.equal(localAnswer('anotar comprar pão', settings), null);
});

test('respostas em inglês e espanhol', () => {
  const en = { mapPlaces: [{ ...casa, name: 'Home' }, { ...trab, name: 'Office' }], mapRoutes: [] };
  assert.match(localAnswer('how far is the office', en, 'en').text, /from Home to Office it is [\d.]+ km/);
  assert.match(localAnswer('what is the address of the office', en, 'en').text, /The address of Office is/);
  const es = { mapPlaces: [casa, { ...trab, name: 'Trabajo' }], mapRoutes: [] };
  assert.match(localAnswer('¿cuánto tarda hasta el trabajo?', es, 'es').text, /En línea recta, de Casa a Trabajo[\s\S]*Waze o Google Maps/);
});

test('contexto para a IA só quando a pergunta é sobre lugares e se permitido', () => {
  const c = placesContext(settings, 'quanto tempo até o trabalho?');
  assert.match(c.title, /LOCAIS E ROTAS/);
  assert.match(c.text, /💼 Trabalho — Av\. B, 200/);
  assert.match(c.text, /Ida ao trabalho: de Casa para Trabalho, modo driving, [\d,]+ km em linha reta/);
  assert.equal(placesContext(settings, 'receita de bolo de cenoura'), null);
  assert.equal(placesContext({ ...settings, ai: { sharePlaces: false } }, 'distância até o trabalho'), null, 'opção de nunca enviar endereços');
  assert.equal(placesContext({}, 'distância até o trabalho'), null);
});

test('tempo pela rua (OSRM) e links dos apps', async () => {
  let url = '';
  const fetchFn = async (u) => { url = u; return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 4300, duration: 540 }] })); };
  assert.deepEqual(await streetEstimate(casa, trab, 'driving', fetchFn), { km: 4.3, min: 9 });
  assert.match(url, /routed-car\/route\/v1\/driving\/-44\.576,-20\.075;-44\.56,-20\.06/);
  await streetEstimate(casa, trab, 'walking', fetchFn);
  assert.match(url, /routed-foot\/route\/v1\/foot/);
  assert.equal(await streetEstimate(casa, trab, 'driving', async () => new Response('{}', { status: 500 })), null);
  assert.equal(await streetEstimate(casa, trab, 'driving', async () => new Response(JSON.stringify({ code: 'NoRoute' }))), null);
  assert.match(gmapsRoute(casa, trab), /origin=-20\.075%2C-44\.576&destination=-20\.06%2C-44\.56&travelmode=driving/);
  assert.equal(wazeTo(trab), 'https://waze.com/ul?ll=-20.06,-44.56&navigate=yes');
});

test('pedidos de rota em linguagem natural (#43)', () => {
  const tgt = (q) => routeTarget(q)?.target ?? null;
  assert.equal(tgt('Traçar rota para o Shopping Itaúna'), 'Shopping Itaúna');
  assert.equal(tgt('qual a rota para Divinópolis?'), 'Divinópolis');
  assert.equal(tgt('Verônica, traça a rota pro trabalho'), 'trabalho', 'chamado antes da vírgula');
  assert.equal(tgt('abre o mapa até o hospital'), 'hospital');
  assert.equal(tgt('quero ir para o centro'), 'centro');
  assert.equal(tgt('qual a melhor rota para emagrecer?'), null, 'verbo no infinitivo não é lugar');
  assert.equal(tgt('rota para ganhar massa'), null);
  assert.ok(isBareRouteAsk('traçar rota') && isBareRouteAsk('Verônica, me mostra a rota'));
  assert.equal(localAnswer('traçar rota', settings).kind, 'route-where');
  // origem e destino pelo texto: "de casa até o centro" vai ao centro, não à Casa
  const a = localAnswer('faça uma rota de casa até o centro', settings);
  assert.equal(a.kind, 'route');
  assert.equal(a.trip.from.id, 'c');
  assert.deepEqual(a.trip.to, { name: 'centro', query: 'centro' });
  // destino salvo usa a rota favorita (de Casa)
  assert.equal(localAnswer('rota para o trabalho', settings).trip.from.id, 'c');
  // sem locais salvos, a IA é avisada de que a NeuroTab abre rotas
  assert.match(placesContext({}, 'você consegue me mostrar rotas no mapa?').note, /nunca diga que não consegue traçar rotas/);
});
