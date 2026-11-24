// Data Hub (0.9.2, #71): uma camada única para os dados externos.
// Os widgets pedem "PETR4", "USD-BRL", "SELIC" ou o clima de uma cidade; o hub escolhe a fonte
// (pela ordem configurada), usa o cache, respeita a cota de cada uma e devolve o valor
// SEMPRE com a fonte e o horário. Se nenhuma fonte responder, devolve o último valor
// marcado como desatualizado — nunca inventa.
import { SOURCES, SourceError, brapiUrl, parseBrapi, awesomeUrl, parseAwesome, bcbUrl, parseBcb, hgQuotesUrl, parseHgQuotes, hgIndicatorsUrl, parseHgIndicators, hgWeatherUrl, parseHgWeather, hgGeoUrl, parseHgGeo } from './sources.js';
import { sanitizeDatahub, itemKey } from './prefs.js';
import { getKeys } from './keys.js';
import { loadUsage, addUse, allowance, bucketOf, b3Open, USAGE_KEY, limitsFor, mergeUsage } from './quota.js';
import { hasFeature } from '../permissions.js';

export const CACHE_KEY = 'nt_cache_dh';
const TTL = { currency: 10, crypto: 10, indicator: 12 * 60, weather: 60 };
const ttlFor = (kind, refreshMin) => (kind === 'stock' || kind === 'index' ? refreshMin : TTL[kind] || 30) * 60e3;
const BRAPI_FREE = new Set(['PETR4', 'VALE3', 'ITUB4', 'MGLU3']);

async function getJson(url, ms = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    let json = null;
    try { json = await r.json(); } catch { /* sem corpo */ }
    return { status: r.status, json };
  } catch {
    throw new SourceError('net', 'Sem conexão com a fonte.');
  } finally { clearTimeout(timer); }
}

const mem = { cache: null };
async function loadCache() { return (mem.cache = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {}); }
// Junta com o que outra aba gravou no meio: fica o valor mais novo de cada item.
async function saveCache(c, gone = []) {
  const cur = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
  const out = { ...cur };
  for (const [k, v] of Object.entries(c)) if (!out[k] || (v.fetchedAt || 0) >= (out[k].fetchedAt || 0)) out[k] = v;
  for (const k of gone) delete out[k];
  mem.cache = out;
  await chrome.storage.local.set({ [CACHE_KEY]: out });
}
export const warmCache = () => loadCache().catch(() => ({}));

// Último valor conhecido (síncrono, do cache em memória): para o cérebro e a voz sem gastar cota.
export function cachedQuote(it, now = Date.now()) {
  const c = mem.cache?.[itemKey(it)];
  if (!c) return null;
  const stale = now - c.fetchedAt > 24 * 60 * 60e3;
  return { ...c.v, source: c.src, delay: SOURCES[c.src]?.delay || 0, ...(stale ? { stale: true } : {}) };
}

// Quais fontes podem atender um tipo de dado agora (ligadas, com chave se precisar, com permissão).
export async function sourcesFor(kind, dh, keys) {
  const out = [];
  for (const id of dh.order[kind] || []) {
    const s = SOURCES[id];
    if (!s || !dh.enabled[id] || !s.kinds.includes(kind)) continue;
    if (s.needsKey && !keys[id]) continue;
    if (!(await hasFeature(s.feature).catch(() => false))) continue;
    out.push(id);
  }
  return out;
}

async function fetchFrom(src, kind, items, keys) {
  if (src === 'brapi') {
    const { status, json } = await getJson(brapiUrl(items, keys.brapi));
    return parseBrapi(json, status);
  }
  if (src === 'awesome') {
    const { status, json } = await getJson(awesomeUrl(items));
    if (status === 429) throw new SourceError('quota', 'Muitas consultas à AwesomeAPI.');
    return parseAwesome(json);
  }
  if (src === 'bcb') {
    const out = {};
    for (const it of items) {
      const { status, json } = await getJson(bcbUrl(it.sym));
      if (status >= 400) throw new SourceError('http', `Banco Central: erro ${status}`);
      out[it.sym] = parseBcb(json, it.sym);
    }
    return out;
  }
  if (src === 'hg') {
    const url = kind === 'indicator' ? hgIndicatorsUrl(items, keys.hg) : hgQuotesUrl(items, keys.hg);
    const { json } = await getJson(url);
    return kind === 'indicator' ? parseHgIndicators(json) : parseHgQuotes(json);
  }
  throw new SourceError('http', 'Fonte desconhecida.');
}

