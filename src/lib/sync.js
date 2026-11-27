// NeuroTab — sincronização entre aparelhos (#27), pela conta Google (pasta oculta do app no Drive).
// Cada categoria (cérebro, atalhos, configurações, agenda, hábitos) vira um arquivo com registros
// { id: { h: impressão, t: quando mudou, v: valor, d: excluído } }, cifrado com a senha (ou legível, sem senha).
// Mescla de 3 vias por registro, contra o que foi sincronizado da última vez (a "base"):
//   só um lado mudou → vale esse lado (inclusive exclusão); os dois mudaram → vale o mais recente e,
//   no cérebro, a outra versão fica como "cópia em conflito"; excluído de um lado e editado do outro → fica o editado.
import { seal, open, digest, deriveKey, newSalt, WrongKeyError } from './sync-crypto.js';
import { authFetch } from './accounts.js';
import { BRAIN_KEY, TRASH_KEY, DATA_KEY } from './store.js';

export const SYNC_KEY = 'nt_sync'; // configuração e situação
export const SYNC_SECRET_KEY = 'nt_sync_key'; // chave derivada da senha (só neste navegador)
export const SYNC_STATE_KEY = 'nt_sync_state'; // base da mescla e versões dos arquivos
export const META_FILE = 'nt-sync-meta.json';
export const CATEGORIES = ['brain', 'shortcuts', 'settings', 'agenda', 'habits'];
const TOMBSTONE_DAYS = 60;
const CHECK = 'neurotab-sync-ok';

const store = () => chrome.storage.local;
const get = async (k) => (await store().get(k))[k];

// ---------- Categorias: ler e gravar como mapas de registros ----------
const SECRET_SETTINGS = new Set(['keys']); // dentro de settings.ai: chaves de API nunca saem pela sincronização

