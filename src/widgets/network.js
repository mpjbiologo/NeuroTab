// Widget: Rede (#52) — velocidade, latência, travadas, melhor DNS e quem usa a rede.
// Pelo navegador: velocidade, latência e jitter estimados por HTTP e DNS seguro (DoH).
// Com a NeuroTab Ponte: ping de verdade (roteador × internet), DNS por UDP, aparelhos, programas e uso total.
// Nada roda sem a pessoa pedir; o monitor de travadas é opcional e configurável.
import { h } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { requestAccess } from '../lib/permissions.js';
import {
  NET_KEY, SERVERS, PLANS, DNS, DNS_NAMES, sanitizeNet, sanitizeStore, serverBase, originsFor, planBytes, latencyStats, speedFrom,
  verdict, rankDns, lagEvents, lagWhere, measureLatency, measureDown, measureUp, benchDoh, validServer, validTarget, median, HISTORY_MAX, SAMPLES_MAX,
} from '../lib/net.js';
import { PonteError, ponteAllowed, askPonte, pingReal, dnsUdp, netInfo, lanDevices, netProcs, netUsage } from '../lib/net-ponte.js';
import { ponteDownloads } from './clipboard-share-ui.js';

const fmtMbps = (v) => (Number.isFinite(v) ? (v >= 100 ? Math.round(v) : v.toFixed(1).replace('.', ',')) : '—');
const fmtMs = (v) => (Number.isFinite(v) ? Math.round(v) + ' ms' : '—');
const fmtPct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '—');
const fmtMB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.round(b / 1e6) + ' MB');
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const LEVEL = { bom: '✅', ok: '🟡', ruim: '🔴' };
const TABS = [['speed', 'Velocidade'], ['monitor', 'Travadas'], ['dns', 'DNS'], ['who', 'Quem usa']];

