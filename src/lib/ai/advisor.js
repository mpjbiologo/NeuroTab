// NeuroTab — "Qual é a melhor IA para o meu computador?" (0.8.1, #61): o motor de recomendação.
// Puro (sem rede, sem DOM): recebe o hardware e o catálogo e devolve as recomendações. Testado em
// tests/unit/advisor.test.js com perfis de computador.
//
// hw = { ramGB, threads, cpuModel, os: 'windows'|'mac'|'linux'|'', arch, gpuVendor: 'nvidia'|'amd'|'intel'|'apple'|'',
//        gpuName, vramGB, diskFreeGB, appleSilicon }   (qualquer campo pode faltar: null)

export const PURPOSES = {
  chat: { icon: '💬', label: 'Conversa, organizar o cérebro e resumir mídia', tasks: ['chat', 'organize', 'media'] },
  images: { icon: '🖼️', label: 'Imagens (ler texto, descrever, achar endereços)', tasks: ['images'] },
  search: { icon: '🔎', label: 'Busca por significado', tasks: ['search'] },
  commands: { icon: '🎙️', label: 'Comandos de voz (rápido e pequeno)', tasks: ['commands'] },
};

const SPEED = { 'rápido': 3, 'médio': 1.5, 'lento': -1, 'muito lento': -4 };

// ---------- catálogo ----------
const num = (v, min, max) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) < min || Number(v) > max ? null : Number(v));

/** Valida o catálogo (embutido ou baixado do GitHub). Modelos inválidos são descartados. */
export function sanitizeCatalog(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.models)) throw new Error('Catálogo de modelos inválido.');
  const models = raw.models.map((m) => {
    const id = String(m?.id || '').trim();
    if (!/^[a-z0-9][a-z0-9._/-]*(:[a-z0-9._-]+)?$/i.test(id) || id.length > 80) return null;
    const sizeGB = num(m.sizeGB, 0.01, 500);
    const params = num(m.params, 0.01, 2000);
    if (!sizeGB || !params) return null;
    const uses = (Array.isArray(m.uses) ? m.uses : []).filter((u) => PURPOSES[u]);
    if (!uses.length) return null;
    return {
      id, family: String(m.family || id.split(':')[0]).slice(0, 40), params, active: num(m.active, 0.01, 2000), moe: !!m.moe, sizeGB, uses,
      vision: !!m.vision, embed: !!m.embed, ptbr: num(m.ptbr, 1, 3) || 1, quality: num(m.quality, 1, 5) || 1,
      minOllama: /^\d+\.\d+(\.\d+)?$/.test(m.minOllama || '') ? m.minOllama : '', note: String(m.note || '').slice(0, 300),
      replacedBy: m.replacedBy ? String(m.replacedBy).slice(0, 80) : '',
    };
  }).filter(Boolean);
  if (!models.length) throw new Error('Catálogo de modelos vazio.');
  return { version: Number(raw.version) || 0, updated: String(raw.updated || '').slice(0, 10), source: String(raw.source || '').slice(0, 200), models };
}

// ---------- memória ----------
/** Memória que o modelo ocupa rodando (aproximado): pesos + contexto e sobras. */
export const needGB = (m) => Math.round((m.embed ? m.sizeGB * 1.2 + 0.3 : m.sizeGB * 1.15 + 0.8) * 10) / 10;

/** Quanto sobra para a IA: { ramBudget, gpuBudget, gpu, unified, assumptions }. */
export function budget(hw) {
  const assumptions = [];
  let ram = num(hw.ramGB, 0.5, 4096);
  if (ram == null) { ram = 8; assumptions.push('ram'); }
  const reserve = Math.max(3, ram * 0.25); // sistema, navegador e outros programas
  const out = { ram, reserve: Math.round(reserve * 10) / 10, ramBudget: Math.max(0, ram - reserve), gpuBudget: 0, gpu: 'none', unified: false, assumptions };
  if (hw.appleSilicon || (hw.gpuVendor === 'apple')) {
    out.gpu = 'apple';
    out.unified = true;
    out.gpuBudget = Math.max(0, ram * 0.66 - 1); // o macOS deixa cerca de 2/3 da memória para a placa
  } else if (hw.gpuVendor === 'nvidia' || hw.gpuVendor === 'amd') {
    const vram = num(hw.vramGB, 0.25, 512);
    if (vram == null) assumptions.push('vram');
    else { out.gpu = hw.gpuVendor; out.gpuBudget = Math.max(0, vram * 0.9 - 0.4); }
  } else if (hw.gpuVendor === 'intel') {
    assumptions.push('igpu'); // o Ollama não usa as placas integradas da Intel: conta pelo processador
  }
  out.ramBudget = Math.round(out.ramBudget * 10) / 10;
  out.gpuBudget = Math.round(out.gpuBudget * 10) / 10;
  return out;
}