export const ADAPTERS = {
  brain: {
    keys: [BRAIN_KEY, TRASH_KEY],
    async read() {
      const r = await store().get([BRAIN_KEY, TRASH_KEY]);
      const out = {};
      for (const it of r[BRAIN_KEY] || []) out[it.id] = it;
      for (const it of r[TRASH_KEY] || []) out[it.id] = { ...it, _trash: true };
      return out;
    },
    async write(map) {
      const items = [];
      const trash = [];
      for (const v of Object.values(map)) {
        const { _trash, ...it } = v;
        (_trash ? trash : items).push(it);
      }
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      await store().set({ [BRAIN_KEY]: items, [TRASH_KEY]: trash });
    },
    stamp: (v) => v.updatedAt || v.deletedAt || v.createdAt || 0,
    conflictCopy: (v) => ({ ...v, id: `${v.id}-c${Date.now().toString(36)}`, title: `⚠️ ${v.title || ''}`.trim(), conflict: true }),
  },
  shortcuts: {
    keys: [DATA_KEY],
    async read() {
      const d = (await get(DATA_KEY)) || {};
      const out = {};
      (d.groups || []).forEach((g, i) => { out[`g:${g.id}`] = { ...g, _i: i }; });
      (d.links || []).forEach((l, i) => { out[`l:${l.id}`] = { ...l, _i: i }; });
      return out;
    },
    async write(map) {
      const d = (await get(DATA_KEY)) || {};
      const pick = (p) => Object.entries(map).filter(([k]) => k.startsWith(p)).map(([, v]) => v).sort((a, b) => (a._i ?? 0) - (b._i ?? 0)).map(({ _i, ...x }) => x);
      const groups = pick('g:');
      d.groups = groups.length ? groups : d.groups; // nunca deixa sem grupos
      d.links = pick('l:');
      await store().set({ [DATA_KEY]: d });
    },
  },
  settings: {
    keys: [DATA_KEY],
    async read() {
      const s = ((await get(DATA_KEY)) || {}).settings || {};
      const out = {};
      for (const [k, v] of Object.entries(s)) {
        if (k === 'ai' && v && typeof v === 'object') out.ai = Object.fromEntries(Object.entries(v).filter(([kk]) => !SECRET_SETTINGS.has(kk)));
        else out[k] = { value: v };
      }
      return out;
    },
    async write(map) {
      const d = (await get(DATA_KEY)) || {};
      const s = d.settings || {};
      const next = {};
      for (const [k, v] of Object.entries(map)) next[k] = k === 'ai' ? { ...v, keys: s.ai?.keys || {} } : v.value;
      if (!next.ai && s.ai) next.ai = s.ai;
      d.settings = next;
      await store().set({ [DATA_KEY]: d });
    },
  },
  agenda: {
    keys: ['nt_calendar'],
    async read() {
      const c = (await get('nt_calendar')) || {};
      const out = {};
      // a situação de cada agenda (última atualização, erro, quantos) é deste aparelho: não sincroniza
      for (const cal of c.calendars || []) { const { lastSync, error, count, ...rest } = cal; out[`c:${cal.id}`] = rest; }
      for (const e of c.events || []) out[`e:${e.id}`] = e;
      return out;
    },
    async write(map) {
      const here = new Map((((await get('nt_calendar')) || {}).calendars || []).map((c) => [c.id, c]));
      const keep = (c) => { const h = here.get(c.id); return h ? { ...c, ...Object.fromEntries(['lastSync', 'error', 'count'].filter((k) => k in h).map((k) => [k, h[k]])) } : c; };
      const calendars = Object.entries(map).filter(([k]) => k.startsWith('c:')).map(([, v]) => keep(v));
      const events = Object.entries(map).filter(([k]) => k.startsWith('e:')).map(([, v]) => v);
      await store().set({ nt_calendar: { calendars, events } });
    },
    stamp: (v) => v.updatedAt || v.createdAt || 0,
  },
  habits: {
    keys: ['nt_habits'],
    async read() {
      const h = (await get('nt_habits')) || {};
      const out = {};
      (h.habits || []).forEach((x, i) => { out[`h:${x.id}`] = { ...x, _i: i }; });
      for (const [day, v] of Object.entries(h.log || {})) out[`d:${day}`] = v;
      return out;
    },
    async write(map) {
      const habits = Object.entries(map).filter(([k]) => k.startsWith('h:')).map(([, v]) => v).sort((a, b) => (a._i ?? 0) - (b._i ?? 0)).map(({ _i, ...x }) => x);
      const log = Object.fromEntries(Object.entries(map).filter(([k]) => k.startsWith('d:')).map(([k, v]) => [k.slice(2), v]));
      await store().set({ nt_habits: { habits, log } });
    },
  },
};

/** Todas as chaves de armazenamento que a sincronização observa. */
export const WATCHED_KEYS = [...new Set(Object.values(ADAPTERS).flatMap((a) => a.keys))];

// ---------- Mescla ----------
/**
 * local: { id: valor }, remote: { id: { h, t, v, d } }, base: { id: impressão }.
 * Devolve { local (novo mapa), remote (novos registros), base, changedLocal, changedRemote, conflicts }.
 */
