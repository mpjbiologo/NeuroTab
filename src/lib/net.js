// NeuroTab — widget Rede (#52): velocidade, latência, jitter, travadas e o melhor DNS.
// O navegador não faz ping ICMP: aqui a latência é medida por requisições HTTP (a interface avisa).
// Com a NeuroTab Ponte instalada, ping de verdade, DNS por UDP e "quem usa a rede" vêm de lib/net-ponte.js.
// As funções do topo são puras (testadas em tests/unit/net.test.js); as de rede recebem `fetch` para os testes.

export const NET_KEY = 'nt_net';

export const SERVERS = {
  cloudflare: { label: 'Cloudflare (speed.cloudflare.com)', base: 'https://speed.cloudflare.com' },
};

/** Tamanhos do teste de velocidade: [bytes, repetições]. O volume total aparece antes de começar. */
export const PLANS = {
  light: { label: 'Leve', down: [[1e5, 2], [1e6, 3], [5e6, 2]], up: [[1e5, 2], [1e6, 3]] },
  normal: { label: 'Normal', down: [[1e5, 2], [1e6, 3], [1e7, 3], [2.5e7, 2]], up: [[1e5, 2], [1e6, 3], [5e6, 2]] },
  full: { label: 'Completo', down: [[1e5, 2], [1e6, 3], [1e7, 3], [2.5e7, 3], [1e8, 1]], up: [[1e5, 2], [1e6, 3], [1e7, 3], [2.5e7, 1]] },
};

/** DNS que dá para comparar pelo navegador (DNS seguro, RFC 8484) — e os endereços para configurar no sistema. */
export const DNS = {
  cloudflare: { label: 'Cloudflare', doh: 'https://cloudflare-dns.com/dns-query', dot: 'one.one.one.one', ips: ['1.1.1.1', '1.0.0.1'], v6: ['2606:4700:4700::1111'] },
  google: { label: 'Google', doh: 'https://dns.google/dns-query', dot: 'dns.google', ips: ['8.8.8.8', '8.8.4.4'], v6: ['2001:4860:4860::8888'] },
  quad9: { label: 'Quad9', doh: 'https://dns.quad9.net/dns-query', dot: 'dns.quad9.net', ips: ['9.9.9.9', '149.112.112.112'], v6: ['2620:fe::fe'], note: 'bloqueia sites maliciosos' },
  adguard: { label: 'AdGuard', doh: 'https://dns.adguard-dns.com/dns-query', dot: 'dns.adguard-dns.com', ips: ['94.140.14.14', '94.140.15.15'], v6: ['2a10:50c0::ad1:ff'], note: 'bloqueia anúncios e rastreadores' },
  opendns: { label: 'OpenDNS (Cisco)', doh: 'https://doh.opendns.com/dns-query', ips: ['208.67.222.222', '208.67.220.220'], v6: ['2620:119:35::35'] },
  nextdns: { label: 'NextDNS', doh: 'https://dns.nextdns.io/dns-query', ips: ['45.90.28.0', '45.90.30.0'], v6: ['2a07:a8c0::'] },
};
/** Nomes comuns: medem o DNS no uso do dia a dia (a resposta costuma estar no cache dele). */
export const DNS_NAMES = ['google.com', 'youtube.com', 'whatsapp.com', 'instagram.com', 'wikipedia.org', 'mercadolivre.com.br', 'globo.com', 'netflix.com'];

export const DEFAULT_NET = {
  server: 'cloudflare',
  custom: '', // servidor próprio compatível (…/__down?bytes=N e …/__up)
  plan: 'normal',
  targets: [], // endereços extras para medir a latência (ex.: o servidor do seu jogo)
  dns: Object.keys(DNS),
  monitor: { on: false, every: 10, lagMs: 150, background: false, notify: true, gateway: true },
  history: true,
  usePonte: true,
};

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const num = (v, a, b, d) => (Number.isFinite(Number(v)) ? clamp(Number(v), a, b) : d);

