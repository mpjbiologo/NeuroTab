// Widget: Sistema (0.7.10) — processador, placa de vídeo, memória, discos, temperaturas, bateria e programas.
// Fontes (lib/sysinfo.js): NeuroTab Ponte (tudo), LibreHardwareMonitor (temperaturas no Windows) e o navegador
// (só CPU e RAM, Chrome/Edge). Lê só enquanto o widget está na tela e a aba está visível.
import { h } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { requestAccess } from '../lib/permissions.js';
import { sanitizeSys, mergeSys, evalAlerts, readBrowser, readLhm, fmtBytes, fmtTemp, fmtPct, fmtUptime, memUsedPct, diskFreePct, validLhmUrl } from '../lib/sysinfo.js';
import { openSysStream } from '../lib/sys-ponte.js';
import { PonteError, ponteAllowed, askPonte } from '../lib/net-ponte.js';
import { ponteDownloads } from './clipboard-share-ui.js';

const HIST = 150; // pontos nos gráficos (~5 min a cada 2 s)
const ALERT_KEY = 'nt_sys_alerted';
const LHM_GUIDE = 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases';

export default {
  id: 'system',
  title: 'Sistema',
  icon: '🖥️',
  description: 'Uso e temperatura do processador e da placa de vídeo, memória, discos, bateria e os programas que mais gastam. Completo com a NeuroTab Ponte; temperaturas no Windows pelo LibreHardwareMonitor.',
  defaultW: 6,
  mount(el, ctx) {
    const cfg = () => sanitizeSys(ctx.settings.system);
    const data = { ponte: null, lhm: null, browser: null };
    const hist = { cpu: [], temp: [], ram: [] };
    let ponteErr = null;
    let lhmErr = '';
    let stopStream = null;
    let timers = [];
    let visible = false;
    let running = false;
    let procSort = 'cpu';
    const open = { procs: true, temps: false };
    const alertState = {};

    const body = h('div', { class: 'sys' });
    ctx.actions.append(h('button', { title: t('Configurar o widget Sistema'), onclick: () => openConfig() }, '⚙️'));
    el.append(body);

    // ---------- ciclo de leitura ----------
    async function start() {
      if (running) return;
      running = true;
      const c = cfg();
      ponteErr = null;
      if (c.usePonte) {
        try {
          stopStream = await openSysStream({ interval: c.every * 1000, procs: c.show.procs, onSnap: (s) => { data.ponte = s; update(); }, onError: (e) => { ponteErr = e; data.ponte = null; stopStream = null; startBrowser(); update(); } });
        } catch (e) { ponteErr = e; }
      } else ponteErr = new PonteError('', 'off');
      if (c.lhm.on) {
        const tickLhm = async () => {
          try { data.lhm = await readLhm(c.lhm.url); lhmErr = ''; } catch (e) { data.lhm = null; lhmErr = e.name === 'AbortError' ? t('O LibreHardwareMonitor não respondeu. Ele está aberto, com o servidor web ligado?') : e.message; }
          if (!data.ponte) update();
        };
        tickLhm();
        timers.push(setInterval(tickLhm, Math.max(2, c.every) * 1000));
      }
      if (ponteErr) startBrowser();
      update();
    }
    function startBrowser() {
      if (timers.browser) return;
      const tick = async () => { try { data.browser = await readBrowser(data.browser); } catch { data.browser = null; } if (!data.ponte) update(); };
      tick();
      timers.browser = setInterval(tick, cfg().every * 1000);
      timers.push(timers.browser);
    }
    function stop() {
      running = false;
      stopStream?.();
      stopStream = null;
      for (const x of timers) clearInterval(x);
      timers = [];
    }
    const restart = () => { stop(); data.ponte = data.lhm = data.browser = null; if (visible) start(); else render(); };
    const sync = () => { const want = visible && !document.hidden; if (want && !running) start(); else if (!want && running) stop(); };
    const io = new IntersectionObserver((e) => { visible = e.some((x) => x.isIntersecting); sync(); });
    io.observe(el);
    const onVis = () => sync();
    document.addEventListener('visibilitychange', onVis);

    let pending = false;
    function update() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; render(); });
    }

    // ---------- desenho ----------
    function render() {
      const c = cfg();
      const v = mergeSys(data);
      const has = v.sources.length > 0 && (Number.isFinite(v.cpu.usage) || v.mem);
      if (has) {
        push(hist.cpu, v.cpu.usage);
        push(hist.temp, v.cpu.temp);
        push(hist.ram, memUsedPct(v.mem));
        alerts(v);
      }
      const kids = [];
      kids.push(sourcesLine(v));
      if (!has) kids.push(...emptyState());
      else {
        const cards = [];
        if (c.show.cpu) cards.push(cpuCard(v, c));
        if (c.show.gpu) for (const g of v.gpus) cards.push(gpuCard(g, c));
        if (c.show.ram && v.mem) cards.push(ramCard(v));
        if (c.show.battery && v.battery) cards.push(batteryCard(v.battery));
        kids.push(h('div', { class: 'sys-cards' }, ...cards));
        if (c.show.disks && v.disks.length) kids.push(disksView(v, c));
        if (c.show.procs && v.procs.length) kids.push(procsView(v));
        if (v.temps.length) kids.push(tempsView(v, c));
        kids.push(...hints(v));
      }
      body.replaceChildren(...kids.filter(Boolean));
    }
    const push = (arr, x) => { arr.push(Number.isFinite(x) ? x : null); if (arr.length > HIST) arr.shift(); };

    function sourcesLine(v) {
      const chip = (on, label, title) => h('span', { class: 'sys-src' + (on ? ' on' : ''), title: t(title) }, on ? '● ' : '○ ', label);
      return h('div', { class: 'sys-top' },
        chip(v.sources.includes('ponte'), 'Ponte', 'NeuroTab Ponte: processador, memória, discos, programas e (Linux/NVIDIA) temperaturas.'),
        cfg().lhm.on ? chip(v.sources.includes('lhm'), 'LibreHardwareMonitor', 'Temperaturas e sensores no Windows.') : null,
        !v.sources.includes('ponte') && v.sources.includes('browser') ? chip(true, t('Navegador'), 'Só processador e memória.') : null,
        h('span', { class: 'grow' }),
        v.host ? h('small', { class: 'muted' }, v.host) : null,
        v.uptime ? h('small', { class: 'muted', title: t('Ligado há') }, '⏱ ', fmtUptime(v.uptime)) : null);
    }

    const level = (x, warn, bad) => (!Number.isFinite(x) ? '' : x >= bad ? 'bad' : x >= warn ? 'warn' : 'ok');
    const bar = (pct, cls = '') => h('span', { class: 'sys-bar ' + cls }, h('i', { style: { width: `${Math.max(0, Math.min(100, pct || 0))}%` } }));

    function cpuCard(v, c) {
      const tc = level(v.cpu.temp, c.alerts.cpuTemp - 15, c.alerts.cpuTemp);
      return h('div', { class: 'sys-card' },
        h('div', { class: 'sys-h' }, h('b', {}, t('Processador')), Number.isFinite(v.cpu.temp) ? h('span', { class: 'sys-temp ' + tc }, '🌡 ', fmtTemp(v.cpu.temp, c.unit)) : null),
        h('div', { class: 'sys-big' }, fmtPct(v.cpu.usage)),
        c.show.charts ? spark([['use', hist.cpu, 100], ...(hist.temp.some(Number.isFinite) ? [['temp', hist.temp, Math.max(100, c.alerts.cpuTemp + 5)]] : [])]) : null,
        v.cpu.perCore?.length ? h('div', { class: 'sys-cores', title: t('Uso de cada núcleo') }, ...v.cpu.perCore.slice(0, 32).map((x) => h('i', { style: { height: `${Math.max(4, x)}%` } }))) : null,
        h('small', { class: 'muted sys-model', title: v.cpu.model }, [v.cpu.model, v.cpu.cores ? `${v.cpu.cores} ${t('núcleos')}` : '', v.cpu.mhz ? `${(v.cpu.mhz / 1000).toFixed(1).replace('.', ',')} GHz` : ''].filter(Boolean).join(' · ')));
    }
    function gpuCard(g, c) {
      const mem = g.memTotal ? (g.memUsed / g.memTotal) * 100 : null;
      return h('div', { class: 'sys-card' },
        h('div', { class: 'sys-h' }, h('b', {}, t('Placa de vídeo')), Number.isFinite(g.temp) ? h('span', { class: 'sys-temp ' + level(g.temp, c.alerts.gpuTemp - 15, c.alerts.gpuTemp) }, '🌡 ', fmtTemp(g.temp, c.unit)) : null),
        h('div', { class: 'sys-big' }, fmtPct(g.usage)),
        g.memTotal ? h('div', { class: 'sys-row' }, h('small', {}, t('Memória de vídeo')), bar(mem, level(mem, 80, 95)), h('small', {}, `${fmtBytes(g.memUsed)} / ${fmtBytes(g.memTotal)}`)) : null,
        h('small', { class: 'muted sys-model', title: g.name }, g.name));
    }
    function ramCard(v) {
      const pct = memUsedPct(v.mem);
      const swap = v.mem.swapTotal ? (v.mem.swapUsed / v.mem.swapTotal) * 100 : null;
      return h('div', { class: 'sys-card' },
        h('div', { class: 'sys-h' }, h('b', {}, t('Memória'))),
        h('div', { class: 'sys-big' }, fmtPct(pct)),
        cfg().show.charts ? spark([['ram', hist.ram, 100]]) : null,
        h('small', { class: 'muted' }, `${fmtBytes(v.mem.total - v.mem.available)} ${t('em uso de')} ${fmtBytes(v.mem.total)} · ${fmtBytes(v.mem.available)} ${t('livres')}`),
        v.mem.swapTotal ? h('small', { class: 'muted' }, `${t('Troca (swap)')}: ${fmtBytes(v.mem.swapUsed)} / ${fmtBytes(v.mem.swapTotal)} (${fmtPct(swap)})`) : null);
    }
    function batteryCard(b) {
      return h('div', { class: 'sys-card' },
        h('div', { class: 'sys-h' }, h('b', {}, t('Bateria')), h('small', { class: 'muted' }, b.charging ? '⚡ ' + t('carregando') : b.plugged ? '🔌 ' + t('na tomada') : '🔋 ' + t('na bateria'))),
        h('div', { class: 'sys-big' }, fmtPct(b.percent)),
        bar(b.percent, b.percent <= 15 && !b.plugged ? 'bad' : b.percent <= 30 && !b.plugged ? 'warn' : 'ok'));
    }

    function disksView(v, c) {
      return h('div', { class: 'sys-disks' }, h('h4', {}, t('Discos')),
        ...v.disks.map((d) => {
          const used = d.total ? ((d.total - d.free) / d.total) * 100 : 0;
          const free = diskFreePct(d);
          return h('div', { class: 'sys-disk' },
            h('span', { class: 'sys-dn', title: [d.mount, d.fs].filter(Boolean).join(' · ') }, h('b', {}, d.mount), d.label && d.label !== d.mount ? h('small', { class: 'muted' }, ` ${d.label}`) : null),
            bar(used, free < c.alerts.diskFree ? 'bad' : free < c.alerts.diskFree * 2 ? 'warn' : 'ok'),
            h('small', {}, `${fmtBytes(d.free)} ${t('livres de')} ${fmtBytes(d.total)}`),
            Number.isFinite(d.temp) ? h('small', { class: 'sys-temp' }, fmtTemp(d.temp, c.unit)) : null);
        }));
    }

    function procsView(v) {
      const list = [...v.procs].sort((a, b) => (procSort === 'cpu' ? b.cpu - a.cpu || b.rss - a.rss : b.rss - a.rss)).slice(0, 6);
      const det = h('details', { class: 'sys-procs', open: open.procs, ontoggle: () => { open.procs = det.open; } },
        h('summary', {}, t('Programas que mais gastam'), ' ',
          h('span', { class: 'seg' }, ...[['cpu', 'CPU'], ['ram', 'RAM']].map(([k, l]) => h('button', { type: 'button', class: 'btn' + (procSort === k ? ' sel' : ''), onclick: (e) => { e.preventDefault(); procSort = k; render(); } }, l)))),
        h('table', { class: 'net-table' },
          h('thead', {}, h('tr', {}, h('th', {}, t('Programa')), h('th', {}, 'CPU'), h('th', {}, 'RAM'))),
          h('tbody', {}, ...list.map((p) => h('tr', {}, h('td', { title: `PID ${p.pid}` }, p.name), h('td', {}, fmtPct(p.cpu)), h('td', {}, fmtBytes(p.rss)))))));
      return det;
    }

    function tempsView(v, c) {
      const list = [...v.temps].sort((a, b) => (a.kind === b.kind ? b.c - a.c : a.kind < b.kind ? -1 : 1));
      const det = h('details', { class: 'sys-temps', open: open.temps, ontoggle: () => { open.temps = det.open; } },
        h('summary', {}, t('Todos os sensores de temperatura'), ` (${list.length})`),
        h('ul', {}, ...list.map((x) => h('li', {}, h('span', {}, x.label), h('b', {}, fmtTemp(x.c, c.unit))))));
      return det;
    }

    function hints(v) {
      const out = [];
      const noTemp = !Number.isFinite(v.cpu.temp);
      if (noTemp && (v.notes.includes('temp-windows') || (!v.sources.includes('ponte') && /Win/.test(navigator.platform)))) {
        out.push(h('div', { class: 'sys-hint' },
          h('p', {}, '🌡 ', h('b', {}, t('Temperaturas no Windows:')), ' ', t('o Windows não entrega as temperaturas a programas comuns. Use o LibreHardwareMonitor (gratuito):')),
          h('ol', {},
            h('li', {}, h('a', { href: LHM_GUIDE, target: '_blank', rel: 'noopener' }, t('Baixe o LibreHardwareMonitor')), ': ', t('na lista de arquivos, escolha'), ' ', h('code', {}, 'LibreHardwareMonitor.zip'), ' ', t('(não o que termina em .NET.10, que exige instalar o .NET 10).')),
            h('li', {}, t('Descompacte numa pasta que você não vá apagar e abra o LibreHardwareMonitor.exe com o botão direito → Executar como administrador (sem isso, a temperatura do processador costuma ficar vazia).')),
            h('li', {}, t('No menu Options → Remote Web Server → marque "Run" (porta 8085).')),
            h('li', {}, t('Aqui no ⚙️, ligue "Ler temperaturas do LibreHardwareMonitor".')),
            h('li', {}, t('Para abrir sozinho com o Windows: Options → Run On Windows Startup.'))),
          lhmErr ? h('p', { class: 'bad' }, '⚠️ ', lhmErr) : null));
      } else if (noTemp && v.notes.includes('temp-mac')) {
        out.push(h('p', { class: 'muted sys-note' }, '🌡 ', t('No macOS, as temperaturas só saem com acesso de administrador. O resto funciona normalmente.')));
      } else if (lhmErr) out.push(h('p', { class: 'bad sys-note' }, '⚠️ ', lhmErr));
      if (ponteErr && ponteErr.code !== 'off' && v.sources.includes('browser')) out.push(h('p', { class: 'muted sys-note' }, t('Pelo navegador dá para ver só o processador e a memória. Instale a NeuroTab Ponte para ver discos, temperaturas, placa de vídeo e programas.'), ' ', h('button', { type: 'button', class: 'linkish', onclick: () => { data.browser = null; ponteErr = null; stop(); ponteHelpOpen = true; render(); } }, t('Como?'))));
      return out;
    }

    let ponteHelpOpen = false;
    function emptyState() {
      const dl = ponteDownloads();
      const err = ponteErr && ponteErr.code !== 'off' ? ponteErr : null;
      const chromium = !!globalThis.chrome?.system?.cpu || !navigator.userAgent.includes('Firefox');
      if (!running && !ponteHelpOpen) return [h('p', { class: 'muted' }, t('Carregando…'))];
      return [
        h('p', {}, t('Para ver temperaturas, discos, placa de vídeo e programas, a NeuroTab precisa da'), ' ', h('b', {}, 'NeuroTab Ponte'), ' — ', t('um programa pequeno e gratuito que roda no seu computador. Ele é o mesmo da área de transferência e do widget Rede.')),
        err?.message && err.code !== 'permission' ? h('p', { class: 'bad' }, '⚠️ ', t(err.message)) : null,
        h('div', { class: 'toolbar' },
          h('a', { class: 'btn primary', href: dl.url(dl.mine), target: '_blank', rel: 'noopener' }, '⬇ ', t('Baixar a Ponte para'), ' ', dl.all[dl.mine].label),
          h('button', { class: 'btn', type: 'button', onclick: async () => { if (await askPonte()) { ponteHelpOpen = false; restart(); } } }, t('Já instalei — conectar'))),
        chromium ? h('p', { class: 'muted' }, t('Ou veja só o processador e a memória pelo navegador:'), ' ', h('button', { type: 'button', class: 'linkish', onclick: async () => { if (await requestAccess({ permissions: ['system.cpu', 'system.memory'] })) { ponteHelpOpen = false; restart(); } } }, t('permitir'))) : null,
      ];
    }

    // ---------- gráficos ----------
    function spark(series) {
      const W = 200; const H = 36;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('class', 'sys-spark');
      svg.setAttribute('aria-hidden', 'true');
      for (const [cls, arr, max] of series) {
        const pts = arr.map((x, i) => (Number.isFinite(x) ? `${((i + HIST - arr.length) / (HIST - 1) * W).toFixed(1)},${(H - 1 - (Math.min(x, max) / max) * (H - 2)).toFixed(1)}` : null)).filter(Boolean);
        if (pts.length < 2) continue;
        const pl = document.createElementNS(ns, 'polyline');
        pl.setAttribute('points', pts.join(' '));
        pl.setAttribute('class', cls);
        svg.append(pl);
      }
      return svg;
    }

    // ---------- alertas ----------
    async function alerts(v) {
      const c = cfg();
      if (!c.alerts.notify) return;
      const list = evalAlerts(v, c, alertState);
      if (!list.length) return;
      const st = (await chrome.storage.session.get(ALERT_KEY).catch(() => ({})))[ALERT_KEY] || {};
      const now = Date.now();
      let changed = false;
      for (const a of list) {
        if (now - (st[a.id] || 0) < 15 * 60e3) continue; // no máximo um aviso de cada tipo a cada 15 min
        st[a.id] = now;
        changed = true;
        chrome.notifications.create('sys:' + a.id, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: t(a.title), message: t(a.body) });
      }
      if (changed) chrome.storage.session.set({ [ALERT_KEY]: st }).catch(() => {});
    }

    // ---------- configurações ----------
    function openConfig() {
      const c = cfg();
      const chk = (on, label, hint) => { const i = h('input', { type: 'checkbox', checked: on }); return [i, h('label', { class: 'clip-opt' }, i, h('span', {}, h('b', {}, t(label)), hint ? h('small', { class: 'muted' }, t(hint)) : null))]; };
      const show = Object.fromEntries(Object.entries({ cpu: 'Processador', gpu: 'Placa de vídeo', ram: 'Memória', disks: 'Discos', battery: 'Bateria', procs: 'Programas que mais gastam', charts: 'Gráficos' }).map(([k, l]) => [k, chk(c.show[k], l)]));
      const unit = h('select', {}, new Option('°C', 'C'), new Option('°F', 'F'));
      unit.value = c.unit;
      const every = h('input', { type: 'number', min: 1, max: 10, value: c.every });
      const n = (v, a, b, step = 1) => h('input', { type: 'number', min: a, max: b, step, value: v });
      const cpuT = n(c.alerts.cpuTemp, 50, 110);
      const gpuT = n(c.alerts.gpuTemp, 50, 110);
      const disk = n(c.alerts.diskFree, 1, 50);
      const ram = n(c.alerts.ram, 50, 99);
      const [notify, notifyL] = chk(c.alerts.notify, 'Avisar', 'Notificação do sistema, no máximo uma de cada tipo a cada 15 minutos, enquanto uma nova aba estiver aberta.');
      const [lhm, lhmL] = chk(c.lhm.on, 'Ler temperaturas do LibreHardwareMonitor', 'Windows: abra o LibreHardwareMonitor com Options → Remote Web Server → Run.');
      const lhmUrl = h('input', { type: 'url', value: c.lhm.url, placeholder: 'http://localhost:8085' });
      const [ponte, ponteL] = chk(c.usePonte, 'Usar a NeuroTab Ponte', 'Discos, temperaturas (Linux e NVIDIA), placa de vídeo, bateria e programas.');
      const err = h('p', { class: 'bad', role: 'alert' });
      const row = (label, ctl, hint) => h('label', {}, t(label), ctl, hint ? h('small', { class: 'muted' }, t(hint)) : null);
      const dlg = h('dialog', { class: 'dlg net-dlg' }, h('form', { method: 'dialog' },
        h('h2', {}, '🖥️ ', t('Configurar o widget Sistema')),
        h('h3', {}, t('O que mostrar')),
        h('div', { class: 'net-dnspick' }, ...Object.values(show).map(([, l]) => l)),
        row('Temperatura em', unit),
        row('Atualizar a cada (segundos)', every, 'Só enquanto o widget está na tela.'),
        h('h3', {}, t('Alertas')),
        notifyL,
        row('Processador acima de (°C)', cpuT),
        row('Placa de vídeo acima de (°C)', gpuT),
        row('Disco com menos de (% livre)', disk),
        row('Memória acima de (%) por 1 minuto', ram),
        h('h3', {}, t('Fontes')),
        ponteL,
        lhmL,
        row('Endereço do LibreHardwareMonitor', lhmUrl),
        err,
        h('div', { class: 'actions' }, h('button', { class: 'btn', value: 'cancel', formnovalidate: true }, t('Cancelar')), h('button', { class: 'btn primary', value: 'ok' }, t('Salvar')))));
      dlg.querySelector('form').addEventListener('submit', (e) => {
        if (e.submitter?.value === 'ok' && lhm.checked && !validLhmUrl(lhmUrl.value)) { e.preventDefault(); err.textContent = t('O endereço do LibreHardwareMonitor precisa ser local (http://localhost:porta).'); }
      });
      dlg.addEventListener('close', async () => {
        dlg.remove();
        if (dlg.returnValue !== 'ok') return;
        if (lhm.checked && !(await requestAccess({ origins: [new URL(lhmUrl.value).origin + '/*'] }))) { lhm.checked = false; ctx.toast('Sem a permissão, o LibreHardwareMonitor fica desligado.'); }
        await ctx.saveSettings({ system: sanitizeSys({
          show: Object.fromEntries(Object.entries(show).map(([k, [i]]) => [k, i.checked])),
          unit: unit.value, every: Number(every.value),
          alerts: { notify: notify.checked, cpuTemp: Number(cpuT.value), gpuTemp: Number(gpuT.value), diskFree: Number(disk.value), ram: Number(ram.value) },
          lhm: { on: lhm.checked, url: lhmUrl.value }, usePonte: ponte.checked,
        }) });
        restart();
        ctx.toast('Configurações do Sistema salvas');
      });
      document.body.append(dlg);
      dlg.showModal();
    }

    ctx.onCleanup(() => { stop(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); });
    ponteAllowed().then((ok) => { if (!ok && !cfg().lhm.on) ponteHelpOpen = true; render(); });
    render();
  },
};
