// Widget Rede (#52): estatísticas, veredito por atividade, DNS, travadas e medições com fetch simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeNet, DEFAULT_NET, planBytes, percentile, latencyStats, speedFrom, verdict, rankDns, lagEvents, lagWhere, sanitizeStore,
  dnsQuery, b64url, dnsAnswerOk, measureLatency, measureDown, measureUp, benchDoh, originsFor, validServer, DNS,
} from '../../src/lib/net.js';
import { mergeSettings } from '../../src/lib/store.js';

test('configurações: valores ruins voltam ao padrão', () => {
  assert.deepEqual(sanitizeNet(null), DEFAULT_NET);
  const n = sanitizeNet({ server: 'custom', custom: 'http://inseguro.com', plan: 'gigante', dns: ['google', 'hacker'], targets: ['https://ok.com', 'javascript:1'], monitor: { every: 1, lagMs: 99999, on: 1 } });
  assert.equal(n.server, 'cloudflare', 'servidor próprio só com https');
  assert.equal(n.plan, 'normal');
  assert.deepEqual(n.dns, ['google']);
  assert.deepEqual(n.targets, ['https://ok.com']);
  assert.deepEqual([n.monitor.every, n.monitor.lagMs, n.monitor.on], [3, 2000, true]);
  assert.equal(sanitizeNet({ server: 'custom', custom: 'https://meu.speed/' }).custom, 'https://meu.speed');
  assert.ok(!validServer('https://x.com/?a=1'));
  assert.deepEqual(mergeSettings({}).net, DEFAULT_NET);
});

test('volume do teste é informado antes', () => {
  const p = planBytes('light');
  assert.equal(p.total, p.down + p.up);
  assert.ok(planBytes('full').total > planBytes('normal').total);
});

test('latência: mediana, jitter e falhas', () => {
  const s = latencyStats([10, 20, null, 30, 20]);
  assert.equal(s.median, 20);
  assert.equal(s.jitter, 10);
  assert.equal(s.loss, 0.2);
  assert.equal(s.min, 10);
  assert.equal(latencyStats([]).median, null);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
});

test('velocidade: percentil 90 das transferências de 1 MB para cima', () => {
  const pts = [{ bytes: 1e5, mbps: 5 }, { bytes: 1e6, mbps: 50 }, { bytes: 1e7, mbps: 90 }, { bytes: 1e7, mbps: 100 }];
  assert.ok(Math.abs(speedFrom(pts) - 98) < 0.01);
  assert.equal(speedFrom([{ bytes: 1e5, mbps: 4 }]), 4, 'sem transferências grandes, usa as pequenas');
});

test('veredito por atividade explica o motivo', () => {
  const good = verdict({ down: 300, up: 100, latency: { median: 12, jitter: 2, loss: 0 } });
  assert.deepEqual(good.map((v) => v.level), ['bom', 'bom', 'bom', 'bom', 'bom']);
  const bad = verdict({ down: 1.5, up: 0.5, latency: { median: 400, jitter: 90, loss: 0.1 } });
  assert.ok(bad.every((v) => v.level === 'ruim'));
  assert.ok(bad.every((v) => v.why.length > 10));
  assert.deepEqual(verdict({ latency: { median: 70, jitter: 10, loss: 0 } }).map((v) => v.id), ['call', 'game']);
});

test('DNS: ordem por falhas e depois mediana; mensagem RFC 8484', () => {
  const r = rankDns([{ id: 'a', stats: { loss: 0.5, median: 5 } }, { id: 'b', stats: { loss: 0, median: 30 } }, { id: 'c', stats: { loss: 0, median: 12 } }]);
  assert.deepEqual(r.map((x) => x.id), ['c', 'b', 'a']);
  const q = dnsQuery('google.com');
  assert.deepEqual([...q.slice(0, 4)], [0, 0, 1, 0]);
  assert.equal(q.length, 12 + 1 + 6 + 1 + 3 + 1 + 4);
  assert.equal(b64url(new Uint8Array([251, 255])), '-_8');
  const ans = new Uint8Array(12); ans[2] = 0x81; ans[3] = 0x80; ans[7] = 1;
  assert.ok(dnsAnswerOk(ans.buffer));
  ans[3] = 0x83; // NXDOMAIN
  assert.ok(!dnsAnswerOk(ans.buffer));
  for (const d of Object.values(DNS)) assert.match(d.doh, /^https:\/\/[^/]+\/dns-query$/);
});