export async function merge(cat, local, remote, base, now = Date.now()) {
  const ad = ADAPTERS[cat] || {};
  const stamp = ad.stamp || (() => 0);
  const lh = {};
  for (const [id, v] of Object.entries(local)) lh[id] = await digest(v);
  const outL = {};
  const outR = {};
  const outB = {};
  let changedLocal = false;
  let changedRemote = false;
  let conflicts = 0;
  const ids = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base || {})]);
  const keepLocal = (id) => { outL[id] = local[id]; outR[id] = { h: lh[id], t: remote[id]?.h === lh[id] ? remote[id].t : (stamp(local[id]) || now), v: local[id] }; outB[id] = lh[id]; };
  const takeRemote = (id) => { outL[id] = remote[id].v; outR[id] = remote[id]; outB[id] = remote[id].h; };
  for (const id of ids) {
    const L = lh[id] ?? null;
    const r = remote[id];
    const R = r && !r.d ? r.h : null;
    const B = base?.[id] ?? null;
    if (L === R) {
      if (L) keepLocal(id);
      else if (r?.d) outR[id] = r; // excluído dos dois lados: mantém a marca
      continue;
    }
    if (L === B) {
      // só o remoto mudou
      if (R) { takeRemote(id); changedLocal = true; } else { if (r) outR[id] = r; changedLocal = changedLocal || !!L; }
      continue;
    }
    if (R === B) {
      // só o local mudou
      if (L) keepLocal(id);
      else outR[id] = { d: 1, t: now };
      changedRemote = true;
      continue;
    }
    // os dois mudaram
    if (!L) { takeRemote(id); changedLocal = true; continue; } // excluído aqui, editado lá: fica o editado
    if (!R) { keepLocal(id); changedRemote = true; continue; } // editado aqui, excluído lá: fica o editado
    conflicts++;
    // Com data de alteração (notas, eventos): vale a mais recente. Sem data (configurações, atalhos):
    // no primeiro contato vale a nuvem (o aparelho que chega adota o que já existe); depois, vale este aparelho.
    const localWins = ad.stamp ? (stamp(local[id]) || now) >= (r.t || 0) : B !== null;
    const winner = localWins ? local[id] : r.v;
    const loser = localWins ? r.v : local[id];
    const wh = localWins ? lh[id] : r.h;
    outL[id] = winner;
    outR[id] = { h: wh, t: Math.max(stamp(winner) || 0, r.t || 0, now), v: winner };
    outB[id] = wh;
    if (ad.conflictCopy && JSON.stringify(loser.text ?? '') !== JSON.stringify(winner.text ?? '')) {
      const copy = ad.conflictCopy(loser);
      const ch = await digest(copy);
      outL[copy.id] = copy;
      outR[copy.id] = { h: ch, t: now, v: copy };
      outB[copy.id] = ch;
    }
    changedLocal = true;
    changedRemote = true;
  }
  // marcas de exclusão antigas saem do arquivo
  for (const [id, r] of Object.entries(outR)) if (r.d && now - (r.t || 0) > TOMBSTONE_DAYS * 864e5) { delete outR[id]; changedRemote = true; }
  return { local: outL, remote: outR, base: outB, changedLocal, changedRemote, conflicts };
}