/** Onde o modelo roda: 'gpu' (inteiro na placa), 'mixed' (dividido), 'cpu', 'no' (não cabe) ou 'nodisk'. */
export function placement(m, b, hw = {}) {
  const need = needGB(m);
  const disk = num(hw.diskFreeGB, 0, 1e6);
  if (disk != null && disk < m.sizeGB + 2) return { where: 'nodisk', need };
  if (b.gpuBudget >= need) return { where: 'gpu', need };
  if (b.unified) return { where: need <= b.ramBudget ? 'cpu' : 'no', need };
  if (b.gpuBudget >= 1 && need <= b.gpuBudget + b.ramBudget) return { where: 'mixed', need };
  if (need <= b.ramBudget) return { where: 'cpu', need };
  return { where: 'no', need };
}

/** Velocidade esperada, em palavras (não em números exatos). */
export function speed(m, where, hw = {}) {
  if (where === 'no' || where === 'nodisk') return '';
  if (m.embed) return 'rápido';
  const p = m.active || m.params;
  if (where === 'gpu') return p <= 16 ? 'rápido' : 'médio';
  if (where === 'mixed') return p <= 4 ? 'médio' : 'lento';
  const t = num(hw.threads, 1, 1024) || 4;
  const eff = p / (t >= 12 ? 1.5 : t >= 8 ? 1 : 0.6);
  return eff <= 2.5 ? 'rápido' : eff <= 5 ? 'médio' : eff <= 10 ? 'lento' : 'muito lento';
}

function score(m, purpose, sp, where, installed) {
  const s = SPEED[sp] ?? -9;
  let base;
  if (purpose === 'commands') base = m.quality + m.ptbr + s * 2.5;
  // busca: roda junto com o modelo de conversa, então o menor bom ganha
  else if (purpose === 'search') base = m.quality + m.ptbr * 1.5 - needGB(m) * 0.5;
  else base = m.quality * 2 + m.ptbr * 1.5 + s + (where === 'gpu' ? 1 : where === 'mixed' ? -1 : 0);
  return base + (installed ? 0.5 : 0);
}

const fits = (c) => c.where !== 'no' && c.where !== 'nodisk';
const pick = (list) => list.slice().sort((a, b) => b.score - a.score)[0] || null;

/**
 * Recomenda modelos para o hardware.
 * Devolve { budget, grade, purposes: { chat: { best, lighter, stronger }, … }, all, cloud }.
 * Cada opção: { model, where, need, speed, score, installed }.
 */
export function recommend(catalog, hw = {}, { installed = [] } = {}) {
  const b = budget(hw);
  const inst = new Set(installed.map((n) => String(n).replace(/:latest$/, '')));
  const all = catalog.models.filter((m) => !m.replacedBy).map((m) => {
    const pl = placement(m, b, hw);
    const sp = speed(m, pl.where, hw);
    const installedHere = inst.has(m.id.replace(/:latest$/, ''));
    return { model: m, where: pl.where, need: pl.need, speed: sp, installed: installedHere, score: 0 };
  });
  const purposes = {};
  for (const p of Object.keys(PURPOSES)) {
    const cands = all.filter((c) => c.model.uses.includes(p) && (p !== 'images' || c.model.vision) && (p !== 'search' || c.model.embed) && (p === 'search' || !c.model.embed))
      .map((c) => ({ ...c, score: score(c.model, p, c.speed, c.where, c.installed) }));
    const ok = cands.filter((c) => fits(c) && c.speed !== 'muito lento' && (p !== 'commands' || c.speed === 'rápido' || c.speed === 'médio'));
    const best = pick(ok);
    const lighter = best ? pick(ok.filter((c) => c.need < best.need && c.model.id !== best.model.id)) : null;
    const stronger = best ? cands.filter((c) => fits(c) && c.model.quality > best.model.quality).sort((a, b) => b.model.quality - a.model.quality || b.score - a.score)[0] || null : null;
    purposes[p] = { best, lighter, stronger };
  }
  const c = purposes.chat.best;
  const grade = !c ? 'ruim' : c.model.quality >= 4 && c.speed === 'rápido' ? 'otimo' : c.model.quality >= 3 && (c.speed === 'rápido' || c.speed === 'médio') ? 'bom' : 'limitado';
  return { budget: b, grade, purposes, all, cloud: grade === 'ruim' || grade === 'limitado' };
}

export const GRADES = {
  otimo: { icon: '🟢', label: 'Ótimo para IA local', text: 'Roda modelos bons e rápidos no próprio computador.' },
  bom: { icon: '🟡', label: 'Bom para IA local', text: 'Roda modelos de qualidade boa com velocidade aceitável.' },
  limitado: { icon: '🟠', label: 'Limitado para IA local', text: 'Só modelos pequenos ou lentos. Funciona, mas a IA na internet responde melhor.' },
  ruim: { icon: '🔴', label: 'Não recomendado para IA local', text: 'A memória não comporta nenhum modelo com folga. Prefira uma IA na internet.' },
};