export function sanitizeNet(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const m = r.monitor && typeof r.monitor === 'object' ? r.monitor : {};
  return {
    server: r.server === 'custom' && validServer(r.custom) ? 'custom' : 'cloudflare',
    custom: validServer(r.custom) ? r.custom.trim().replace(/\/+$/, '') : '',
    plan: Object.hasOwn(PLANS, r.plan) ? r.plan : 'normal',
    targets: (Array.isArray(r.targets) ? r.targets : []).map((t) => String(t).trim()).filter(validTarget).slice(0, 5),
    dns: (Array.isArray(r.dns) ? r.dns : DEFAULT_NET.dns).filter((k) => Object.hasOwn(DNS, k)),
    monitor: {
      on: !!m.on,
      every: num(m.every, 3, 300, 10),
      lagMs: num(m.lagMs, 30, 2000, 150),
      background: !!m.background,
      notify: m.notify === undefined ? true : !!m.notify,
      gateway: m.gateway === undefined ? true : !!m.gateway,
    },
    history: r.history === undefined ? true : !!r.history,
    usePonte: r.usePonte === undefined ? true : !!r.usePonte,
  };
}

export function validServer(u) {
  try { const x = new URL(String(u || '').trim()); return x.protocol === 'https:' && !x.search && !x.hash; } catch { return false; }
}
export function validTarget(u) {
  try { const x = new URL(String(u || '').trim()); return x.protocol === 'https:'; } catch { return false; }
}
export const serverBase = (net) => (net.server === 'custom' && net.custom ? net.custom : SERVERS.cloudflare.base);
export const originOf = (u) => new URL(u).origin + '/*';

/** Volume aproximado de um teste de velocidade, em bytes. */
export function planBytes(plan) {
  const p = PLANS[plan] || PLANS.normal;
  const sum = (list) => list.reduce((a, [b, n]) => a + b * n, 0);
  return { down: sum(p.down), up: sum(p.up), total: sum(p.down) + sum(p.up) };
}

// ---------- estatística ----------
export function percentile(list, p) {
  const v = list.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}
export const median = (list) => percentile(list, 0.5);

/** Latência a partir de amostras (ms; null = falhou): mediana, jitter (média das variações seguidas), falhas. */
export function latencyStats(samples) {
  const ok = samples.filter((x) => Number.isFinite(x));
  let jitter = null;
  if (ok.length > 1) {
    let s = 0;
    for (let i = 1; i < ok.length; i++) s += Math.abs(ok[i] - ok[i - 1]);
    jitter = s / (ok.length - 1);
  }
  return {
    count: samples.length,
    ok: ok.length,
    median: median(ok),
    min: ok.length ? Math.min(...ok) : null,
    p95: percentile(ok, 0.95),
    jitter,
    loss: samples.length ? (samples.length - ok.length) / samples.length : null,
  };
}

export const mbps = (bytes, ms) => (ms > 0 ? (bytes * 8) / (ms * 1000) : null);

/** Resultado final de velocidade: percentil 90 das transferências de 1 MB para cima (como o teste da Cloudflare). */
export function speedFrom(points) {
  const big = points.filter((p) => p.bytes >= 1e6 && Number.isFinite(p.mbps));
  const use = big.length ? big : points.filter((p) => Number.isFinite(p.mbps));
  return percentile(use.map((p) => p.mbps), 0.9);
}

/** Para que a conexão serve, com o motivo (nada de nota mágica). */
export function verdict(r) {
  const out = [];
  const lat = r.latency?.median;
  const jit = r.latency?.jitter;
  const loss = r.latency?.loss || 0;
  const level = (good, ok) => (good ? 'bom' : ok ? 'ok' : 'ruim');
  const has = (v) => Number.isFinite(v);
  if (has(r.down)) {
    out.push({ id: 'web', label: 'Navegar', level: level(r.down >= 10 && (!has(lat) || lat < 100), r.down >= 2 && (!has(lat) || lat < 250)), why: 'precisa de ~2 Mbps e latência abaixo de 250 ms; fica ágil com 10 Mbps e menos de 100 ms' });
    out.push({ id: 'stream', label: 'Vídeo e séries', level: level(r.down >= 25, r.down >= 5), why: 'HD pede 5 Mbps; 4K pede 25 Mbps' });
  }
  if (has(lat)) {
    const call = level(lat < 100 && (!has(jit) || jit < 20) && loss < 0.01 && (!has(r.up) || r.up >= 3), lat < 200 && (!has(jit) || jit < 40) && loss < 0.03 && (!has(r.up) || r.up >= 1));
    out.push({ id: 'call', label: 'Chamadas de vídeo', level: call, why: 'pede latência abaixo de 150 ms, pouca variação (jitter < 30 ms), quase nenhuma falha e ~3 Mbps de envio' });
    out.push({ id: 'game', label: 'Jogos online', level: level(lat < 50 && (!has(jit) || jit < 10) && loss === 0, lat < 100 && (!has(jit) || jit < 25) && loss < 0.01), why: 'abaixo de 50 ms é ótimo; acima de 100 ms ou com variação alta, aparecem os lags' });
  }
  if (has(r.up)) out.push({ id: 'upload', label: 'Enviar arquivos e lives', level: level(r.up >= 10, r.up >= 3), why: 'lives em HD pedem 3 a 6 Mbps de envio; backups grandes ficam rápidos com 10 Mbps ou mais' });
  return out;
}

