// Data Hub (0.9.2, #71): preferências (settings.datahub e settings.watch — sincronizam).
// As chaves das fontes NÃO ficam aqui: ficam em nt_datahub_keys, só neste computador (keys.js).

export const KINDS = ['stock', 'index', 'currency', 'crypto', 'indicator'];
export const KIND_LABEL = { stock: 'Ações e FIIs', index: 'Índices', currency: 'Moedas', crypto: 'Cripto', indicator: 'Indicadores' };
export const INDICATORS = {
  SELIC: { name: 'SELIC (meta)', unit: '% a.a.' },
  CDI: { name: 'CDI', unit: '% a.a.' },
  IPCA: { name: 'IPCA', unit: '% em 12 meses' },
};
export const INDEXES = { IBOV: 'Ibovespa', IFIX: 'IFIX' };

// Ordem padrão das fontes por tipo de dado (a primeira disponível responde).
export const DEFAULT_ORDER = {
  stock: ['brapi', 'hg'],
  index: ['brapi'],
  currency: ['awesome', 'hg'],
  crypto: ['awesome'],
  indicator: ['bcb', 'hg'],
};

export const DEFAULT_DATAHUB = {
  enabled: { brapi: true, awesome: true, bcb: true, hg: false }, // HG Brasil só com a chave da pessoa
  order: DEFAULT_ORDER,
  limits: {}, // limites próprios (plano pago): { brapi: { month: 150000, batch: 10 }, hg: { day: 1000 } }
  weather: 'openmeteo', // openmeteo | hg (com reserva no outro)
  alertsOn: false,
  alerts: [], // [{ id, type: 'above'|'below'|'pct'|'rain'|'hot'|'cold', item?: 'stock:PETR4', value, armed }]
};

export const DEFAULT_WATCH = {
  items: [
    { kind: 'currency', sym: 'USD-BRL' }, { kind: 'currency', sym: 'EUR-BRL' }, { kind: 'crypto', sym: 'BTC-BRL' },
    { kind: 'index', sym: 'IBOV' }, { kind: 'stock', sym: 'PETR4' }, { kind: 'stock', sym: 'VALE3' }, { kind: 'stock', sym: 'ITUB4' },
    { kind: 'indicator', sym: 'SELIC' }, { kind: 'indicator', sym: 'IPCA' },
  ],
  refreshMin: 30, // ações e índices: de quanto em quanto tempo, no pregão
};

export const itemKey = (it) => `${it.kind}:${it.sym}`;

// Normaliza o que a pessoa digita: "petr4" → stock PETR4; "usd" → USD-BRL; "btc" → BTC-BRL; "selic" → indicador.
export function parseItem(text, kind = '') {
  const s = String(text || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  if ((!kind || kind === 'indicator') && INDICATORS[s]) return { kind: 'indicator', sym: s };
  if ((!kind || kind === 'index') && (INDEXES[s] || s === '^BVSP' || s === 'IBOVESPA')) return { kind: 'index', sym: s === '^BVSP' || s === 'IBOVESPA' ? 'IBOV' : s };
  const crypto = /^(BTC|ETH|SOL|XRP|LTC|DOGE|ADA|USDT|BNB)(-?[A-Z]{3})?$/;
  if ((!kind || kind === 'crypto') && crypto.test(s)) { const m = s.match(crypto); return { kind: 'crypto', sym: `${m[1]}-${(m[2] || '-BRL').replace('-', '')}` }; }
  const cur = s.match(/^([A-Z]{3})-?([A-Z]{3})?$/);
  if ((kind === 'currency' || (!kind && cur && !/\d/.test(s))) && cur) return { kind: 'currency', sym: `${cur[1]}-${cur[2] || 'BRL'}` };
  if ((!kind || kind === 'stock') && /^[A-Z]{4}\d{1,2}[A-Z]?$/.test(s)) return { kind: 'stock', sym: s };
  return null;
}

function sanitizeItems(list) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(list) ? list : []) {
    const p = it && KINDS.includes(it.kind) ? parseItem(it.sym, it.kind) : null;
    if (p && !seen.has(itemKey(p))) { seen.add(itemKey(p)); out.push(p); }
  }
  return out.slice(0, 40);
}

// Monta a lista a partir das opções antigas do widget Cotações (quoteCurrencies / quoteStocks).
export function migrateQuotes(s) {
  const items = [];
  for (const c of String(s.quoteCurrencies || '').split(',').filter(Boolean)) items.push(parseItem(c, /^(BTC|ETH|SOL|XRP|LTC|DOGE)/.test(c) ? 'crypto' : 'currency'));
  items.push({ kind: 'index', sym: 'IBOV' });
  for (const t of String(s.quoteStocks || '').split(',').filter(Boolean)) items.push(parseItem(t, 'stock'));
  items.push({ kind: 'indicator', sym: 'SELIC' }, { kind: 'indicator', sym: 'IPCA' });
  return sanitizeItems(items.filter(Boolean));
}

export function sanitizeWatch(w, legacy = {}) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.items)) {
    const fromOld = legacy.quoteCurrencies != null || legacy.quoteStocks != null ? migrateQuotes(legacy) : null;
    return { ...DEFAULT_WATCH, items: fromOld?.length ? fromOld : DEFAULT_WATCH.items.map((x) => ({ ...x })) };
  }
  const n = Number(w.refreshMin);
  return { items: sanitizeItems(w.items), refreshMin: [15, 30, 60, 120].includes(n) ? n : 30 };
}

export function sanitizeDatahub(d) {
  const s = d && typeof d === 'object' ? d : {};
  const enabled = { ...DEFAULT_DATAHUB.enabled };
  for (const k of Object.keys(enabled)) if (typeof s.enabled?.[k] === 'boolean') enabled[k] = s.enabled[k];
  const order = {};
  for (const k of KINDS) {
    const def = DEFAULT_ORDER[k];
    const got = Array.isArray(s.order?.[k]) ? s.order[k].filter((x) => def.includes(x)) : [];
    order[k] = [...new Set([...got, ...def])];
  }
  const limits = {};
  for (const [src, v] of Object.entries(s.limits || {})) {
    if (!['brapi', 'hg'].includes(src) || !v || typeof v !== 'object') continue;
    const o = {};
    for (const f of ['month', 'day', 'batch']) if (Number(v[f]) > 0) o[f] = Math.round(Number(v[f]));
    if (Object.keys(o).length) limits[src] = o;
  }
  const alerts = (Array.isArray(s.alerts) ? s.alerts : []).filter((a) => a && ['above', 'below', 'pct', 'rain', 'hot', 'cold'].includes(a.type) && Number.isFinite(Number(a.value)))
    .map((a) => ({ id: String(a.id || Math.random().toString(36).slice(2, 9)).slice(0, 20), type: a.type, item: typeof a.item === 'string' ? a.item.slice(0, 40) : '', value: Number(a.value), armed: a.armed !== false })).slice(0, 30);
  return { enabled, order, limits, weather: s.weather === 'hg' ? 'hg' : 'openmeteo', alertsOn: !!s.alertsOn, alerts };
}
