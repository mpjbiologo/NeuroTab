// Data Hub (#71): leitura das fontes (respostas gravadas), lista, cota, pregão, alertas e textos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItem, sanitizeWatch, sanitizeDatahub, migrateQuotes, DEFAULT_WATCH, itemKey } from '../../src/lib/datahub/prefs.js';
import { parseBrapi, parseAwesome, parseBcb, parseHgQuotes, parseHgIndicators, parseHgWeather, parseHgGeo, brapiUrl, hgTicker, hgQuotesUrl, bcbUrl, SourceError } from '../../src/lib/datahub/sources.js';
import { allowance, addUse, usageOf, b3Open, estimateMonth, bucketOf, limitsFor } from '../../src/lib/datahub/quota.js';
import { evaluateAlerts, alertText, tomorrowFrom } from '../../src/lib/datahub/alerts.js';
import { priceText, changeText, provenance, spokenLine, itemTitle } from '../../src/lib/datahub/format.js';
import { mergeSettings } from '../../src/lib/store.js';

test('lista: o que a pessoa digita vira ativo', () => {
  const p = (s, k) => { const r = parseItem(s, k); return r && `${r.kind}:${r.sym}`; };
  assert.equal(p('petr4'), 'stock:PETR4');
  assert.equal(p('HGLG11'), 'stock:HGLG11');
  assert.equal(p('usd'), 'currency:USD-BRL');
  assert.equal(p('eur-usd'), 'currency:EUR-USD');
  assert.equal(p('btc'), 'crypto:BTC-BRL');
  assert.equal(p('BTC-USD'), 'crypto:BTC-USD');
  assert.equal(p('ibovespa'), 'index:IBOV');
  assert.equal(p('selic'), 'indicator:SELIC');
  assert.equal(p('ipca'), 'indicator:IPCA');
  assert.equal(p('xyz123'), null);
  assert.equal(p('USD', 'stock'), null);
});

test('lista: migra as opções antigas e tem padrões', () => {
  const m = migrateQuotes({ quoteCurrencies: 'USD-BRL,BTC-BRL', quoteStocks: 'PETR4,MXRF11' });
  assert.deepEqual(m.map(itemKey), ['currency:USD-BRL', 'crypto:BTC-BRL', 'index:IBOV', 'stock:PETR4', 'stock:MXRF11', 'indicator:SELIC', 'indicator:IPCA']);
  const s = mergeSettings({ quoteCurrencies: 'EUR-BRL', quoteStocks: '' });
  assert.ok(s.watch.items.some((i) => i.sym === 'EUR-BRL'));
  assert.deepEqual(mergeSettings({}).watch.items.length, DEFAULT_WATCH.items.length);
  assert.equal(sanitizeWatch({ items: [{ kind: 'stock', sym: 'petr4' }, { kind: 'stock', sym: 'PETR4' }, { kind: 'x', sym: 'a' }], refreshMin: 7 }).items.length, 1);
  assert.equal(sanitizeWatch({ items: [], refreshMin: 7 }).refreshMin, 30);
  const d = sanitizeDatahub({ enabled: { hg: true }, order: { stock: ['hg', 'nada'] }, limits: { brapi: { month: 150000, batch: 10 }, x: { day: 1 } }, alerts: [{ type: 'above', item: 'stock:PETR4', value: '40' }, { type: 'bad', value: 1 }] });
  assert.deepEqual(d.order.stock, ['hg', 'brapi']);
  assert.equal(d.enabled.hg, true);
  assert.deepEqual(d.limits, { brapi: { month: 150000, batch: 10 } });
  assert.equal(d.alerts.length, 1);
  assert.equal(d.alerts[0].value, 40);
  assert.equal(mergeSettings({}).datahub.enabled.hg, false, 'HG só com a chave da pessoa');
  assert.equal(mergeSettings({}).datahub.alertsOn, false, 'alertas desligados por padrão');
});