/** Ordena os DNS medidos: menos falhas primeiro, depois a menor mediana. */
export function rankDns(results) {
  return [...results].sort((a, b) => (a.stats.loss ?? 1) - (b.stats.loss ?? 1) || (a.stats.median ?? 1e9) - (b.stats.median ?? 1e9));
}

// ---------- monitor de travadas ----------
/** Junta amostras seguidas acima do limite (ou falhas) em eventos de travada. */
export function lagEvents(samples, lagMs) {
  const ev = [];
  let cur = null;
  for (const s of samples) {
    const bad = !Number.isFinite(s.ms) || s.ms > lagMs;
    if (bad) {
      if (!cur) { cur = { start: s.t, end: s.t, worst: s.ms ?? null, fails: 0, n: 0 }; ev.push(cur); }
      cur.end = s.t;
      cur.n++;
      if (!Number.isFinite(s.ms)) cur.fails++;
      else if (!Number.isFinite(cur.worst) || s.ms > cur.worst) cur.worst = s.ms;
    } else cur = null;
  }
  return ev;
}

/**
 * Onde as travadas acontecem, quando há o ping do roteador (Ponte): 'local' (Wi-Fi/cabo até o roteador),
 * 'isp' (da operadora para fora) ou null (sem dados suficientes).
 */
export function lagWhere(samples, lagMs) {
  const bad = samples.filter((s) => (!Number.isFinite(s.ms) || s.ms > lagMs) && 'gw' in s);
  if (bad.length < 2) return null;
  const local = bad.filter((s) => !Number.isFinite(s.gw) || s.gw > Math.max(30, lagMs / 3)).length;
  return local / bad.length >= 0.5 ? 'local' : 'isp';
}

export const HISTORY_MAX = 60; // testes de velocidade guardados
export const SAMPLES_MAX = 2880; // ~8 h de monitor a cada 10 s

export function sanitizeStore(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const arr = (a, max) => (Array.isArray(a) ? a.slice(-max) : []);
  return { v: 1, tests: arr(r.tests, HISTORY_MAX), samples: arr(r.samples, SAMPLES_MAX), devices: r.devices && typeof r.devices === 'object' ? r.devices : {}, dns: r.dns && Array.isArray(r.dns.list) ? r.dns : null };
}

