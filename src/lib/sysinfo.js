// NeuroTab — widget Sistema (0.7.10): junta as leituras da NeuroTab Ponte, do LibreHardwareMonitor (temperaturas no
// Windows) e do próprio navegador (chrome.system.cpu/memory, Chrome e Edge) num só formato, e decide os alertas.
// Funções puras no topo (tests/unit/sysinfo.test.js); as leituras do navegador e do LHM no fim.

export const DEFAULT_SYS = {
  show: { cpu: true, gpu: true, ram: true, disks: true, battery: true, procs: true, charts: true },
  unit: 'C', // C | F
  every: 2, // segundos entre leituras (só com o widget na tela)
  alerts: { notify: true, cpuTemp: 90, gpuTemp: 85, diskFree: 10, ram: 90 },
  lhm: { on: false, url: 'http://localhost:8085' },
  usePonte: true,
};

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const num = (v, a, b, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? clamp(Number(v), a, b) : d);

export function validLhmUrl(u) {
  try { const x = new URL(String(u || '').trim()); return x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname) && !x.search; } catch { return false; }
}

export function sanitizeSys(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const show = { ...DEFAULT_SYS.show };
  for (const k of Object.keys(show)) if (r.show && k in r.show) show[k] = !!r.show[k];
  const a = r.alerts && typeof r.alerts === 'object' ? r.alerts : {};
  return {
    show,
    unit: r.unit === 'F' ? 'F' : 'C',
    every: num(r.every, 1, 10, 2),
    alerts: {
      notify: a.notify === undefined ? true : !!a.notify,
      cpuTemp: num(a.cpuTemp, 50, 110, 90),
      gpuTemp: num(a.gpuTemp, 50, 110, 85),
      diskFree: num(a.diskFree, 1, 50, 10),
      ram: num(a.ram, 50, 99, 90),
    },
    lhm: { on: !!r.lhm?.on, url: validLhmUrl(r.lhm?.url) ? r.lhm.url.trim().replace(/\/+$/, '') : DEFAULT_SYS.lhm.url },
    usePonte: r.usePonte === undefined ? true : !!r.usePonte,
  };
}

