// Data Hub (#71): as fontes. Cada uma diz o que oferece, se precisa de chave e como ler a resposta.
// As funções de leitura (parse*) são puras e testadas com respostas gravadas.

export class SourceError extends Error {
  // code: key (falta ou chave inválida) | paid (precisa de plano pago) | quota | notfound | net | http
  constructor(code, message) { super(message); this.code = code; }
}

export const SOURCES = {
  brapi: {
    id: 'brapi', name: 'BrAPI', site: 'https://brapi.dev', keyUrl: 'https://brapi.dev/dashboard', kinds: ['stock', 'index'],
    needsKey: false, // sem token: só PETR4, VALE3, ITUB4 e MGLU3
    free: 'Grátis: 15 mil consultas por mês, 1 ativo por consulta, cotações com cerca de 30 min de atraso. Sem token, só PETR4, VALE3, ITUB4 e MGLU3. Moedas, cripto e indicadores ficam nos planos pagos (aqui usamos outras fontes para eles).',
    how: ['Crie uma conta grátis em brapi.dev.', 'No painel (Dashboard), copie o seu token.', 'Cole aqui e clique em Testar.'],
    delay: 30, origins: ['https://brapi.dev/*'], feature: 'quotes',
  },
  awesome: {
    id: 'awesome', name: 'AwesomeAPI', site: 'https://docs.awesomeapi.com.br', kinds: ['currency', 'crypto'], needsKey: false,
    free: 'Grátis e sem chave: moedas e cripto em reais.', delay: 0, origins: ['https://economia.awesomeapi.com.br/*'], feature: 'quotes',
  },
  bcb: {
    id: 'bcb', name: 'Banco Central', site: 'https://dadosabertos.bcb.gov.br', kinds: ['indicator'], needsKey: false,
    free: 'Grátis e sem chave: SELIC (meta), CDI e IPCA direto do Banco Central (dados abertos).', delay: 0, origins: ['https://api.bcb.gov.br/*'], feature: 'quotes',
  },
  hg: {
    id: 'hg', name: 'HG Brasil', site: 'https://hgbrasil.com', keyUrl: 'https://console.hgbrasil.com', kinds: ['stock', 'currency', 'indicator', 'weather', 'geoip'], needsKey: true,
    free: 'Grátis com chave: Finance com 400 consultas por dia (ações, FIIs, moedas, IPCA e SELIC meta), clima com 400 por dia para até 5 cidades (previsão de 2 dias, chance de chuva, sol e lua) e 100 consultas de localização por IP por mês.',
    how: ['Crie uma conta grátis em hgbrasil.com ("Comece grátis").', 'No console, crie uma chave de API.', 'Cole aqui e clique em Testar.'],
    delay: 15, origins: ['https://api.hgbrasil.com/*'], feature: 'hgbrasil',
  },
};

// ── BrAPI ───────────────────────────────────────────────────────────────────
export const brapiSymbol = (it) => (it.kind === 'index' ? (it.sym === 'IBOV' ? '^BVSP' : it.sym) : it.sym);
export function brapiUrl(items, token) {
  return `https://brapi.dev/api/quote/${items.map((i) => encodeURIComponent(brapiSymbol(i))).join(',')}${token ? '?token=' + encodeURIComponent(token) : ''}`;
}
export function parseBrapi(json, status = 200) {
  if (status === 401 || status === 403 || json?.error) {
    const msg = String(json?.message || '');
    if (/plano|plan|upgrade|assin/i.test(msg)) throw new SourceError('paid', msg || 'Precisa de plano pago na BrAPI.');
    if (/token|autoriz|authoriz|inválid|invalid/i.test(msg) || status === 401) throw new SourceError('key', msg || 'Token da BrAPI ausente ou inválido.');
    if (status === 404 || /não encontrad|not found/i.test(msg)) throw new SourceError('notfound', msg || 'Ativo não encontrado.');
    if (status === 429) throw new SourceError('quota', msg || 'Limite de consultas da BrAPI.');
    throw new SourceError('http', msg || `BrAPI: erro ${status}`);
  }
  if (status === 429) throw new SourceError('quota', 'Limite de consultas da BrAPI.');
  const out = {};
  for (const q of json?.results || []) {
    if (q?.regularMarketPrice == null) continue;
    const sym = q.symbol === '^BVSP' ? 'IBOV' : q.symbol;
    out[sym] = {
      price: +q.regularMarketPrice, pct: Number(q.regularMarketChangePercent) || 0, cur: q.currency || 'BRL',
      name: q.shortName || q.longName || sym, at: Date.parse(q.regularMarketTime) || Date.now(),
    };
  }
  return out;
}

// ── AwesomeAPI ──────────────────────────────────────────────────────────────
export const awesomeUrl = (items) => `https://economia.awesomeapi.com.br/json/last/${items.map((i) => i.sym).join(',')}`;
export function parseAwesome(json) {
  if (json?.status === 404 || json?.code === 'CoinNotExists') throw new SourceError('notfound', json.message || 'Moeda não encontrada.');
  const out = {};
  for (const q of Object.values(json || {})) {
    if (!q?.code || q.bid == null) continue;
    out[`${q.code}-${q.codein}`] = {
      price: +q.bid, pct: Number(q.pctChange) || 0, cur: q.codein || 'BRL', name: String(q.name || q.code).split('/')[0],
      at: q.timestamp ? Number(q.timestamp) * 1000 : Date.parse(String(q.create_date || '').replace(' ', 'T') + '-03:00') || Date.now(),
    };
  }
  return out;
}