// ---------- DNS: mensagem no formato da rede (RFC 1035) para o DNS seguro (RFC 8484) ----------
export function dnsQuery(name, id = 0) {
  const labels = name.replace(/\.$/, '').split('.');
  const bytes = [id >> 8, id & 255, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  for (const l of labels) {
    const enc = new TextEncoder().encode(l);
    if (!enc.length || enc.length > 63) throw new Error('nome inválido');
    bytes.push(enc.length, ...enc);
  }
  bytes.push(0, 0, 1, 0, 1); // tipo A, classe IN
  return new Uint8Array(bytes);
}
export function b64url(u8) {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Confere a resposta: mesmo id, é resposta, sem erro (RCODE 0) e com pelo menos um registro. */
export function dnsAnswerOk(buf, id = 0) {
  const u = new Uint8Array(buf);
  if (u.length < 12) return false;
  return ((u[0] << 8) | u[1]) === id && (u[2] & 0x80) !== 0 && (u[3] & 0x0f) === 0 && ((u[6] << 8) | u[7]) > 0;
}

// ---------- medições (precisam da permissão do site) ----------
const now = () => performance.now();

async function timed(fetchFn, url, opts = {}, timeout = 4000) {
  const ctl = new AbortController();
  const outer = opts.signal;
  const onAbort = () => ctl.abort();
  outer?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctl.abort(), timeout);
  const t0 = now();
  try {
    const r = await fetchFn(url, { cache: 'no-store', credentials: 'omit', ...opts, signal: ctl.signal });
    const t1 = now();
    await r.arrayBuffer();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return t1 - t0;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

/** Latência por HTTP: tempo até a resposta de um pedido mínimo. A primeira amostra (abre a conexão) é descartada. */
export async function measureLatency({ url, count = 12, gap = 120, signal, fetchFn = fetch, onSample } = {}) {
  const out = [];
  await timed(fetchFn, url, { signal }).catch(() => {});
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
    let ms = null;
    try { ms = await timed(fetchFn, url, { signal }); } catch (e) { if (signal?.aborted) throw e; }
    out.push(ms);
    onSample?.(ms, i);
    if (gap) await new Promise((r) => setTimeout(r, gap));
  }
  return out;
}

/** Download: baixa cada tamanho do plano e mede do primeiro byte ao último. */
export async function measureDown({ base, plan = 'normal', signal, fetchFn = fetch, onPoint } = {}) {
  const points = [];
  for (const [bytes, reps] of (PLANS[plan] || PLANS.normal).down) {
    for (let i = 0; i < reps; i++) {
      if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
      const r = await fetchFn(`${base}/__down?bytes=${bytes}&r=${Math.random().toString(36).slice(2)}`, { cache: 'no-store', credentials: 'omit', signal });
      if (!r.ok) throw new Error('O servidor de teste respondeu ' + r.status);
      const t0 = now();
      let got = 0;
      if (r.body?.getReader) {
        const rd = r.body.getReader();
        for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; }
      } else got = (await r.arrayBuffer()).byteLength;
      const p = { bytes: got, ms: now() - t0 };
      p.mbps = mbps(got, p.ms);
      points.push(p);
      onPoint?.(p, points);
      if (p.ms > 3500) break; // já deu para medir; tamanhos maiores só gastariam dados
    }
    if (points.at(-1)?.ms > 3500) break;
  }
  return points;
}

/** Upload: envia cada tamanho do plano; desconta a latência do tempo total. */
export async function measureUp({ base, plan = 'normal', latency = 0, signal, fetchFn = fetch, onPoint } = {}) {
  const points = [];
  for (const [bytes, reps] of (PLANS[plan] || PLANS.normal).up) {
    const body = new Uint8Array(bytes);
    for (let i = 0; i < reps; i++) {
      if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
      const t0 = now();
      const r = await fetchFn(`${base}/__up?r=${Math.random().toString(36).slice(2)}`, { method: 'POST', body, cache: 'no-store', credentials: 'omit', signal, headers: { 'content-type': 'application/octet-stream' } });
      await r.arrayBuffer();
      if (!r.ok) throw new Error('O servidor de teste respondeu ' + r.status);
      const ms = Math.max(1, now() - t0 - (latency || 0));
      const p = { bytes, ms, mbps: mbps(bytes, ms) };
      points.push(p);
      onPoint?.(p, points);
      if (p.ms > 3500) break;
    }
    if (points.at(-1)?.ms > 3500) break;
  }
  return points;
}

/** Compara os DNS seguros: uma consulta para aquecer a conexão e depois os nomes comuns. */
export async function benchDoh({ ids = Object.keys(DNS), names = DNS_NAMES, signal, fetchFn = fetch, onResult } = {}) {
  const results = [];
  for (const id of ids) {
    const d = DNS[id];
    if (!d) continue;
    const samples = [];
    const one = async (name) => {
      const q = dnsQuery(name);
      const t0 = now();
      const r = await fetchFn(`${d.doh}?dns=${b64url(q)}`, { headers: { accept: 'application/dns-message' }, cache: 'no-store', credentials: 'omit', signal });
      const buf = await r.arrayBuffer();
      if (!r.ok || !dnsAnswerOk(buf)) throw new Error('resposta inválida');
      return now() - t0;
    };
    await one('example.com').catch(() => {});
    for (const n of names) {
      if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
      samples.push(await one(n).catch((e) => { if (signal?.aborted) throw e; return null; }));
    }
    const res = { id, label: d.label, samples, stats: latencyStats(samples) };
    results.push(res);
    onResult?.(res, results);
  }
  return rankDns(results);
}

/** Origens que o teste precisa (para pedir a permissão antes). */
export function originsFor(net, { speed = true, dns = false } = {}) {
  const o = new Set();
  if (speed) { o.add(originOf(serverBase(net))); for (const t of net.targets) o.add(originOf(t)); }
  if (dns) for (const id of net.dns) o.add(originOf(DNS[id].doh));
  return [...o];
}