// Quantas requisições custa buscar `items` numa fonte.
function cost(src, items, dh) {
  if (src === 'brapi') return Math.ceil(items.length / Math.max(1, limitsFor('brapi', dh.limits).batch || 1));
  if (src === 'bcb') return items.length;
  return 1;
}

/**
 * Busca a lista de acompanhamento. settings = configurações completas.
 * Devolve Map(itemKey → { ...valor, source, at, delay, stale?, error?: { code, message } }).
 * { force } ignora a validade do cache (mas não a cota).
 */
let chain = Promise.resolve();
export function getQuotes(items, settings, opts = {}) {
  // Uma busca de cada vez nesta página: o cache e a cota são lidos e gravados inteiros.
  const run = chain.then(() => fetchQuotes(items, settings, opts));
  chain = run.catch(() => {});
  return run;
}

async function fetchQuotes(items, settings, { force = false, now = Date.now() } = {}) {
  const dh = sanitizeDatahub(settings.datahub);
  const refreshMin = settings.watch?.refreshMin || 30;
  const keys = await getKeys();
  const cache = await loadCache();
  let usage = await loadUsage();
  const out = new Map();
  const gone = [];
  const open = b3Open(now);
  const byKind = {};
  for (const it of items) (byKind[it.kind] ||= []).push(it);

  for (const [kind, list] of Object.entries(byKind)) {
    // 1) o que o cache ainda resolve
    let pending = list.filter((it) => {
      const c = cache[itemKey(it)];
      if (!c) return true;
      const fresh = now - c.fetchedAt < ttlFor(kind, refreshMin);
      const marketClosed = (kind === 'stock' || kind === 'index') && !open && c.fetchedAt > now - 4 * 864e5;
      if (!force && (fresh || marketClosed)) { out.set(itemKey(it), { ...c.v, source: c.src, delay: SOURCES[c.src]?.delay || 0 }); return false; }
      if (force && marketClosed && now - c.fetchedAt < 60 * 60e3) { out.set(itemKey(it), { ...c.v, source: c.src, delay: SOURCES[c.src]?.delay || 0 }); return false; }
      return true;
    });
    // 2) as fontes, na ordem
    const errors = {};
    for (const src of await sourcesFor(kind, dh, keys)) {
      if (!pending.length) break;
      let ask = pending;
      // BrAPI sem token: só os 4 ativos de teste
      if (src === 'brapi' && !keys.brapi) {
        const no = ask.filter((it) => !(it.kind === 'stock' && BRAPI_FREE.has(it.sym)));
        for (const it of no) errors[itemKey(it)] ||= { code: 'key', message: 'Precisa do token grátis da BrAPI.', source: src };
        ask = ask.filter((it) => it.kind === 'stock' && BRAPI_FREE.has(it.sym));
        if (!ask.length) continue;
      }
      const bucket = bucketOf(src, kind, !!keys[src] || src !== 'brapi');
      const batch = src === 'brapi' ? Math.max(1, limitsFor('brapi', dh.limits).batch || 1) : src === 'bcb' ? 1 : ask.length;
      for (let i = 0; i < ask.length; i += batch) {
        const group = ask.slice(i, i + batch);
        const n = cost(src, group, dh);
        const al = allowance(usage, bucket, dh.limits, n, now);
        if (!al.ok) { for (const it of group) errors[itemKey(it)] ||= { code: 'quota', message: `Cota de ${SOURCES[src].name} esgotada (${al.which === 'minute' ? 'por minuto' : al.which === 'day' ? 'do dia' : 'do mês'}).`, source: src }; continue; }
        usage = addUse(usage, bucket, n, now);
        try {
          const got = await fetchFrom(src, kind, group, keys);
          for (const it of group) {
            const v = got[it.sym];
            if (!v) { errors[itemKey(it)] ||= { code: 'notfound', message: 'Não encontrado nesta fonte.', source: src }; continue; }
            cache[itemKey(it)] = { v, src, fetchedAt: now };
            out.set(itemKey(it), { ...v, source: src, delay: SOURCES[src].delay });
            delete errors[itemKey(it)];
          }
        } catch (e) {
          const err = { code: e.code || 'http', message: e.message || String(e), source: src };
          for (const it of group) if (!errors[itemKey(it)] || errors[itemKey(it)].code === 'notfound') errors[itemKey(it)] = err;
        }
      }
      pending = pending.filter((it) => !out.has(itemKey(it)));
    }
    // 3) sem resposta: o último valor, marcado; ou o motivo
    for (const it of pending) {
      const k = itemKey(it);
      const c = cache[k];
      const error = errors[k] || { code: 'nosource', message: 'Nenhuma fonte ligada para este dado.' };
      // Plano pago ou ativo inexistente: o valor antigo não serve (nunca mais vai atualizar).
      const keepOld = c && !['paid', 'notfound'].includes(error.code);
      if (c && !keepOld) { delete cache[k]; gone.push(k); }
      out.set(k, keepOld ? { ...c.v, source: c.src, delay: SOURCES[c.src]?.delay || 0, stale: true, error } : { error });
    }
  }
  await saveCache(cache, gone);
  await chrome.storage.local.set({ [USAGE_KEY]: mergeUsage(await loadUsage(), usage) });
  return out;
}