test('BrAPI: cotação, índice e erros (token, plano, cota)', () => {
  assert.equal(brapiUrl([{ kind: 'index', sym: 'IBOV' }, { kind: 'stock', sym: 'PETR4' }], 'T'), 'https://brapi.dev/api/quote/%5EBVSP,PETR4?token=T');
  const r = parseBrapi({ results: [{ symbol: 'PETR4', shortName: 'PETROBRAS PN', regularMarketPrice: 38.2, regularMarketChangePercent: 1.25, currency: 'BRL', regularMarketTime: '2026-11-24T17:05:00.000Z' }, { symbol: '^BVSP', regularMarketPrice: 131000, regularMarketChangePercent: -0.4 }] });
  assert.deepEqual([r.PETR4.price, r.PETR4.pct, r.PETR4.name, r.PETR4.at], [38.2, 1.25, 'PETROBRAS PN', Date.parse('2026-11-24T17:05:00Z')]);
  assert.equal(r.IBOV.price, 131000);
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'ok'; };
  assert.equal(code(() => parseBrapi({ error: true, message: 'O seu plano não permite acessar este recurso. Faça upgrade' }, 403)), 'paid');
  assert.equal(code(() => parseBrapi({ error: true, message: 'Token inválido' }, 401)), 'key');
  assert.equal(code(() => parseBrapi({}, 429)), 'quota');
  assert.equal(code(() => parseBrapi({ error: true, message: 'Não encontramos a ação XPTO1' }, 404)), 'notfound');
});