// ── Banco Central (SGS) ─────────────────────────────────────────────────────
// 432 = meta SELIC (% a.a.), 4389 = CDI anualizado (% a.a.), 13522 = IPCA acumulado em 12 meses (%).
export const BCB_SERIES = { SELIC: 432, CDI: 4389, IPCA: 13522 };
export const bcbUrl = (sym) => `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${BCB_SERIES[sym]}/dados/ultimos/2?formato=json`;
export function parseBcb(json, sym) {
  if (!Array.isArray(json) || !json.length) throw new SourceError('http', 'Banco Central: resposta vazia.');
  const num = (v) => Number(String(v).replace(',', '.'));
  const last = json[json.length - 1], prev = json[json.length - 2];
  const [d, m, y] = String(last.data).split('/');
  const value = num(last.valor);
  if (!Number.isFinite(value)) throw new SourceError('http', 'Banco Central: valor inválido.');
  return { price: value, pct: prev ? +(value - num(prev.valor)).toFixed(2) : 0, unit: '%', name: sym, period: `${y}-${m}-${d}`, at: Date.parse(`${y}-${m}-${d}T12:00:00-03:00`) || Date.now(), pctIsPoints: true };
}

// ── HG Brasil ───────────────────────────────────────────────────────────────
const hgErr = (json) => {
  const e = json?.errors?.[0];
  if (json?.valid_key === false || e?.code === 'INVALID_API_KEY') throw new SourceError('key', e?.message || 'Chave da HG Brasil inválida.');
  if (e?.code === 'UNAUTHORIZED_KEY') throw new SourceError('paid', e.message || 'A chave não tem acesso a este dado (plano).');
  if (e && /limit|limite|quota/i.test(`${e.code} ${e.message}`)) throw new SourceError('quota', e.message);
  if (e) throw new SourceError('http', e.message || e.code);
};
export const hgTicker = (it) => (it.kind === 'stock' ? `B3:${it.sym}` : it.kind === 'currency' ? `FOREX:${it.sym.replace('-', '')}` : it.sym === 'IPCA' ? 'IBGE:IPCA' : it.sym === 'SELIC' ? 'BCB:SELICMETA' : `BCB:${it.sym}`);
export const hgQuotesUrl = (items, key) => `https://api.hgbrasil.com/v2/finance/quotes?tickers=${encodeURIComponent(items.map(hgTicker).join(','))}&key=${encodeURIComponent(key)}`;
export const hgIndicatorsUrl = (items, key) => `https://api.hgbrasil.com/v2/finance/indicators?tickers=${encodeURIComponent(items.map(hgTicker).join(','))}&key=${encodeURIComponent(key)}`;
export function parseHgQuotes(json) {
  hgErr(json);
  const out = {};
  for (const r of json?.results || []) {
    const q = r.quote || {};
    if (q.value == null) continue;
    const [src, sym] = String(r.ticker || '').split(':');
    const key = src === 'FOREX' ? `${sym.slice(0, 3)}-${sym.slice(3)}` : sym;
    out[key] = { price: +q.value, pct: Number(q.change_percent) || 0, cur: r.currency || 'BRL', name: r.name || key, at: Date.parse(q.updated_at) || Date.now() };
  }
  return out;
}
export function parseHgIndicators(json) {
  hgErr(json);
  const out = {};
  for (const r of json?.results || []) {
    const t = String(r.ticker || '');
    const sym = t === 'IBGE:IPCA' ? 'IPCA' : t === 'BCB:SELICMETA' ? 'SELIC' : t.split(':')[1];
    const series = r.series || [];
    const last = series[series.length - 1];
    const value = sym === 'IPCA' && r.summary?.last_12m != null ? Number(r.summary.last_12m) : Number(last?.value);
    if (!Number.isFinite(value)) continue;
    out[sym] = { price: value, pct: 0, unit: '%', name: sym, period: last?.period || '', at: Date.parse(last?.publish_date || last?.period) || Date.now(), pctIsPoints: true };
  }
  return out;
}

export const hgWeatherUrl = (place, key) => `https://api.hgbrasil.com/weather?format=json-cors&lat=${(+place.lat).toFixed(4)}&lon=${(+place.lon).toFixed(4)}&key=${encodeURIComponent(key)}`;
const ddmm = (s, year) => { const [d, m] = String(s || '').split('/'); return d && m ? `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : ''; };
export function parseHgWeather(json, now = new Date()) {
  hgErr(json);
  const r = json?.results;
  if (!r || r.temp == null) throw new SourceError('http', 'HG Brasil: clima indisponível.');
  const y = now.getFullYear();
  return {
    temp: +r.temp, humidity: r.humidity, desc: r.description, city: r.city_name || r.city, sunrise: r.sunrise, sunset: r.sunset, moon: r.moon_phase,
    days: (r.forecast || []).map((f) => ({ date: ddmm(f.date, y), max: f.max, min: f.min, rainProb: f.rain_probability, rain: f.rain, desc: f.description, sunrise: f.sunrise, sunset: f.sunset, moon: f.moon_phase })),
    at: Date.now(),
  };
}
export const MOON = { new: '🌑 Lua nova', waxing_crescent: '🌒 Crescente', first_quarter: '🌓 Quarto crescente', waxing_gibbous: '🌔 Crescente gibosa', full: '🌕 Lua cheia', waning_gibbous: '🌖 Minguante gibosa', last_quarter: '🌗 Quarto minguante', waning_crescent: '🌘 Minguante' };

export const hgGeoUrl = (key) => `https://api.hgbrasil.com/geoip?format=json-cors&address=remote&precision=false&key=${encodeURIComponent(key)}`;
export function parseHgGeo(json) {
  hgErr(json);
  const r = json?.results;
  if (!r || r.latitude == null) throw new SourceError('notfound', 'Não deu para descobrir a cidade pelo IP.');
  return { name: r.city, region: r.region, country: r.country_name || r.country?.name, lat: +r.latitude, lon: +r.longitude };
}