// ── Clima pela HG Brasil (opcional) ─────────────────────────────────────────
export async function getHgWeather(place, settings, { force = false, now = Date.now() } = {}) {
  const dh = sanitizeDatahub(settings.datahub);
  const keys = await getKeys();
  if (!dh.enabled.hg || !keys.hg || !place) return null;
  if (!(await hasFeature('hgbrasil').catch(() => false))) return null;
  const cache = await loadCache();
  const k = `weather:${(+place.lat).toFixed(2)},${(+place.lon).toFixed(2)}`;
  const c = cache[k];
  if (!force && c && now - c.fetchedAt < TTL.weather * 60e3) return { ...c.v, source: 'hg' };
  const usage = await loadUsage();
  if (!allowance(usage, 'hgWeather', dh.limits, 1, now).ok) return c ? { ...c.v, source: 'hg', stale: true } : null;
  await chrome.storage.local.set({ [USAGE_KEY]: addUse(usage, 'hgWeather', 1, now) });
  try {
    const { json } = await getJson(hgWeatherUrl(place, keys.hg));
    const v = parseHgWeather(json);
    cache[k] = { v, src: 'hg', fetchedAt: now };
    await saveCache(cache);
    return { ...v, source: 'hg' };
  } catch {
    return c ? { ...c.v, source: 'hg', stale: true } : null;
  }
}

// ── Cidade pelo IP (só pelo botão) ──────────────────────────────────────────
export async function cityFromIp(settings) {
  const keys = await getKeys();
  if (!keys.hg) throw new SourceError('key', 'Cadastre a chave grátis da HG Brasil em Configurações → Fontes de dados.');
  const dh = sanitizeDatahub(settings.datahub);
  const usage = await loadUsage();
  const al = allowance(usage, 'hgGeo', dh.limits);
  if (!al.ok) throw new SourceError('quota', 'As consultas de localização deste mês acabaram.');
  await chrome.storage.local.set({ [USAGE_KEY]: addUse(usage, 'hgGeo') });
  const { json } = await getJson(hgGeoUrl(keys.hg));
  return parseHgGeo(json);
}

// ── Testar a chave (página Fontes de dados) ─────────────────────────────────
export async function testKey(src, key) {
  try {
    if (src === 'brapi') {
      const { status, json } = await getJson(brapiUrl([{ kind: 'stock', sym: 'BBAS3' }], key));
      const r = parseBrapi(json, status);
      return r.BBAS3 ? { ok: true, message: 'Token válido.' } : { ok: false, message: 'A BrAPI não devolveu a cotação de teste.' };
    }
    if (src === 'hg') {
      const { json } = await getJson(hgQuotesUrl([{ kind: 'currency', sym: 'USD-BRL' }], key));
      if (json?.valid_key === false) return { ok: false, message: 'Chave inválida.' };
      const r = parseHgQuotes(json);
      return r['USD-BRL'] ? { ok: true, message: 'Chave válida.' } : { ok: true, message: 'Chave aceita.' };
    }
  } catch (e) {
    return { ok: false, message: e.code === 'key' ? 'Chave inválida.' : e.code === 'paid' ? 'Chave válida, mas o plano não cobre o dado de teste.' : e.message };
  }
  return { ok: false, message: 'Esta fonte não usa chave.' };
}

export { itemKey };