test('AwesomeAPI e Banco Central', () => {
  const a = parseAwesome({ USDBRL: { code: 'USD', codein: 'BRL', name: 'Dólar Americano/Real Brasileiro', bid: '5.4321', pctChange: '-0.35', timestamp: '1795000000' } });
  assert.deepEqual([a['USD-BRL'].price, a['USD-BRL'].pct, a['USD-BRL'].name, a['USD-BRL'].at], [5.4321, -0.35, 'Dólar Americano', 1795000000000]);
  assert.throws(() => parseAwesome({ status: 404, code: 'CoinNotExists', message: 'moeda nao encontrada' }), (e) => e.code === 'notfound');
  assert.equal(bcbUrl('SELIC'), 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/2?formato=json');
  const s = parseBcb([{ data: '23/11/2026', valor: '15.00' }, { data: '24/11/2026', valor: '14.75' }], 'SELIC');
  assert.deepEqual([s.price, s.pct, s.period, s.pctIsPoints], [14.75, -0.25, '2026-11-24', true]);
  assert.throws(() => parseBcb([], 'SELIC'), SourceError);
});

test('HG Brasil: cotações, indicadores, clima, IP e erros', () => {
  assert.equal(hgTicker({ kind: 'currency', sym: 'USD-BRL' }), 'FOREX:USDBRL');
  assert.equal(hgTicker({ kind: 'stock', sym: 'PETR4' }), 'B3:PETR4');
  assert.equal(hgTicker({ kind: 'indicator', sym: 'SELIC' }), 'BCB:SELICMETA');
  assert.match(hgQuotesUrl([{ kind: 'stock', sym: 'PETR4' }], 'K'), /tickers=B3%3APETR4&key=K$/);
  const q = parseHgQuotes({ metadata: {}, results: [{ ticker: 'B3:PETR4', name: 'Petrobras', currency: 'BRL', quote: { value: 38.1, change_percent: 0.8, updated_at: '2026-11-24T14:00:00-03:00' } }, { ticker: 'FOREX:USDBRL', currency: 'BRL', quote: { value: 5.43, change_percent: -0.1 } }] });
  assert.equal(q.PETR4.price, 38.1);
  assert.equal(q['USD-BRL'].price, 5.43);
  const i = parseHgIndicators({ results: [{ ticker: 'IBGE:IPCA', summary: { last_12m: 4.31 }, series: [{ period: '2026-10', value: 0.32 }] }, { ticker: 'BCB:SELICMETA', series: [{ period: '2026-11-05', value: 14.75 }] }] });
  assert.deepEqual([i.IPCA.price, i.SELIC.price], [4.31, 14.75]);
  assert.throws(() => parseHgQuotes({ errors: [{ code: 'INVALID_API_KEY', message: 'Chave de API inválida.' }] }), (e) => e.code === 'key');
  assert.throws(() => parseHgIndicators({ errors: [{ code: 'UNAUTHORIZED_KEY', message: 'Chave não possui acesso para este recurso.' }] }), (e) => e.code === 'paid');
  const w = parseHgWeather({ valid_key: true, results: { temp: 27, description: 'Tempo nublado', city_name: 'Itaúna', sunrise: '05:21 am', sunset: '06:32 pm', moon_phase: 'full', forecast: [{ date: '24/11', max: 30, min: 18, rain_probability: 40 }, { date: '25/11', max: 28, min: 17, rain_probability: 80 }] } }, new Date(2026, 10, 24));
  assert.deepEqual([w.temp, w.moon, w.days[1].date, w.days[1].rainProb], [27, 'full', '2026-11-25', 80]);
  assert.throws(() => parseHgWeather({ valid_key: false, results: {} }), (e) => e.code === 'key');
  const g = parseHgGeo({ valid_key: true, results: { city: 'Itaúna', region: 'MG', country_name: 'Brasil', latitude: -20.07, longitude: -44.57 } });
  assert.deepEqual([g.name, g.lat], ['Itaúna', -20.07]);
});

test('cota: minuto, dia e mês; virada; plano próprio; estimativa', () => {
  const t0 = new Date(2026, 10, 24, 14, 0, 0).getTime();
  let u = {};
  u = addUse(u, "brapi", 11000, t0);
  assert.equal(allowance(u, 'brapi', {}, 1, t0).level, 'ok');
  u = addUse(u, 'brapi', 1500, t0);
  assert.equal(allowance(u, 'brapi', {}, 1, t0).level, 'warn');
  u = addUse(u, 'brapi', 2500, t0);
  const full = allowance(u, 'brapi', {}, 1, t0);
  assert.deepEqual([full.ok, full.which, full.limit], [false, 'month', 15000]);
  assert.ok(allowance(u, 'brapi', { brapi: { month: 150000 } }, 1, t0).ok, 'plano pago informado');
  assert.equal(usageOf(u, 'brapi', new Date(2026, 11, 1).getTime()).month, 0, 'vira o mês');
  let m = {};
  for (let i = 0; i < 20; i++) m = addUse(m, 'brapiNoKey', 1, t0);
  assert.equal(allowance(m, 'brapiNoKey', {}, 1, t0).which, 'minute');
  assert.ok(allowance(m, 'brapiNoKey', {}, 1, t0 + 61e3).ok, 'outro minuto');
  assert.equal(bucketOf('hg', 'weather'), 'hgWeather');
  assert.equal(bucketOf('brapi', 'stock', false), 'brapiNoKey');
  assert.equal(limitsFor('hgGeo').month, 100);
  assert.equal(estimateMonth({ brapiItems: 5, refreshMin: 30 }), 5 * 17 * 22);
  assert.ok(estimateMonth({ brapiItems: 25, refreshMin: 15 }) > 15000, 'mostra quando passa do grátis');
  assert.equal(estimateMonth({ brapiItems: 20, refreshMin: 15, batch: 10 }), 2 * 33 * 22);
});

test('pregão da B3', () => {
  assert.equal(b3Open(Date.parse('2026-11-24T14:00:00-03:00')), true);
  assert.equal(b3Open(Date.parse('2026-11-24T09:30:00-03:00')), false);
  assert.equal(b3Open(Date.parse('2026-11-24T18:00:00-03:00')), false);
  assert.equal(b3Open(Date.parse('2026-11-28T14:00:00-03:00')), false, 'sábado');
});

test('alertas: dispara uma vez e rearma quando volta', () => {
  const alerts = [{ id: 'a', type: 'above', item: 'stock:PETR4', value: 40, armed: true }, { id: 'b', type: 'pct', item: 'stock:VALE3', value: 3, armed: true }, { id: 'c', type: 'rain', value: 70, armed: true }];
  const q = (p, pct = 0, extra = {}) => ({ price: p, pct, source: 'brapi', ...extra });
  let r = evaluateAlerts(alerts, new Map([['stock:PETR4', q(39)], ['stock:VALE3', q(60, -3.5)]]), { rain: 80, max: 28, min: 18 });
  assert.deepEqual(r.fired.map((f) => f.alert.id), ['b', 'c']);
  r = evaluateAlerts(r.alerts, new Map([['stock:PETR4', q(41)], ['stock:VALE3', q(60, -4)]]), { rain: 90, max: 28, min: 18 });
  assert.deepEqual(r.fired.map((f) => f.alert.id), ['a'], 'b e c não repetem');
  r = evaluateAlerts(r.alerts, new Map([['stock:PETR4', q(39)], ['stock:VALE3', q(60, 1)]]), { rain: 10 });
  assert.equal(r.fired.length, 0);
  assert.ok(r.alerts.every((a) => a.armed), 'rearmados');
  r = evaluateAlerts(r.alerts, new Map([['stock:PETR4', q(45, 0, { stale: true })]]), null);
  assert.equal(r.fired.length, 0, 'valor desatualizado não dispara');
  assert.match(alertText({ alert: alerts[0], quote: q(41, 1.2) }).title, /PETR4 acima de 40/);
  assert.match(alertText({ alert: alerts[2] }, { rain: 80, max: 28, min: 18 }).title, /Chuva amanhã: 80%/);
  assert.deepEqual(tomorrowFrom({ daily: { time: ['a', '2026-11-25'], precipitation_probability_max: [1, 70], temperature_2m_max: [1, 30], temperature_2m_min: [1, 18] } }), { date: '2026-11-25', rain: 70, max: 30, min: 18 });
});

test('textos: valor com fonte, horário e atraso', () => {
  const at = new Date(2026, 10, 24, 14, 5).getTime();
  const it = { kind: 'stock', sym: 'PETR4' };
  const v = { price: 38.2, pct: 1.25, cur: 'BRL', source: 'brapi', at, delay: 30 };
  assert.equal(priceText(it, v), 'R$ 38,20');
  assert.deepEqual(changeText(it, v), { text: '▲ 1,25%', cls: 'up' });
  assert.equal(provenance(v, at + 60e3), 'BrAPI · 14:05 · atraso de ~30 min');
  assert.equal(provenance({ ...v, stale: true }, at), 'BrAPI · 14:05 · atraso de ~30 min · desatualizado');
  assert.equal(priceText({ kind: 'indicator', sym: 'SELIC' }, { price: 14.75 }), '14,75%');
  assert.equal(priceText({ kind: 'index', sym: 'IBOV' }, { price: 131234.5 }), '131.235 pts');
  assert.equal(itemTitle({ kind: 'currency', sym: 'USD-BRL' }), 'USD');
  assert.equal(spokenLine({ kind: 'indicator', sym: 'SELIC' }, { price: 14.75, source: 'bcb', at, pctIsPoints: true }, at), 'SELIC (meta): 14,75% ao ano (Banco Central · 14:05)');
  assert.match(spokenLine(it, v, at), /^PETR4: R\$ 38,20, alta de 1,25% \(BrAPI/);
  assert.match(spokenLine(it, { error: { message: 'Cota esgotada' } }), /sem dados agora \(Cota esgotada\)/);
});

test('uso de duas abas: fica o maior de cada período', async () => {
  const { mergeUsage } = await import('../../src/lib/datahub/quota.js');
  const a = { brapi: { mk: '2026-11', m: 15000, dk: '2026-11-24', d: 3, nk: 'x', n: 1 } };
  const b = { brapi: { mk: '2026-11', m: 12, dk: '2026-11-24', d: 12, nk: 'x', n: 2 }, bcb: { mk: '2026-11', m: 1 } };
  assert.deepEqual(mergeUsage(a, b).brapi, { mk: '2026-11', m: 15000, dk: '2026-11-24', d: 12, nk: 'x', n: 2 });
  assert.equal(mergeUsage(a, b).bcb.m, 1);
  assert.equal(mergeUsage({ brapi: { mk: '2026-10', m: 999 } }, { brapi: { mk: '2026-11', m: 3 } }).brapi.m, 3, 'mês novo vale');
});
