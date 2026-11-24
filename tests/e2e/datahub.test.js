// Data Hub (#71): lista de acompanhamento com fonte e horário, token da BrAPI, plano pago marcado,
// cota esgotada → "desatualizado", página Fontes de dados (chave, testar, consumo), clima e cidade
// pela HG Brasil, alertas (uma vez) e voz. As fontes respondem com dados gravados (sem internet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const CORS = { 'access-control-allow-origin': '*' };
const NOW = new Date().toISOString();

async function mockSources(x, { calls = {}, petr = 38.2 } = {}) {
  const hit = (k) => { calls[k] = (calls[k] || 0) + 1; };
  await x.ctx.route('https://brapi.dev/**', (r) => {
    const u = new URL(r.request().url());
    const sym = decodeURIComponent(u.pathname.split('/').pop());
    const token = u.searchParams.get('token');
    hit('brapi');
    if (!token && !['PETR4', 'VALE3', 'ITUB4', 'MGLU3'].includes(sym)) return r.fulfill({ status: 401, json: { error: true, message: 'Token inválido ou ausente' }, headers: CORS });
    if (sym === 'ITUB4' && token) return r.fulfill({ status: 403, json: { error: true, message: 'O seu plano não permite acessar este ativo. Faça upgrade.' }, headers: CORS });
    const price = sym === '^BVSP' ? 131234 : sym === 'PETR4' ? petr : 61.5;
    return r.fulfill({ json: { results: [{ symbol: sym, shortName: sym === '^BVSP' ? 'Ibovespa' : sym + ' PN', regularMarketPrice: price, regularMarketChangePercent: 1.25, currency: 'BRL', regularMarketTime: NOW }] }, headers: CORS });
  });
  await x.ctx.route('https://economia.awesomeapi.com.br/**', (r) => {
    hit('awesome');
    return r.fulfill({ json: {
      USDBRL: { code: 'USD', codein: 'BRL', name: 'Dólar Americano/Real Brasileiro', bid: '5.4321', pctChange: '-0.35', timestamp: String(Math.floor(Date.now() / 1000)) },
      EURBRL: { code: 'EUR', codein: 'BRL', name: 'Euro/Real Brasileiro', bid: '6.1', pctChange: '0.2', timestamp: String(Math.floor(Date.now() / 1000)) },
      BTCBRL: { code: 'BTC', codein: 'BRL', name: 'Bitcoin/Real Brasileiro', bid: '510000', pctChange: '2.1', timestamp: String(Math.floor(Date.now() / 1000)) },
    }, headers: CORS });
  });
  await x.ctx.route('https://api.bcb.gov.br/**', (r) => {
    hit('bcb');
    const serie = r.request().url().match(/sgs\.(\d+)/)[1];
    const v = { 432: ['15.00', '14.75'], 4389: ['14.65', '14.65'], 13522: ['4.40', '4.31'] }[serie];
    return r.fulfill({ json: [{ data: '23/11/2026', valor: v[0] }, { data: '24/11/2026', valor: v[1] }], headers: CORS });
  });
  await x.ctx.route('https://api.hgbrasil.com/**', (r) => {
    const u = new URL(r.request().url());
    hit('hg:' + u.pathname);
    if (u.searchParams.get('key') !== 'HGKEY') return r.fulfill({ json: { valid_key: false, metadata: { key_status: 'invalid' }, errors: [{ code: 'INVALID_API_KEY', message: 'Chave de API inválida.' }], results: [] }, headers: CORS });
    if (u.pathname === '/weather') return r.fulfill({ json: { valid_key: true, results: { temp: 27, description: 'Tempo nublado', city_name: 'Itaúna', sunrise: '05:21 am', sunset: '06:32 pm', moon_phase: 'full', forecast: [{ date: '24/11', max: 30, min: 18, rain_probability: 40 }, { date: '25/11', max: 28, min: 17, rain_probability: 85 }] } }, headers: CORS });
    if (u.pathname === '/geoip') return r.fulfill({ json: { valid_key: true, results: { city: 'Itaúna', region: 'MG', country_name: 'Brasil', latitude: -20.07, longitude: -44.57 } }, headers: CORS });
    return r.fulfill({ json: { metadata: { key_status: 'valid' }, results: [{ ticker: 'FOREX:USDBRL', currency: 'BRL', name: 'Dólar', quote: { value: 5.43, change_percent: -0.1, updated_at: NOW } }] }, headers: CORS });
  });
  return calls;
}
const grantAll = (x) => x.ctx.addInitScript(() => { if (globalThis.chrome?.permissions) { chrome.permissions.request = async () => true; chrome.permissions.contains = async () => true; } });
const swGrant = (sw) => sw.evaluate(() => { chrome.permissions.contains = async () => true; });