export default {
  id: 'network',
  title: 'Rede',
  icon: '📶',
  description: 'Teste de velocidade, latência e jitter, monitor de travadas, o melhor DNS para a sua conexão e, com a NeuroTab Ponte, quem está usando a rede.',
  defaultW: 6,
  mount(el, ctx) {
    let tab = ctx.widget.tab || 'speed';
    let store = sanitizeStore(null);
    let run = null; // { ctl, phase, text }
    let mon = null; // timer do monitor nesta aba
    let monSource = 'web';
    let ponteOk = null; // null = não testada; true; ou PonteError
    let info = null;
    let who = { devices: null, procs: null, usage: null, err: '' };
    let lastDns = null;

    const net = () => sanitizeNet(ctx.settings.net);
    const saveNet = (patch) => ctx.saveSettings({ net: sanitizeNet({ ...net(), ...patch, monitor: { ...net().monitor, ...(patch.monitor || {}) } }) });
    const persist = async () => { await chrome.storage.local.set({ [NET_KEY]: store }); };

    const body = h('div', { class: 'net' });
    const seg = h('div', { class: 'seg net-tabs', role: 'tablist' }, ...TABS.map(([id, label]) =>
      h('button', { class: 'btn', type: 'button', role: 'tab', 'data-t': id, onclick: () => { tab = id; ctx.saveWidget({ tab }); render(); } }, label)));
    ctx.actions.append(h('button', { title: 'Configurar o widget Rede', onclick: () => openConfig() }, '⚙️'));
    el.append(seg, body);

    async function checkPonte(force) {
      if (!net().usePonte) { ponteOk = null; return false; }
      if (ponteOk === true && !force) return true;
      if (!(await ponteAllowed())) { ponteOk = new PonteError('', 'permission'); return false; }
      try { info = await netInfo(); ponteOk = true; } catch (e) { ponteOk = e; }
      return ponteOk === true;
    }

    async function need(opts) {
      const origins = originsFor(net(), opts);
      return requestAccess({ origins });
    }

    function render() {
      seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.t === tab; b.classList.toggle('sel', on); b.setAttribute('aria-selected', String(on)); });
      const views = { speed: speedView, monitor: monitorView, dns: dnsView, who: whoView };
      body.replaceChildren(...(views[tab] || speedView)().flat().filter(Boolean));
    }

    // ===================== Velocidade =====================
    function speedView() {
      const n = net();
      const vol = planBytes(n.plan);
      const last = store.tests.at(-1);
      const out = [];
      if (run && run.kind === 'speed') {
        out.push(h('div', { class: 'net-live' },
          h('div', { class: 'net-big' }, h('b', {}, fmtMbps(run.mbps)), h('small', {}, 'Mbps')),
          h('p', { class: 'muted' }, t(run.text || 'Preparando…')),
          h('progress', { max: 1, value: run.progress || 0 }),
          h('button', { class: 'btn', type: 'button', onclick: () => run.ctl.abort() }, 'Cancelar')));
        return out;
      }
      out.push(h('div', { class: 'net-start' },
        h('button', { class: 'btn primary', type: 'button', onclick: speedTest }, '▶ ', t('Testar a velocidade')),
        h('small', { class: 'muted' }, `${t('Usa cerca de')} ${fmtMB(vol.total)} ${t('de dados')} · ${t(PLANS[n.plan].label)} · ${n.server === 'custom' ? new URL(n.custom).host : 'Cloudflare'}`)));
      if (last) out.push(resultCard(last));
      else out.push(h('p', { class: 'muted net-empty' }, t('Nenhum teste ainda. O teste só roda quando você clica.')));
      if (n.history && store.tests.length > 1) out.push(historyView());
      return out;
    }

    function resultCard(r) {
      const v = verdict(r);
      const real = r.ping?.length ? h('p', { class: 'net-real' }, '📍 ', t('Ping de verdade (Ponte):'), ' ', ...r.ping.map((p, i) => h('span', {}, i ? ' · ' : '', h('b', {}, p.label), ' ', fmtMs(p.median), p.loss ? ` (${fmtPct(p.loss)} ${t('perdidos')})` : ''))) : null;
      return h('div', { class: 'net-card' },
        h('div', { class: 'net-nums' },
          num('↓', 'Download', fmtMbps(r.down), 'Mbps'),
          num('↑', 'Upload', fmtMbps(r.up), 'Mbps'),
          num('⏱', 'Latência', Number.isFinite(r.latency?.median) ? Math.round(r.latency.median) : '—', 'ms'),
          num('〰', 'Jitter', Number.isFinite(r.latency?.jitter) ? Math.round(r.latency.jitter) : '—', 'ms'),
          num('✕', 'Falhas', fmtPct(r.latency?.loss), '')),
        real,
        h('ul', { class: 'net-verdict' }, ...v.map((x) => h('li', { title: t(x.why) }, `${LEVEL[x.level]} `, h('b', {}, t(x.label)), h('small', { class: 'muted' }, ` — ${t(x.why)}`)))),
        h('p', { class: 'muted net-note' }, `${hhmm(r.at)} · ${r.server} · `, t('A latência do navegador é medida pela web (HTTP) e costuma ser um pouco maior que o ping.')));
    }
    const num = (ic, label, value, unit) => h('div', { class: 'net-num' }, h('small', {}, `${ic} ${t(label)}`), h('b', {}, String(value)), unit ? h('small', {}, unit) : null);

    function historyView() {
      const list = store.tests.slice(-12);
      const max = Math.max(1, ...list.map((x) => x.down || 0));
      return h('details', { class: 'net-hist' },
        h('summary', {}, t('Histórico'), ` (${store.tests.length})`),
        h('div', { class: 'net-bars', role: 'img', 'aria-label': t('Download dos últimos testes') }, ...list.map((x) =>
          h('span', { title: `${new Date(x.at).toLocaleString()} — ↓ ${fmtMbps(x.down)} · ↑ ${fmtMbps(x.up)} Mbps · ${fmtMs(x.latency?.median)}`, style: { height: Math.max(4, ((x.down || 0) / max) * 100) + '%' } }))),
        h('table', { class: 'net-table' },
          h('thead', {}, h('tr', {}, ...['Quando', '↓ Mbps', '↑ Mbps', 'Latência'].map((x) => h('th', {}, t(x))))),
          h('tbody', {}, ...store.tests.slice(-8).reverse().map((x) => h('tr', {}, h('td', {}, new Date(x.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })), h('td', {}, fmtMbps(x.down)), h('td', {}, fmtMbps(x.up)), h('td', {}, fmtMs(x.latency?.median)))))),
        h('button', { class: 'btn', type: 'button', onclick: async () => { if (!confirm(t('Apagar o histórico de testes?'))) return; store.tests = []; await persist(); render(); } }, t('Apagar histórico')));
    }

    async function speedTest() {
      const n = net();
      if (!(await need({ speed: true }))) { ctx.toast('Sem a permissão do servidor de teste, não dá para medir.'); return; }
      const ctl = new AbortController();
      const base = serverBase(n);
      run = { kind: 'speed', ctl, text: 'Medindo a latência…', progress: 0, mbps: null };
      render();
      const up = () => { if (tab === 'speed') render(); };
      const res = { at: Date.now(), server: n.server === 'custom' ? new URL(base).host : 'Cloudflare', plan: n.plan };
      try {
        const lat = await measureLatency({ url: `${base}/__down?bytes=0`, count: 14, signal: ctl.signal, onSample: (_, i) => { run.progress = (i + 1) / 14 * 0.15; up(); } });
        res.latency = latencyStats(lat);
        const vol = planBytes(n.plan);
        let doneB = 0;
        run.text = 'Baixando…';
        const down = await measureDown({ base, plan: n.plan, signal: ctl.signal, onPoint: (p, all) => { doneB += p.bytes; run.mbps = speedFrom(all); run.progress = 0.15 + 0.55 * Math.min(1, doneB / vol.down); up(); } });
        res.down = speedFrom(down);
        run.text = 'Enviando…';
        run.mbps = null;
        let upB = 0;
        const upl = await measureUp({ base, plan: n.plan, latency: res.latency.median || 0, signal: ctl.signal, onPoint: (p, all) => { upB += p.bytes; run.mbps = speedFrom(all); run.progress = 0.7 + 0.25 * Math.min(1, upB / vol.up); up(); } });
        res.up = speedFrom(upl);
        if (await checkPonte()) {
          run.text = 'Ping de verdade (roteador e internet)…';
          up();
          const hosts = [info?.gateway, '1.1.1.1'].filter(Boolean);
          const pr = await pingReal(hosts, 8).catch(() => []);
          res.ping = (pr || []).map((p) => { const s = latencyStats([...(p.samples || []), ...Array(Math.max(0, p.sent - (p.samples || []).length)).fill(null)]); return { host: p.host, label: p.host === info?.gateway ? t('roteador') : t('internet'), median: s.median, loss: s.loss }; });
        }
        if (n.history) { store.tests.push(res); store.tests = store.tests.slice(-HISTORY_MAX); } else store.tests = [res];
        await persist();
      } catch (e) {
        if (e.name !== 'AbortError') ctx.toast(t('O teste falhou:') + ' ' + (e.message || e));
      } finally {
        run = null;
        render();
      }
    }

    // ===================== Travadas (monitor) =====================
    function monitorView() {
      const n = net();
      const m = n.monitor;
      const since = Date.now() - 3600e3;
      const recent = store.samples.filter((s) => s.t >= since);
      const st = latencyStats(recent.map((s) => s.ms));
      const ev = lagEvents(recent, m.lagMs).slice(-8).reverse();
      const on = !!mon;
      return [
        h('div', { class: 'net-start' },
          h('button', { class: 'btn' + (on ? '' : ' primary'), type: 'button', onclick: () => (on ? stopMonitor(true) : startMonitor(true)) }, on ? '⏸ ' + t('Parar o monitor') : '▶ ' + t('Vigiar a conexão')),
          h('small', { class: 'muted' }, on
            ? `${t('Medindo a cada')} ${m.every} s · ${monSource === 'ponte' ? t('ping de verdade pela Ponte') : t('latência pela web')} · ${t('travada acima de')} ${m.lagMs} ms`
            : `${t('Uma medida pequena a cada')} ${m.every} s ${t('enquanto a nova aba estiver aberta')}${m.background ? ' ' + t('(e em segundo plano, a cada minuto)') : ''}.`)),
        chart(recent, m.lagMs),
        h('div', { class: 'net-nums small' },
          num('⏱', 'Mediana', Number.isFinite(st.median) ? Math.round(st.median) : '—', 'ms'),
          num('〰', 'Jitter', Number.isFinite(st.jitter) ? Math.round(st.jitter) : '—', 'ms'),
          num('⚠', 'Travadas', String(lagEvents(recent, m.lagMs).length), t('na última hora')),
          num('✕', 'Falhas', fmtPct(st.loss), '')),
        where(recent, m.lagMs),
        ev.length
          ? h('ul', { class: 'net-events' }, ...ev.map((e) => h('li', {}, `${hhmm(e.start)} — `, e.fails === e.n ? t('sem conexão') : `${t('pico de')} ${Math.round(e.worst)} ms`, e.end > e.start ? ` · ${Math.round((e.end - e.start) / 1000)} s` : '')))
          : h('p', { class: 'muted' }, recent.length ? t('Nenhuma travada na última hora. 👍') : t('Ligue o monitor para ver as travadas aqui.')),
        h('div', { class: 'toolbar' },
          h('button', { class: 'chip', type: 'button', onclick: () => openConfig('monitor') }, '⚙️ ', t('Limites e intervalo')),
          store.samples.length ? h('button', { class: 'chip', type: 'button', onclick: async () => { store.samples = []; await persist(); render(); } }, t('Limpar')) : null),
      ];
    }

    function where(list, lagMs) {
      const w = lagWhere(list, lagMs);
      if (!w) return null;
      return h('p', { class: 'net-where' }, w === 'local'
        ? ['📶 ', h('b', {}, t('As travadas estão entre o computador e o roteador.')), ' ', t('Tente o cabo, chegar mais perto do roteador ou trocar o canal do Wi-Fi.')]
        : ['🌐 ', h('b', {}, t('As travadas estão depois do roteador, na operadora.')), ' ', t('O Wi-Fi está bem; se continuar, vale falar com a operadora (com estes horários).')]);
    }

    function chart(list, lagMs) {
      const W = 320; const H = 90; const P = 4;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('class', 'net-chart');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', t('Latência na última hora'));
      const pts = list.slice(-120);
      const max = Math.max(lagMs * 1.5, ...pts.map((s) => s.ms || 0));
      const y = (v) => H - P - (Math.min(v, max) / max) * (H - 2 * P);
      const x = (i) => P + (pts.length < 2 ? 0 : (i * (W - 2 * P)) / (pts.length - 1));
      const line = (cls, y1) => { const l = document.createElementNS(ns, 'line'); Object.entries({ x1: P, x2: W - P, y1, y2: y1, class: cls }).forEach(([k, v]) => l.setAttribute(k, v)); svg.append(l); };
      line('lim', y(lagMs));
      const pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', pts.map((s, i) => `${x(i).toFixed(1)},${(Number.isFinite(s.ms) ? y(s.ms) : P).toFixed(1)}`).join(' '));
      pl.setAttribute('class', 'lat');
      svg.append(pl);
      pts.forEach((s, i) => {
        if (Number.isFinite(s.ms) && s.ms <= lagMs) return;
        const c = document.createElementNS(ns, 'circle');
        Object.entries({ cx: x(i).toFixed(1), cy: (Number.isFinite(s.ms) ? y(s.ms) : P).toFixed(1), r: 2.6, class: 'bad' }).forEach(([k, v]) => c.setAttribute(k, v));
        svg.append(c);
      });
      return h('figure', { class: 'net-fig' }, svg);
    }

    async function startMonitor(user) {
      const n = net();
      if (user && !n.monitor.on) await saveNet({ monitor: { on: true } });
      monSource = (await checkPonte()) && n.monitor.gateway ? 'ponte' : 'web';
      if (monSource === 'web' && !(await need({ speed: true }))) { ctx.toast('Sem a permissão do servidor de teste, o monitor não funciona.'); await saveNet({ monitor: { on: false } }); return; }
      clearInterval(mon);
      const tick = async () => {
        const s = { t: Date.now(), ms: null };
        try {
          if (monSource === 'ponte') {
            const hosts = [info?.gateway, '1.1.1.1'].filter(Boolean);
            const r = await pingReal(hosts, 2);
            const inet = r.find((x) => x.host === '1.1.1.1');
            const gw = r.find((x) => x.host === info?.gateway);
            s.ms = median(inet?.samples || []);
            if (gw) s.gw = median(gw.samples || []);
          } else {
            const [ms] = await measureLatency({ url: `${serverBase(net())}/__down?bytes=0`, count: 1, gap: 0 });
            s.ms = ms;
          }
        } catch { s.ms = null; }
        store.samples.push(s);
        store.samples = store.samples.slice(-SAMPLES_MAX);
        await persist();
        if (tab === 'monitor' && !body.contains(document.activeElement)) render();
      };
      mon = setInterval(tick, n.monitor.every * 1000);
      tick();
      render();
    }
    async function stopMonitor(user) {
      clearInterval(mon);
      mon = null;
      if (user) await saveNet({ monitor: { on: false } });
      render();
    }

    // ===================== DNS =====================
    function dnsView() {
      const n = net();
      const out = [h('div', { class: 'net-start' },
        h('button', { class: 'btn primary', type: 'button', disabled: !!run, onclick: dnsTest }, '▶ ', t('Comparar DNS')),
        h('small', { class: 'muted' }, `${n.dns.length} ${t('servidores')} · ${DNS_NAMES.length} ${t('consultas cada')}${ponteOk === true ? ' · ' + t('com o DNS atual, pela Ponte') : ''}`))];
      if (run?.kind === 'dns') out.push(h('p', { class: 'muted' }, t(run.text)), h('progress', { max: 1, value: run.progress || 0 }));
      const r = lastDns || store.dns;
      if (r?.list?.length) {
        const best = r.list.find((x) => x.provider && (x.stats.loss ?? 1) < 0.25);
        out.push(h('table', { class: 'net-table net-dns' },
          h('thead', {}, h('tr', {}, ...['', 'DNS', 'Mediana', 'Falhas'].map((x) => h('th', {}, t(x))))),
          h('tbody', {}, ...r.list.map((x, i) => h('tr', { class: x === best ? 'best' : x.current ? 'cur' : '' },
            h('td', {}, String(i + 1)),
            h('td', {}, h('b', {}, x.label), x.current ? h('small', { class: 'muted' }, ` · ${t('o que você usa hoje')}`) : x.note ? h('small', { class: 'muted' }, ` · ${t(x.note)}`) : null),
            h('td', {}, fmtMs(x.stats.median)),
            h('td', {}, fmtPct(x.stats.loss)))))));
        out.push(h('p', { class: 'muted net-note' }, `${hhmm(r.at)} · `, r.method === 'udp' ? t('Medido do jeito clássico (UDP), pela NeuroTab Ponte.') : t('Medido pelo DNS seguro (HTTPS). O DNS clássico costuma responder um pouco mais rápido, mas a ordem se mantém.')));
        if (best) out.push(howTo(best));
      }
      return out;
    }

    function howTo(best) {
      const d = DNS[best.provider];
      return h('details', { class: 'net-how', open: true },
        h('summary', {}, '🏆 ', t('Recomendado:'), ' ', h('b', {}, d.label), ` (${fmtMs(best.stats.median)}) — `, t('como usar')),
        h('ul', {},
          h('li', {}, h('b', {}, t('Só neste navegador:')), ' ', t('Configurações → Privacidade e segurança → Segurança → "Usar DNS seguro" → Personalizado →'), ' ', h('code', {}, d.doh)),
          h('li', {}, h('b', {}, 'Windows:'), ' ', t('Configurações → Rede e Internet → (sua conexão) → Atribuição de servidor DNS → Editar → Manual →'), ' ', h('code', {}, d.ips.join(', '))),
          h('li', {}, h('b', {}, 'macOS:'), ' ', t('Ajustes do Sistema → Rede → (sua conexão) → Detalhes → DNS →'), ' ', h('code', {}, d.ips.join(', '))),
          d.dot ? h('li', {}, h('b', {}, 'Android:'), ' ', t('Configurações → Rede → DNS privado →'), ' ', h('code', {}, d.dot)) : null,
          h('li', {}, h('b', {}, t('Para a casa toda:')), ' ', t('no roteador, em DNS/DHCP, troque os servidores por'), ' ', h('code', {}, d.ips.join(', ')), '. ', t('Assim vale para todos os aparelhos.'))),
        h('p', { class: 'muted' }, t('A NeuroTab não muda o DNS sozinha. Se algo parar de funcionar, volte para "Automático".')));
    }

    async function dnsTest() {
      const n = net();
      const ctl = new AbortController();
      run = { kind: 'dns', ctl, text: 'Comparando os DNS…', progress: 0 };
      render();
      try {
        let list;
        let method = 'doh';
        if (await checkPonte()) {
          method = 'udp';
          const current = info?.dns || [];
          const servers = [...current, ...n.dns.map((id) => DNS[id].ips[0])];
          const res = await dnsUdp([...new Set(servers)], DNS_NAMES);
          list = res.map((x) => {
            const provider = Object.keys(DNS).find((id) => DNS[id].ips.includes(x.server));
            const isCur = current.includes(x.server);
            return { label: provider ? DNS[provider].label : isCur ? `${x.server}${x.server === info?.gateway ? ' (' + t('roteador') + ')' : ''}` : x.server, provider, current: isCur, note: provider && DNS[provider].note, stats: latencyStats(x.samples) };
          });
          list = rankDns(list);
        } else {
          if (!(await need({ speed: false, dns: true }))) { ctx.toast('Sem a permissão dos DNS, não dá para comparar.'); return; }
          const res = await benchDoh({ ids: n.dns, signal: ctl.signal, onResult: (_, all) => { run.progress = all.length / n.dns.length; if (tab === 'dns') render(); } });
          list = res.map((x) => ({ label: x.label, provider: x.id, note: DNS[x.id].note, stats: x.stats }));
        }
        lastDns = { at: Date.now(), method, list };
        store.dns = lastDns;
        await persist();
      } catch (e) {
        if (e.name !== 'AbortError') ctx.toast(t('A comparação falhou:') + ' ' + (e.message || e));
      } finally {
        run = null;
        render();
      }
    }

    // ===================== Quem usa =====================
    function whoView() {
      if (!net().usePonte) return [h('p', { class: 'muted' }, t('Desligado nas configurações do widget (usar a NeuroTab Ponte).'))];
      if (ponteOk !== true) return ponteHelp();
      const dev = who.devices;
      const labels = store.devices || {};
      return [
        h('div', { class: 'net-start' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => refreshWho(false) }, '↻ ', t('Atualizar')),
          h('button', { class: 'btn', type: 'button', onclick: () => refreshWho(true), title: t('Tenta falar com cada endereço da rede (leva uns segundos) para achar aparelhos que estavam quietos.') }, '🔎 ', t('Procurar aparelhos')),
          who.err ? h('small', { class: 'bad' }, who.err) : null),
        who.usage ? h('p', { class: 'net-usage' }, '💻 ', t('Este computador agora:'), ' ', h('b', {}, `↓ ${fmtMbps(who.usage.downMbps)} Mbps`), ' · ', h('b', {}, `↑ ${fmtMbps(who.usage.upMbps)} Mbps`)) : null,
        h('h4', {}, t('Aparelhos na rede'), dev ? ` (${dev.length})` : ''),
        dev ? h('ul', { class: 'net-devs' }, ...dev.map((d) => {
          const key = d.mac || d.ip;
          const lab = labels[key]?.label;
          const isNew = key && labels[key] && labels[key].first > Date.now() - 86400e3 && !lab;
          return h('li', {},
            h('span', { class: 'net-ico', 'aria-hidden': 'true' }, d.gateway ? '📡' : d.self ? '💻' : '📱'),
            h('span', { class: 'net-dn' }, h('b', {}, lab || d.name || t('Aparelho sem nome')), d.gateway ? h('small', { class: 'tag' }, t('roteador')) : null, d.self ? h('small', { class: 'tag' }, t('este computador')) : null, isNew ? h('small', { class: 'tag new' }, t('novo')) : null,
              h('small', { class: 'muted' }, ` ${d.ip}${d.mac ? ' · ' + d.mac : ''}`)),
            key ? h('button', { class: 'chip', type: 'button', title: t('Dar um nome'), onclick: async () => {
              const v = prompt(t('Nome deste aparelho (ex.: TV da sala, celular da Ana):'), lab || d.name || '');
              if (v === null) return;
              store.devices[key] = { ...(store.devices[key] || {}), label: v.trim().slice(0, 40) };
              await persist();
              render();
            } }, '✎') : null);
        })) : h('p', { class: 'muted' }, t('Carregando…')),
        h('h4', {}, t('Programas com conexões abertas')),
        who.procs ? (who.procs.length ? h('ul', { class: 'net-procs' }, ...who.procs.slice(0, 12).map((p) => {
          const max = who.procs[0].conns || 1;
          return h('li', {}, h('span', {}, p.name), h('span', { class: 'net-meter' }, h('i', { style: { width: Math.max(4, (p.conns / max) * 100) + '%' } })), h('small', { class: 'muted' }, `${p.conns}`));
        })) : h('p', { class: 'muted' }, t('Nenhuma conexão aberta agora.'))) : h('p', { class: 'muted' }, t('Carregando…')),
        h('p', { class: 'muted net-note' }, t('Mostra o número de conexões de cada programa (não o consumo em MB). Aparelhos aparecem quando falaram com a rede recentemente; "Procurar aparelhos" acha os que estavam quietos.')),
      ];
    }

    function ponteHelp() {
      const dl = ponteDownloads();
      const err = ponteOk instanceof PonteError ? ponteOk : null;
      return [
        h('p', {}, t('Para ver os aparelhos no Wi-Fi, os programas que usam a internet e o ping de verdade, a NeuroTab precisa da'), ' ', h('b', {}, 'NeuroTab Ponte'), ' — ', t('um programa pequeno e gratuito que roda no seu computador. O navegador sozinho não tem acesso a isso.')),
        err?.message ? h('p', { class: 'bad' }, '⚠️ ', t(err.message)) : null,
        h('div', { class: 'toolbar' },
          h('a', { class: 'btn primary', href: dl.url(dl.mine), target: '_blank', rel: 'noopener' }, '⬇ ', t('Baixar a Ponte para'), ' ', dl.all[dl.mine].label),
          h('button', { class: 'btn', type: 'button', onclick: async () => { if (await askPonte()) { await checkPonte(true); if (ponteOk === true) refreshWho(false); render(); } } }, t('Já instalei — conectar'))),
        h('p', { class: 'muted' }, t('Depois de baixar, abra o programa uma vez: ele se registra nos navegadores. Nada sai do seu computador.')),
      ];
    }

    async function refreshWho(scan) {
      who.err = '';
      if (scan) ctx.toast('Procurando aparelhos na rede… leva uns segundos.');
      const [d, p, u] = await Promise.allSettled([lanDevices(scan), netProcs(), netUsage()]);
      who.devices = d.status === 'fulfilled' ? d.value || [] : who.devices;
      who.procs = p.status === 'fulfilled' ? p.value || [] : [];
      who.usage = u.status === 'fulfilled' ? u.value : null;
      const errs = [d, p, u].filter((x) => x.status === 'rejected').map((x) => x.reason?.message);
      if (errs.length) who.err = '⚠️ ' + errs[0];
      for (const dv of who.devices || []) {
        const key = dv.mac || dv.ip;
        if (key && !store.devices[key]) store.devices[key] = { first: Date.now() };
      }
      await persist();
      if (tab === 'who') render();
    }

    // ===================== Configurações do widget =====================
    function openConfig(focus) {
      const n = net();
      const f = {
        server: h('select', {}, new Option('Cloudflare', 'cloudflare'), new Option(t('Outro servidor (compatível)'), 'custom')),
        custom: h('input', { type: 'url', placeholder: 'https://meu-servidor.exemplo', value: n.custom }),
        plan: h('select', {}, ...Object.entries(PLANS).map(([k, p]) => new Option(`${t(p.label)} (~${fmtMB(planBytes(k).total)})`, k))),
        targets: h('textarea', { rows: 2, placeholder: 'https://servidor-do-meu-jogo.com' }, n.targets.join('\n')),
        every: h('input', { type: 'number', min: 3, max: 300, value: n.monitor.every }),
        lag: h('input', { type: 'number', min: 30, max: 2000, step: 10, value: n.monitor.lagMs }),
        bg: h('input', { type: 'checkbox', checked: n.monitor.background }),
        notify: h('input', { type: 'checkbox', checked: n.monitor.notify }),
        gw: h('input', { type: 'checkbox', checked: n.monitor.gateway }),
        history: h('input', { type: 'checkbox', checked: n.history }),
        ponte: h('input', { type: 'checkbox', checked: n.usePonte }),
      };
      f.server.value = n.server;
      f.plan.value = n.plan;
      const dnsBox = h('div', { class: 'net-dnspick' }, ...Object.entries(DNS).map(([id, d]) => h('label', {}, h('input', { type: 'checkbox', value: id, checked: n.dns.includes(id) }), ` ${d.label}`)));
      const err = h('p', { class: 'bad', role: 'alert' });
      const row = (label, ctl, hint) => h('label', {}, t(label), ctl, hint ? h('small', { class: 'muted' }, t(hint)) : null);
      const chk = (ctl, label, hint) => h('label', { class: 'clip-opt' }, ctl, h('span', {}, h('b', {}, t(label)), hint ? h('small', { class: 'muted' }, t(hint)) : null));
      const dlg = h('dialog', { class: 'dlg net-dlg' }, h('form', { method: 'dialog' },
        h('h2', {}, '📶 ', t('Configurar o widget Rede')),
        h('h3', {}, t('Teste de velocidade')),
        row('Servidor de teste', f.server),
        row('Endereço do servidor', f.custom, 'Precisa responder como o da Cloudflare: /__down?bytes=N e /__up.'),
        row('Tamanho do teste', f.plan),
        row('Outros endereços para medir a latência (um por linha)', f.targets, 'Ex.: o site do seu trabalho ou o servidor do seu jogo.'),
        chk(f.history, 'Guardar o histórico dos testes', 'Fica só neste computador.'),
        h('h3', { id: 'net-cfg-monitor' }, t('Monitor de travadas')),
        row('Medir a cada (segundos)', f.every),
        row('Considerar travada acima de (ms)', f.lag, 'Jogos: 80–100 ms. Chamadas de vídeo: 150 ms. Navegar: 300 ms.'),
        chk(f.gw, 'Separar roteador e internet', 'Com a Ponte: mostra se o lag é no Wi-Fi ou na operadora.'),
        chk(f.bg, 'Vigiar também com a nova aba fechada', 'Uma medida pequena por minuto, em segundo plano.'),
        chk(f.notify, 'Avisar quando a internet travar', 'No máximo um aviso a cada 10 minutos.'),
        h('h3', {}, t('DNS para comparar')),
        dnsBox,
        h('h3', {}, 'NeuroTab Ponte'),
        chk(f.ponte, 'Usar a NeuroTab Ponte quando estiver instalada', 'Ping de verdade, DNS da operadora e "Quem usa a rede".'),
        err,
        h('div', { class: 'actions' }, h('button', { class: 'btn', value: 'cancel', formnovalidate: true }, t('Cancelar')), h('button', { class: 'btn primary', value: 'ok' }, t('Salvar')))));
      const sync = () => { f.custom.closest('label').hidden = f.server.value !== 'custom'; };
      f.server.onchange = sync;
      sync();
      dlg.querySelector('form').addEventListener('submit', (e) => {
        if (e.submitter?.value !== 'ok') return;
        const targets = f.targets.value.split(/\s+/).filter(Boolean);
        const bad = targets.find((x) => !validTarget(x));
        if (f.server.value === 'custom' && !validServer(f.custom.value)) { e.preventDefault(); err.textContent = t('O endereço do servidor precisa começar com https://'); return; }
        if (bad) { e.preventDefault(); err.textContent = t('Endereço inválido:') + ' ' + bad; }
      });
      dlg.addEventListener('close', async () => {
        dlg.remove();
        if (dlg.returnValue !== 'ok') return;
        const wasOn = net().monitor.on;
        await saveNet({
          server: f.server.value, custom: f.custom.value, plan: f.plan.value,
          targets: f.targets.value.split(/\s+/).filter(Boolean),
          dns: [...dnsBox.querySelectorAll('input:checked')].map((x) => x.value),
          history: f.history.checked, usePonte: f.ponte.checked,
          monitor: { every: Number(f.every.value), lagMs: Number(f.lag.value), background: f.bg.checked, notify: f.notify.checked, gateway: f.gw.checked },
        });
        if (net().server === 'custom' || net().targets.length) await need({ speed: true });
        chrome.runtime.sendMessage({ type: 'net:monitor' }).catch(() => {});
        if (wasOn && mon) { await stopMonitor(false); startMonitor(false); }
        render();
        ctx.toast('Configurações da Rede salvas');
      });
      document.body.append(dlg);
      dlg.showModal();
      if (focus === 'monitor') dlg.querySelector('#net-cfg-monitor')?.scrollIntoView({ block: 'start' });
    }

    // ---------- início ----------
    const onChange = (c, area) => { if (area === 'local' && c[NET_KEY]) { store = sanitizeStore(c[NET_KEY].newValue); if (!run && !body.contains(document.activeElement)) render(); } };
    chrome.storage.onChanged.addListener(onChange);
    ctx.onCleanup(() => { chrome.storage.onChanged.removeListener(onChange); clearInterval(mon); run?.ctl?.abort(); });
    chrome.storage.local.get(NET_KEY).then(async (r) => {
      store = sanitizeStore(r[NET_KEY]);
      lastDns = r[NET_KEY]?.dns || null;
      render();
      await checkPonte();
      if (net().monitor.on) startMonitor(false);
      if (tab === 'who' && ponteOk === true) refreshWho(false);
      render();
    });
    seg.addEventListener('click', () => { if (tab === 'who' && ponteOk === true && !who.devices) refreshWho(false); });
    render();
  },
};