export const WHERE_RUN = {
  gpu: { icon: '🎮', label: 'na placa de vídeo' },
  mixed: { icon: '⚖️', label: 'dividido entre a placa de vídeo e o processador (mais lento)' },
  cpu: { icon: '🧠', label: 'no processador' },
  no: { icon: '⛔', label: 'não cabe na memória' },
  nodisk: { icon: '💾', label: 'falta espaço em disco' },
};

// ---------- dados do computador: detectado × informado ----------
export const HW_FIELDS = ['ramGB', 'threads', 'cpuModel', 'os', 'arch', 'gpuVendor', 'gpuName', 'vramGB', 'diskFreeGB'];

/** Fabricante pela descrição da placa. */
export function gpuVendorOf(name = '') {
  const n = String(name).toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro|tesla/.test(n)) return 'nvidia';
  if (/amd|radeon|ati\b/.test(n)) return 'amd';
  if (/intel|iris|uhd|arc/.test(n)) return 'intel';
  if (/apple|m[1-9]\b/.test(n)) return 'apple';
  return '';
}

const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= Math.max(0.5, Math.abs(a) * 0.1) : String(a).trim().toLowerCase() === String(b).trim().toLowerCase());

/**
 * Junta o detectado ({ campo: { value, src } }) com o informado ({ campo: valor | 'unknown' }).
 * O informado vale, mas divergências com o detectado são listadas para a pessoa confirmar.
 */
export function finalHw(detected = {}, manual = {}) {
  const hw = {};
  const src = {};
  const divergences = [];
  for (const f of HW_FIELDS) {
    const d = detected[f];
    const m = manual[f];
    if (m === 'unknown') { hw[f] = null; src[f] = 'unknown'; continue; }
    if (m !== undefined && m !== null && m !== '') {
      hw[f] = m;
      src[f] = 'manual';
      if (d?.value != null && d.value !== '' && !same(d.value, m)) divergences.push({ field: f, detected: d.value, detectedSrc: d.src, manual: m });
      continue;
    }
    hw[f] = d?.value ?? null;
    src[f] = d?.value != null && d?.value !== '' ? d.src : 'missing';
  }
  hw.appleSilicon = hw.os === 'mac' && /arm|aarch64|apple/i.test(`${hw.arch || ''} ${hw.cpuModel || ''}`);
  if (!hw.gpuVendor && hw.gpuName) hw.gpuVendor = gpuVendorOf(hw.gpuName);
  if (hw.appleSilicon) hw.gpuVendor = 'apple';
  return { hw, src, divergences };
}

/** Do que a Ponte, o navegador e o LibreHardwareMonitor leram (sysinfo.mergeSys) para os campos do recomendador. */
export function fromSys(v, srcOf = {}) {
  const out = {};
  const GB = 1024 ** 3;
  const put = (f, value, src) => { if (value != null && value !== '' && !(typeof value === 'number' && !Number.isFinite(value))) out[f] = { value, src }; };
  if (!v) return out;
  const main = v.sources.includes('ponte') ? 'ponte' : v.sources.includes('browser') ? 'browser' : v.sources[0];
  if (v.mem?.total) put('ramGB', Math.round((v.mem.total / GB) * 10) / 10, srcOf.mem || main);
  if (v.cpu?.cores) put('threads', v.cpu.cores, srcOf.cpu || main);
  put('cpuModel', v.cpu?.model || '', srcOf.cpu || main);
  if (v.os) put('os', v.os === 'darwin' ? 'mac' : v.os, 'ponte');
  const g = (v.gpus || []).slice().sort((a, b) => (b.memTotal || 0) - (a.memTotal || 0))[0];
  if (g) {
    put('gpuName', g.name, g.source === 'LibreHardwareMonitor' ? 'lhm' : 'ponte');
    put('gpuVendor', gpuVendorOf(g.name), g.source === 'LibreHardwareMonitor' ? 'lhm' : 'ponte');
    if (g.memTotal) put('vramGB', Math.round((g.memTotal / GB) * 10) / 10, g.source === 'LibreHardwareMonitor' ? 'lhm' : 'ponte');
  }
  const sys = (v.disks || []).find((d) => /^[a-z]:\\?$/i.test(d.mount) && /^c/i.test(d.mount)) || (v.disks || []).find((d) => d.mount === '/' || d.mount === '/System/Volumes/Data') || (v.disks || [])[0];
  if (sys?.free) put('diskFreeGB', Math.round(sys.free / GB), 'ponte');
  return out;
}