// ---------- formatação ----------
export function fmtBytes(b, digits = 1) {
  if (!Number.isFinite(b) || b < 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(digits).replace('.', ',')} ${u[i]}`;
}
export const fmtTemp = (c, unit = 'C') => (Number.isFinite(c) ? (unit === 'F' ? `${Math.round(c * 9 / 5 + 32)} °F` : `${Math.round(c)} °C`) : '—');
export const fmtPct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—');
export function fmtUptime(s) {
  if (!Number.isFinite(s) || s <= 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

// ---------- LibreHardwareMonitor (servidor web, data.json) ----------
/** "45,3 °C", "12.5 %", "3.1 GB", "2048 MB" → número na unidade dada (GB e MB viram bytes). */
export function lhmValue(text) {
  const m = String(text || '').match(/(-?[\d.,]+)\s*([^\d\s]*)/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.')); // o LHM formata com uma casa decimal, no idioma do sistema (sem milhar)
  if (!Number.isFinite(v)) return null;
  const unit = m[2] || '';
  if (/^GB$/i.test(unit)) return v * 1024 ** 3;
  if (/^MB$/i.test(unit)) return v * 1024 ** 2;
  if (/^KB$/i.test(unit)) return v * 1024;
  return v;
}

function hwKind(node) {
  const id = String(node.HardwareId || node.SensorId || '').toLowerCase();
  const img = String(node.ImageURL || '').toLowerCase();
  if (/cpu/.test(id) || /cpu\.png/.test(img)) return 'cpu';
  if (/gpu/.test(id) || /(nvidia|ati|amd|intel)\.png/.test(img)) return 'gpu';
  if (/^\/ram|memory/.test(id) || /ram\.png/.test(img)) return 'mem';
  if (/nvme|hdd|ssd|storage/.test(id) || /hdd\.png/.test(img)) return 'disk';
  if (/battery/.test(id) || /battery\.png/.test(img)) return 'battery';
  return 'other';
}

/** Lê a árvore do LHM: hardware → grupos (Temperatures, Load, Data…) → sensores. */
export function parseLhm(root) {
  const out = { cpu: null, gpus: [], mem: null, disks: [], temps: [] };
  const hardware = [];
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object') return;
    const kids = Array.isArray(n.Children) ? n.Children : [];
    const isHw = (n.ImageURL && !/transparent/.test(n.ImageURL) && kids.some((k) => Array.isArray(k.Children) && k.Children.some((s) => 'Value' in s))) || n.HardwareId;
    if (isHw && depth >= 1) hardware.push(n);
    for (const k of kids) walk(k, depth + 1);
  };
  walk(root, 0);
  for (const hw of hardware) {
    const kind = hwKind(hw);
    const sensors = [];
    for (const g of hw.Children || []) for (const s of g.Children || []) if ('Value' in s) sensors.push({ group: String(g.Text || ''), name: String(s.Text || ''), type: String(s.Type || g.Text || ''), value: lhmValue(s.Value) });
    const find = (group, re) => sensors.find((s) => new RegExp(group, 'i').test(s.group) && re.test(s.name) && Number.isFinite(s.value));
    const temps = sensors.filter((s) => /temperature/i.test(s.group) && Number.isFinite(s.value) && s.value > 0 && s.value < 150);
    for (const t of temps) out.temps.push({ label: `${hw.Text} ${t.name}`, kind: kind === 'mem' ? 'other' : kind, c: t.value });
    if (kind === 'cpu') {
      const pkg = temps.find((t) => /package|tctl|tdie|core \(tctl/i.test(t.name)) || temps.reduce((a, b) => (!a || b.value > a.value ? b : a), null);
      out.cpu = { model: hw.Text, usage: find('load', /total/i)?.value ?? null, temp: pkg?.value ?? null };
    } else if (kind === 'gpu') {
      out.gpus.push({
        name: hw.Text,
        usage: find('load', /core/i)?.value ?? null,
        temp: (temps.find((t) => /core|edge|gpu/i.test(t.name)) || temps[0])?.value ?? null,
        memUsed: find('data|smalldata', /memory used/i)?.value ?? null,
        memTotal: find('data|smalldata', /memory total/i)?.value ?? null,
        source: 'LibreHardwareMonitor',
      });
    } else if (kind === 'mem') {
      const used = find('data', /^memory used$/i)?.value;
      const avail = find('data', /^memory available$/i)?.value;
      if (Number.isFinite(used) && Number.isFinite(avail)) out.mem = { total: used + avail, available: avail };
    } else if (kind === 'disk') {
      out.disks.push({ name: hw.Text, temp: temps[0]?.value ?? null, usedPct: find('load', /used space/i)?.value ?? null });
    }
  }
  return out;
}

// ---------- junção ----------
/**
 * Um só modelo para o widget. Prioridade: Ponte (tudo) > LHM (temperaturas, GPU) > navegador (CPU e RAM).
 * sources: { ponte, lhm, browser } (cada um pode faltar).
 */
export function mergeSys({ ponte, lhm, browser } = {}) {
  const v = { at: Date.now(), cpu: {}, mem: null, disks: [], gpus: [], temps: [], battery: null, procs: [], uptime: null, os: '', host: '', notes: [], sources: [] };
  if (browser) {
    v.sources.push('browser');
    v.cpu = { model: browser.cpu?.model || '', cores: browser.cpu?.cores || 0, usage: browser.cpu?.usage ?? null, temp: browser.cpu?.temp ?? null };
    if (browser.mem) v.mem = browser.mem;
  }
  if (lhm) {
    v.sources.push('lhm');
    if (lhm.cpu) v.cpu = { ...v.cpu, model: v.cpu.model || lhm.cpu.model, usage: v.cpu.usage ?? lhm.cpu.usage, temp: lhm.cpu.temp ?? v.cpu.temp };
    if (lhm.mem && !v.mem) v.mem = lhm.mem;
    v.gpus = lhm.gpus;
    v.temps = lhm.temps;
  }
  if (ponte) {
    v.sources.push('ponte');
    const p = ponte;
    v.os = p.os || '';
    v.host = p.host || '';
    v.uptime = p.uptime ?? null;
    v.cpu = { model: p.cpu?.model || v.cpu.model, cores: p.cpu?.cores || v.cpu.cores, usage: p.cpu?.usage ?? v.cpu.usage, perCore: p.cpu?.perCore || [], mhz: p.cpu?.mhz || 0, temp: p.cpu?.temp ?? v.cpu.temp ?? null };
    if (p.mem) v.mem = p.mem;
    v.disks = (p.disks || []).map((d) => ({ ...d }));
    // GPU: a da Ponte (nvidia-smi/amdgpu) e, do LHM, as que a Ponte não viu (ex.: AMD/Intel no Windows)
    const pg = p.gpus || [];
    v.gpus = [...pg, ...v.gpus.filter((g) => !pg.some((x) => x.name === g.name))].map((g) => {
      const l = lhm?.gpus?.find((x) => x.name === g.name);
      return l ? { ...l, ...Object.fromEntries(Object.entries(g).filter(([, x]) => x !== null && x !== undefined)) } : g;
    });
    v.temps = [...(p.temps || []), ...v.temps.filter((t) => !(p.temps || []).some((x) => x.label === t.label))];
    v.battery = p.battery || null;
    v.procs = p.procs || [];
    v.notes = p.notes || [];
  }
  // discos: temperatura dos SSDs do LHM, quando o nome bate
  if (lhm?.disks?.length && v.disks.length === 1 && lhm.disks.length === 1 && v.disks[0].temp == null) v.disks[0].temp = lhm.disks[0].temp;
  if (!Number.isFinite(v.cpu.temp)) v.cpu.temp = null;
  return v;
}

export const memUsedPct = (m) => (m?.total ? ((m.total - m.available) / m.total) * 100 : null);
export const diskFreePct = (d) => (d?.total ? (d.free / d.total) * 100 : null);

// ---------- alertas ----------
/**
 * Alertas a disparar agora. state guarda desde quando a RAM está alta (para "por algum tempo") e não muda nada fora daqui.
 * Devolve [{ id, title, body }].
 */
export function evalAlerts(v, cfg, state = {}, now = Date.now()) {
  const a = sanitizeSys(cfg).alerts;
  const unit = sanitizeSys(cfg).unit;
  const out = [];
  if (Number.isFinite(v.cpu?.temp) && v.cpu.temp >= a.cpuTemp) out.push({ id: 'cpuTemp', title: 'Processador quente', body: `${fmtTemp(v.cpu.temp, unit)} (limite ${fmtTemp(a.cpuTemp, unit)}).` });
  for (const g of v.gpus || []) if (Number.isFinite(g.temp) && g.temp >= a.gpuTemp) { out.push({ id: 'gpuTemp', title: 'Placa de vídeo quente', body: `${g.name}: ${fmtTemp(g.temp, unit)} (limite ${fmtTemp(a.gpuTemp, unit)}).` }); break; }
  for (const d of v.disks || []) {
    const f = diskFreePct(d);
    if (Number.isFinite(f) && f < a.diskFree) out.push({ id: 'disk:' + d.mount, title: `Disco ${d.label ? d.label + ' (' + d.mount + ')' : d.mount} quase cheio`, body: `Só ${fmtBytes(d.free)} livres (${Math.round(f)}%).` });
  }
  const ram = memUsedPct(v.mem);
  if (Number.isFinite(ram) && ram >= a.ram) {
    state.ramSince ??= now;
    if (now - state.ramSince >= 60e3) out.push({ id: 'ram', title: 'Memória quase cheia', body: `${Math.round(ram)}% em uso há mais de 1 minuto.` });
  } else state.ramSince = null;
  return out;
}

// ---------- leituras ----------
/** CPU e RAM pelo navegador (Chrome/Edge com as permissões opcionais system.cpu e system.memory). */
export async function readBrowser(prev) {
  const sys = globalThis.chrome?.system;
  if (!sys?.cpu || !sys?.memory) return null;
  const has = await chrome.permissions.contains({ permissions: ['system.cpu', 'system.memory'] }).catch(() => false);
  if (!has) return null;
  const [cpu, mem] = await Promise.all([sys.cpu.getInfo(), sys.memory.getInfo()]);
  const tot = cpu.processors.reduce((a, p) => ({ total: a.total + p.usage.total, idle: a.idle + p.usage.idle }), { total: 0, idle: 0 });
  let usage = null;
  if (prev?.raw && tot.total > prev.raw.total) usage = Math.max(0, Math.min(100, (1 - (tot.idle - prev.raw.idle) / (tot.total - prev.raw.total)) * 100));
  const temps = (cpu.temperatures || []).filter(Number.isFinite);
  return { raw: tot, cpu: { model: cpu.modelName, cores: cpu.numOfProcessors, usage, temp: temps.length ? Math.max(...temps) : null }, mem: { total: mem.capacity, available: mem.availableCapacity } };
}

/** Sensores do LibreHardwareMonitor (servidor web ligado no LHM). */
export async function readLhm(url, { fetchFn = fetch, timeout = 2500 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetchFn(`${url.replace(/\/+$/, '')}/data.json`, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error('O LibreHardwareMonitor respondeu ' + r.status);
    return parseLhm(await r.json());
  } finally {
    clearTimeout(t);
  }
}