test('travadas: junta picos seguidos e diz onde acontecem', () => {
  const s = [{ t: 1, ms: 20 }, { t: 2, ms: 400 }, { t: 3, ms: null }, { t: 4, ms: 30 }, { t: 5, ms: 900 }];
  const ev = lagEvents(s, 150);
  assert.equal(ev.length, 2);
  assert.deepEqual([ev[0].start, ev[0].end, ev[0].worst, ev[0].fails], [2, 3, 400, 1]);
  assert.equal(lagWhere([{ ms: 400, gw: 300 }, { ms: 500, gw: 250 }], 150), 'local');
  assert.equal(lagWhere([{ ms: 400, gw: 3 }, { ms: 500, gw: 4 }], 150), 'isp');
  assert.equal(lagWhere([{ ms: 400 }], 150), null);
});

test('histórico guardado tem limite', () => {
  const s = sanitizeStore({ tests: Array(100).fill({}), samples: Array(5000).fill({}) });
  assert.equal(s.tests.length, 60);
  assert.equal(s.samples.length, 2880);
});

test('origens pedidas antes de medir', () => {
  const n = sanitizeNet({ targets: ['https://jogo.exemplo/ping'], dns: ['quad9'] });
  assert.deepEqual(originsFor(n), ['https://speed.cloudflare.com/*', 'https://jogo.exemplo/*']);
  assert.deepEqual(originsFor(n, { speed: false, dns: true }), ['https://dns.quad9.net/*']);
});

// fetch simulado: responde na hora com o tamanho pedido
const fakeFetch = (fail = () => false) => async (url, opts = {}) => {
  if (opts.signal?.aborted) throw new DOMException('cancelado', 'AbortError');
  if (fail(url)) throw new TypeError('rede');
  const u = new URL(url);
  if (u.pathname === '/__down') return new Response(new Uint8Array(Number(u.searchParams.get('bytes'))));
  if (u.pathname === '/__up') return new Response('ok');
  if (u.pathname === '/dns-query') { const a = new Uint8Array(12); a[2] = 0x81; a[3] = 0x80; a[7] = 1; return new Response(a); }
  return new Response('', { status: 404 });
};

test('medições com servidor simulado: latência, download, upload, DNS e cancelamento', async () => {
  let n = 0;
  const lat = await measureLatency({ url: 'https://s/__down?bytes=0', count: 5, gap: 0, fetchFn: fakeFetch(() => ++n === 3) });
  assert.equal(lat.length, 5);
  assert.equal(lat.filter((x) => x === null).length, 1, 'uma falha vira null');
  const down = await measureDown({ base: 'https://s', plan: 'light', fetchFn: fakeFetch() });
  assert.equal(down.reduce((a, p) => a + p.bytes, 0), planBytes('light').down);
  const up = await measureUp({ base: 'https://s', plan: 'light', fetchFn: fakeFetch() });
  assert.equal(up.length, 5);
  const dns = await benchDoh({ ids: ['google', 'quad9'], names: ['a.com', 'b.com'], fetchFn: fakeFetch((u) => u.includes('quad9')) });
  assert.deepEqual(dns.map((d) => d.id), ['google', 'quad9']);
  assert.equal(dns[1].stats.loss, 1);
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(measureDown({ base: 'https://s', signal: ctl.signal, fetchFn: fakeFetch() }), /cancelado/);
});