test('Data Hub: lista com fonte e horário, token, plano pago, cota e alertas', async () => {
  const x = await launch();
  try {
    await grantAll(x);
    const calls = await mockSources(x);
    const p = await x.open('src/newtab.html');
    await x.settings(p, { widgets: [{ id: 'quotes', w: 6 }] });
    const w = p.locator('.widget[data-id=quotes]');
    await w.locator('[data-item="currency:USD-BRL"] .p', { hasText: 'R$ 5,43' }).waitFor();
    // sem token: PETR4 vem; IBOV pede a chave; SELIC e IPCA vêm do Banco Central
    await w.locator('[data-item="stock:PETR4"] .p', { hasText: 'R$ 38,20' }).waitFor();
    assert.match(await w.locator('[data-item="index:IBOV"]').textContent(), /precisa de chave/);
    assert.match(await w.locator('[data-item="indicator:SELIC"]').textContent(), /14,75%.*0,25 p\.p\./);
    assert.match(await w.locator('[data-item="indicator:IPCA"]').textContent(), /4,31%/);
    assert.match(await w.locator('[data-item="stock:PETR4"]').getAttribute('title'), /^BrAPI · \d\d:\d\d · atraso de ~30 min$/);
    assert.match(await w.locator('[data-item="indicator:SELIC"]').getAttribute('title'), /^Banco Central/);
    assert.match(await w.locator('.watch-foot').textContent(), /AwesomeAPI|BrAPI|Banco Central/);
    // o cache evita buscar de novo
    const before = { ...calls };
    await p.reload();
    await w.locator('[data-item="stock:PETR4"] .p').waitFor();
    assert.equal(calls.brapi, before.brapi, 'sem nova consulta dentro da validade');

    // página Fontes de dados: token da BrAPI com "Testar"
    const o = await x.open('src/options.html#fontes-dados');
    await o.locator('[data-source=brapi] [data-key=brapi]').fill('TOK');
    await o.click('[data-test=brapi]');
    await o.locator('[data-source=brapi]', { hasText: '✅ Token válido.' }).waitFor();
    assert.deepEqual(await x.storage(o, 'nt_datahub_keys'), { brapi: 'TOK' });
    assert.equal((await x.storage(o, 'nt_data')).settings.brapiToken, '', 'token fora das configurações (não sincroniza)');
    await o.locator('[data-source=hg] [data-key=hg]').fill('ERRADA');
    await o.click('[data-test=hg]');
    await o.locator('[data-source=hg]', { hasText: '❌ Chave inválida.' }).waitFor();
    await o.locator('[data-source=hg] [data-key=hg]').fill('HGKEY');
    await o.click('[data-test=hg]');
    await o.locator('[data-source=hg]', { hasText: '✅ Chave válida.' }).waitFor();
    await o.waitForFunction(async () => (await chrome.storage.local.get('nt_data')).nt_data.settings.datahub.enabled.hg === true); // testar com sucesso liga a fonte
    await o.reload();
    await o.locator('[data-source=brapi] .dh-use').first().waitFor();
    assert.match(await o.textContent('[data-source=brapi] .dh-uses'), /de 15\.000 no mês/);
    assert.match(await o.textContent('[data-source=hg]'), /Como conseguir a chave grátis/);

    // com token: IBOV aparece; ITUB4 marcado como plano pago
    await p.bringToFront();
    await w.locator('button[title=Atualizar]').click();
    await w.locator('[data-item="index:IBOV"] .p', { hasText: '131.234 pts' }).waitFor();
    assert.match(await w.locator('[data-item="stock:ITUB4"]').textContent(), /plano pago/);

    // cota do mês esgotada → último valor marcado como desatualizado
    await p.evaluate(async () => {
      const u = (await chrome.storage.local.get('nt_dh_usage')).nt_dh_usage || {};
      const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
      u.brapi = { mk: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, m: 15000, dk: '', d: 0, nk: '', n: 0 };
      // valores de 5 dias atrás: vencidos com o pregão aberto ou fechado
      const c = (await chrome.storage.local.get('nt_cache_dh')).nt_cache_dh;
      for (const v of Object.values(c)) v.fetchedAt = Date.now() - 5 * 864e5;
      await chrome.storage.local.set({ nt_dh_usage: u, nt_cache_dh: c });
    });
    await w.locator('button[title=Atualizar]').click();
    await w.locator('[data-item="stock:PETR4"].stale').waitFor();
    assert.match(await w.locator('[data-item="stock:PETR4"]').getAttribute('title'), /desatualizado/);

    // editar a lista: adicionar um FII e salvar
    await w.locator('button[title="Editar a lista"]').click();
    await w.locator('.watch-add').fill('mxrf11');
    await w.locator('.watch-add').press('Enter');
    await w.locator('.watch-edit li', { hasText: 'MXRF11' }).waitFor();
    await w.locator('#watchSave').click();
    await p.waitForFunction(async () => (await chrome.storage.local.get('nt_data')).nt_data.settings.watch.items.some((i) => i.sym === 'MXRF11'));

    // alertas: PETR4 acima de 38 dispara uma vez
    await o.bringToFront();
    await o.locator('label.sw:has(#dhAlertsOn)').click();
    await o.selectOption('#dhAlType', 'above');
    await o.selectOption('#dhAlItem', 'stock:PETR4');
    await o.fill('#dhAlValue', '38');
    await o.click('#dhAlGo');
    await o.locator('[data-alert]').waitFor();
    await o.evaluate(async () => {
      // o service worker não passa pela rede simulada: o valor já está no cache, como depois de o widget buscar
      await chrome.storage.local.set({ nt_cache_dh: { 'stock:PETR4': { v: { price: 38.2, pct: 1.25, cur: 'BRL', name: 'PETR4 PN', at: Date.now() }, src: 'brapi', fetchedAt: Date.now() } } });
    });
    const sw = x.ctx.serviceWorkers()[0];
    await swGrant(sw);
    const fired = await sw.evaluate(() => globalThis.__nt.runDataAlerts());
    assert.equal(fired.length, 1);
    assert.match(fired[0].title, /PETR4 acima de 38/);
    assert.match(fired[0].message, /fonte brapi/);
    assert.equal((await sw.evaluate(() => globalThis.__nt.runDataAlerts())).length, 0, 'não repete');
    assert.equal((await x.storage(o, 'nt_data')).settings.datahub.alerts[0].armed, false);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Data Hub: clima e cidade pela HG Brasil, e voz com fonte', async () => {
  const x = await launch({ voice: true });
  try {
    await grantAll(x);
    await mockSources(x);
    const p = await x.open('src/newtab.html');
    await p.evaluate(() => chrome.storage.local.set({ nt_datahub_keys: { hg: 'HGKEY' } }));
    const data = await p.evaluate(async () => (await chrome.storage.local.get('nt_data')).nt_data);
    data.settings.widgets = [{ id: 'weather', w: 6 }, { id: 'quotes', w: 6 }];
    data.settings.datahub = { ...data.settings.datahub, enabled: { ...data.settings.datahub.enabled, hg: true }, weather: 'hg' };
    data.settings.places = [{ id: 'home', name: 'Itaúna', lat: -20.07, lon: -44.57, tz: 'America/Sao_Paulo' }];
    await x.seed(p, { nt_data: data });
    const wx = p.locator('.widget[data-id=weather]');
    await wx.locator('.wx-extra', { hasText: '🌕 Lua cheia' }).waitFor();
    assert.match(await wx.locator('.wx-extra').textContent(), /Chuva hoje 40%.*HG Brasil/);
    // 📍 cidade pelo IP (só no clique)
    await wx.locator('button[title="Trocar cidade"]').click();
    await wx.locator('#wxIp').click();
    await wx.locator('.item', { hasText: 'Itaúna' }).click();
    await p.waitForFunction(async () => (await chrome.storage.local.get('nt_data')).nt_data.settings.places[0].lat === -20.07);
    const usage = await x.storage(p, 'nt_dh_usage');
    assert.equal(usage.hgGeo.m, 1, 'gastou 1 consulta de IP');
    // voz: cotação e clima com a fonte
    await p.click('#voiceFab');
    await p.waitForTimeout(150);
    await p.evaluate(() => { window.__lastSR.say('quanto está o dólar'); window.__lastSR.stop(); });
    await p.locator('#voiceReply', { hasText: /USD: R\$ 5,43, queda de 0,35% \(AwesomeAPI/ }).waitFor();
    await p.click('#voiceFab');
    await p.waitForTimeout(150);
    await p.evaluate(() => { window.__lastSR.say('vai chover amanhã em Itaúna?'); window.__lastSR.stop(); });
    await p.locator('#voiceReply', { hasText: /Amanhã em Itaúna: .*85% de chance de chuva — leve guarda-chuva\. \(Fonte: HG Brasil\.\)/ }).waitFor();
    await p.click('#voiceFab');
    await p.waitForTimeout(150);
    await p.evaluate(() => { window.__lastSR.say('qual a selic'); window.__lastSR.stop(); });
    await p.locator('#voiceReply', { hasText: /SELIC \(meta\): 14,75% ao ano \(Banco Central/ }).waitFor();
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
