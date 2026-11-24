// Data Hub (#71): conta as requisições de cada fonte (minuto, dia e mês) e respeita os limites
// do plano grátis (ou os que a pessoa informar para um plano pago). Também estima o consumo do mês.

export const USAGE_KEY = 'nt_dh_usage';

// Limites dos planos grátis (conferidos em nov/2026). Buckets separados quando a fonte conta separado.
export const FREE_LIMITS = {
  brapi: { month: 15000, batch: 1 }, // 15 mil por mês, 1 ativo por requisição
  brapiNoKey: { minute: 20 }, // sem token: só PETR4, VALE3, ITUB4 e MGLU3, 20 por minuto
  hg: { day: 400 }, // Finance
  hgWeather: { day: 400 },
  hgGeo: { month: 100 },
  awesome: { minute: 30 }, // educado: não há cota publicada
  bcb: { minute: 30 },
};

export const bucketOf = (src, kind = '', hasKey = true) => (src === 'hg' ? (kind === 'weather' ? 'hgWeather' : kind === 'geoip' ? 'hgGeo' : 'hg') : src === 'brapi' && !hasKey ? 'brapiNoKey' : src);

export function limitsFor(bucket, custom = {}) {
  const base = FREE_LIMITS[bucket] || {};
  const own = bucket === 'brapi' ? custom.brapi : bucket === 'hg' ? custom.hg : null;
  return { ...base, ...(own || {}) };
}

const stamp = (now) => {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { month: day.slice(0, 7), day, minute: `${day}T${p(d.getHours())}:${p(d.getMinutes())}` };
};

// Uso atual de um bucket (zera ao virar minuto/dia/mês).
export function usageOf(usage, bucket, now = Date.now()) {
  const u = usage?.[bucket] || {};
  const s = stamp(now);
  return { month: u.mk === s.month ? u.m || 0 : 0, day: u.dk === s.day ? u.d || 0 : 0, minute: u.nk === s.minute ? u.n || 0 : 0 };
}

export function addUse(usage, bucket, n = 1, now = Date.now()) {
  const cur = usageOf(usage, bucket, now);
  const s = stamp(now);
  return { ...usage, [bucket]: { mk: s.month, m: cur.month + n, dk: s.day, d: cur.day + n, nk: s.minute, n: cur.minute + n } };
}

// Ainda dá para gastar `n`? Devolve { ok, level: 'ok'|'warn'|'full', which, used, limit }.
export function allowance(usage, bucket, custom = {}, n = 1, now = Date.now()) {
  const lim = limitsFor(bucket, custom);
  const used = usageOf(usage, bucket, now);
  const rank = { ok: 0, warn: 1, full: 2 };
  let worst = null;
  for (const which of ['month', 'day', 'minute']) {
    if (!lim[which]) continue;
    const u = used[which];
    const level = u + n > lim[which] ? 'full' : u + n > lim[which] * 0.8 ? 'warn' : 'ok';
    if (!worst || rank[level] > rank[worst.level]) worst = { ok: level !== 'full', level, which, used: u, limit: lim[which] };
  }
  return worst || { ok: true, level: 'ok', which: '', used: 0, limit: 0 };
}

export async function loadUsage() {
  return (await chrome.storage.local.get(USAGE_KEY))[USAGE_KEY] || {};
}
export async function countUse(bucket, n = 1) {
  const u = await loadUsage();
  await chrome.storage.local.set({ [USAGE_KEY]: addUse(u, bucket, n) });
}

// Pregão da B3: dias úteis, das 10h às 18h de Brasília (não considera feriados).
export function b3Open(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(now));
  const g = (t) => parts.find((p) => p.type === t)?.value;
  const wd = g('weekday');
  const h = Number(g('hour')) % 24, m = Number(g('minute'));
  if (wd === 'Sat' || wd === 'Sun') return false;
  const mins = h * 60 + m;
  return mins >= 600 && mins < 1080;
}

// Estimativa do mês: ativos da BrAPI × atualizações no pregão × 22 dias úteis (÷ ativos por requisição).
export function estimateMonth({ brapiItems = 0, refreshMin = 30, batch = 1 } = {}) {
  const perDay = Math.ceil(480 / Math.max(5, refreshMin)) + 1; // +1: a abertura do dia
  const calls = Math.ceil(brapiItems / Math.max(1, batch));
  return calls * perDay * 22;
}

// Junta dois registros de uso (outra aba pode ter gravado no meio): fica o maior de cada período.
export function mergeUsage(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const u = out[k];
    if (!u) { out[k] = v; continue; }
    const pick = (key, n) => (u[key] === v[key] ? Math.max(u[n] || 0, v[n] || 0) : (u[key] || '') > (v[key] || '') ? u[n] : v[n]);
    out[k] = { mk: u.mk > v.mk ? u.mk : v.mk, m: pick('mk', 'm'), dk: u.dk > v.dk ? u.dk : v.dk, d: pick('dk', 'd'), nk: u.nk > v.nk ? u.nk : v.nk, n: pick('nk', 'n') };
  }
  return out;
}