// ---------- Google Drive (pasta oculta do app) ----------
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export function driveStore(accountId, { fetchFn = fetch, interactive = false } = {}) {
  const call = async (url, opts = {}) => {
    const res = await authFetch(accountId, 'sync', url, opts, { fetchFn, interactive });
    if (res.status === 403) throw Object.assign(new Error('O Google recusou o acesso ao Drive. Reconecte a conta.'), { code: 'forbidden' });
    if (res.status === 429 || res.status >= 500) throw Object.assign(new Error('O Google Drive está ocupado. A NeuroTab tenta de novo em alguns minutos.'), { code: 'busy' });
    if (!res.ok && res.status !== 404) throw new Error(`Google Drive: erro ${res.status}.`);
    return res;
  };
  return {
    async list() {
      const res = await call(`${DRIVE}/files?spaces=appDataFolder&pageSize=1000&fields=files(id,name,version,modifiedTime,size)`);
      return (await res.json()).files || [];
    },
    async read(id) {
      const res = await call(`${DRIVE}/files/${id}?alt=media`);
      if (res.status === 404) return null;
      return res.json();
    },
    async version(id) {
      const res = await call(`${DRIVE}/files/${id}?fields=version`);
      return res.status === 404 ? null : (await res.json()).version;
    },
    async create(name, obj) {
      const boundary = 'nt' + Math.random().toString(36).slice(2);
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
      const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      return res.json();
    },
    async update(id, obj) {
      const res = await call(`${UPLOAD}/files/${id}?uploadType=media&fields=id,version`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
      return res.json();
    },
    async remove(id) { await call(`${DRIVE}/files/${id}`, { method: 'DELETE' }); },
    /** Arquivo binário (mídias, 0.9.3.2): bytes já cifrados quando há chave. */
    async createBytes(name, bytes) {
      const boundary = 'nt' + Math.random().toString(36).slice(2);
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
      const body = new Blob([head, bytes, `\r\n--${boundary}--`]);
      const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      return res.json();
    },
    async readBytes(id) {
      const res = await call(`${DRIVE}/files/${id}?alt=media`);
      if (res.status === 404) return null;
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

// ---------- Configuração ----------
export async function syncConfig() { return (await get(SYNC_KEY)) || { enabled: false }; }
async function setConfig(patch) { const c = { ...(await syncConfig()), ...patch }; await store().set({ [SYNC_KEY]: c }); return c; }
export const updateSyncConfig = setConfig;

/** O que já existe na nuvem desta conta: { exists, mode ('key'|'none'), createdAt } — para o 2º aparelho. */
export async function remoteInfo(accountId, opts = {}) {
  const drive = driveStore(accountId, opts);
  const meta = (await drive.list()).find((f) => f.name === META_FILE);
  if (!meta) return { exists: false };
  const m = await drive.read(meta.id);
  return { exists: true, mode: m?.mode || 'none', createdAt: m?.createdAt || 0 };
}

/**
 * Liga a sincronização. Se a nuvem já tem dados (outro aparelho), confere a senha; senão, cria.
 * mode: 'key' (com senha) ou 'none' (sem senha).
 */
export async function enableSync({ accountId, mode, passphrase = '', categories = CATEGORIES, fetchFn, interactive = true }) {
  const drive = driveStore(accountId, { fetchFn, interactive });
  const files = await drive.list();
  const metaFile = files.find((f) => f.name === META_FILE);
  let key = '';
  if (metaFile) {
    const meta = await drive.read(metaFile.id);
    if (meta.mode === 'key') {
      if (!passphrase) throw Object.assign(new Error('Esta conta já tem dados sincronizados com senha. Digite a senha de sincronização.'), { code: 'need_pass' });
      key = await deriveKey(passphrase, meta.salt, meta.iterations);
      try { if ((await open(meta.check, key)) !== CHECK) throw new WrongKeyError(); } catch { throw new WrongKeyError(); }
    }
    mode = meta.mode;
  } else {
    if (mode === 'key') {
      if (!passphrase || passphrase.length < 8) throw new Error('A senha de sincronização precisa ter pelo menos 8 caracteres.');
      const salt = newSalt();
      key = await deriveKey(passphrase, salt);
      await drive.create(META_FILE, { schema: 1, mode: 'key', salt, iterations: 600_000, check: await seal(CHECK, key), createdAt: Date.now() });
    } else {
      await drive.create(META_FILE, { schema: 1, mode: 'none', createdAt: Date.now() });
    }
  }
  await store().set({ [SYNC_SECRET_KEY]: key, [SYNC_STATE_KEY]: {} });
  const deviceId = (await syncConfig()).deviceId || crypto.randomUUID();
  await setConfig({ enabled: true, paused: false, accountId, mode, categories: categories.filter((c) => CATEGORIES.includes(c)), deviceId, lastError: '' });
  return syncNow({ fetchFn, interactive });
}

/** Desliga a sincronização neste aparelho (os dados locais e os da nuvem ficam). */
export async function disableSync() {
  await store().remove([SYNC_SECRET_KEY, SYNC_STATE_KEY]);
  await setConfig({ enabled: false, paused: false, lastError: '' });
}

/** Apaga tudo o que a NeuroTab guardou na nuvem desta conta (e desliga aqui). */
export async function wipeRemote({ fetchFn } = {}) {
  const c = await syncConfig();
  if (!c.accountId) return 0;
  const drive = driveStore(c.accountId, { fetchFn, interactive: true });
  const files = await drive.list();
  for (const f of files) await drive.remove(f.id);
  await disableSync();
  return files.length;
}

// ---------- Sincronizar ----------
let running = null;

/** Sincroniza agora (uma por vez). Devolve { up, down, conflicts, skipped } e grava a situação. */
export function syncNow(opts = {}) {
  if (running) return running;
  const job = (navigator.locks ? navigator.locks.request('nt-sync', () => runSync(opts)) : runSync(opts));
  running = job.finally(() => { running = null; });
  return running;
}

async function runSync({ fetchFn, interactive = false } = {}) {
  const c = await syncConfig();
  if (!c.enabled || c.paused) return { skipped: true };
  const key = (await get(SYNC_SECRET_KEY)) || '';
  if (c.mode === 'key' && !key) {
    await setConfig({ lastError: 'Falta a senha de sincronização neste aparelho. Ligue a sincronização de novo.' });
    return { skipped: true };
  }
  const drive = driveStore(c.accountId, { fetchFn, interactive });
  const result = { up: 0, down: 0, conflicts: 0 };
  try {
    const state = (await get(SYNC_STATE_KEY)) || {};
    state.base ||= {};
    state.versions ||= {};
    state.fileIds ||= {};
    let files = await drive.list();
    for (const cat of c.categories || CATEGORIES) {
      const name = `nt-${cat}.json`;
      for (let attempt = 0; attempt < 3; attempt++) {
        const file = files.find((f) => f.name === name);
        let local = await ADAPTERS[cat].read();
        // Aparelho chegando: grupos vazios daqui (o "Principal" de toda instalação nova) não duplicam os da nuvem.
        if (cat === 'shortcuts' && file && !state.base.shortcuts) {
          const used = new Set(Object.entries(local).filter(([k]) => k.startsWith('l:')).map(([, v]) => v.groupId));
          local = Object.fromEntries(Object.entries(local).filter(([k, v]) => !k.startsWith('g:') || used.has(v.id)));
        }
        // nada mudou aqui nem lá desde a última vez: pula
        if (file && state.versions[cat] === file.version) {
          const same = await sameAsBase(local, state.base[cat] || {});
          if (same) break;
        }
        const env = file ? await drive.read(file.id) : null;
        const remote = env ? (await open(env, key)).records || {} : {};
        const m = await merge(cat, local, remote, state.base[cat] || {});
        if (m.changedRemote || !file) {
          const sealed = await seal({ schema: 1, cat, records: m.remote, by: c.deviceId, at: Date.now() }, key);
          if (file) {
            const v = await drive.version(file.id);
            if (v && v !== file.version) { files = await drive.list(); continue; } // outro aparelho gravou no meio: refaz
            const up = await drive.update(file.id, sealed);
            state.versions[cat] = up.version;
          } else {
            const created = await drive.create(name, sealed);
            state.versions[cat] = created.version;
            files = [...files, { id: created.id, name, version: created.version }];
          }
          result.up++;
        } else state.versions[cat] = file.version;
        if (m.changedLocal) { await ADAPTERS[cat].write(m.local); result.down++; }
        result.conflicts += m.conflicts;
        state.base[cat] = m.base;
        break;
      }
    }
    await store().set({ [SYNC_STATE_KEY]: state });
    await setConfig({ lastSync: Date.now(), lastError: '', lastResult: result });
    return result;
  } catch (e) {
    const msg = e instanceof WrongKeyError ? 'A senha de sincronização mudou em outro aparelho. Ligue a sincronização de novo com a senha nova.' : e.message;
    await setConfig({ lastError: msg, lastErrorCode: e.code || '' });
    throw e;
  }
}

async function sameAsBase(local, base) {
  const ids = Object.keys(local);
  if (ids.length !== Object.keys(base).length) return false;
  for (const id of ids) if (base[id] !== await digest(local[id])) return false;
  return true;
}
