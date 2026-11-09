// NeuroTab — migrações versionadas dos dados locais.
//
// Onde ficam os dados (ver docs/dev/ARMAZENAMENTO.md):
//   chrome.storage.local → nt_data (atalhos, grupos, configurações), nt_brain (notas/tarefas), nt_trash,
//                          nt_bg, relógio/hábitos/foco e caches. Versão em nt_meta.schema.
//   IndexedDB "neurotab" → photos, vectors, captures. Versão do banco em lib/idb.js (onupgradeneeded).
//
// Regras das migrações:
//   - Cada passo é uma função PURA (estado → estado), testável sem navegador.
//   - Cada passo é idempotente: rodar de novo não muda o resultado.
//   - Tudo é gravado de uma vez no fim. Se algum passo falhar, nada é gravado e o erro fica em nt_meta.lastError.
//   - Antes de gravar, uma cópia do estado anterior é guardada em nt_migration_backup (só a última).

export const META_KEY = 'nt_meta';
export const MIGRATION_BACKUP_KEY = 'nt_migration_backup';
export const MIGRATED_KEYS = ['nt_data', 'nt_brain', 'nt_trash'];

const ITEM_TYPES = new Set(['note', 'task', 'idea', 'page', 'clip']); // mesmos de TYPES em brain.js

/** Garante os campos obrigatórios de um item do cérebro. Devolve null se não houver como aproveitar. */
export function normalizeItem(it, now = Date.now()) {
  if (!it || typeof it !== 'object') return null;
  const text = typeof it.text === 'string' ? it.text : it.text == null ? '' : String(it.text);
  const title = typeof it.title === 'string' ? it.title : '';
  if (!text && !title && !it.url) return null;
  const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
  const createdAt = num(it.createdAt) || num(it.updatedAt) || now;
  return {
    ...it,
    id: String(it.id ?? `m${createdAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`),
    type: ITEM_TYPES.has(it.type) ? it.type : 'note',
    title,
    text,
    tags: Array.isArray(it.tags) ? it.tags.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [],
    createdAt,
    updatedAt: num(it.updatedAt) || createdAt,
    remindAt: num(it.remindAt),
    done: !!it.done,
  };
}

export function normalizeItems(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const it = normalizeItem(raw, now);
    if (!it) continue;
    if (seen.has(it.id)) it.id = `${it.id}-${out.length}`;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

// ---------- Passos ----------
// Cada passo recebe { nt_data, nt_brain, nt_trash } (podem estar ausentes) e devolve o novo estado.
export const MIGRATIONS = [
  {
    to: 2,
    name: 'Itens do cérebro com campos obrigatórios (tags, tipo, datas) e configurações antigas',
    up(state) {
      const s = { ...state };
      if (s.nt_brain !== undefined) s.nt_brain = normalizeItems(s.nt_brain);
      if (s.nt_trash !== undefined) s.nt_trash = normalizeItems(s.nt_trash).map((it) => ({ ...it, deletedAt: +it.deletedAt || it.updatedAt }));
      if (s.nt_data?.settings) {
        const st = { ...s.nt_data.settings };
        // Clima antigo (v0.3) → lista de lugares (v0.4)
        if ((!Array.isArray(st.places) || !st.places.length) && st.weather?.lat != null) {
          st.places = [{ id: 'home', name: st.weather.name || '', region: st.weather.region || '', lat: st.weather.lat, lon: st.weather.lon, tz: null }];
        }
        delete st.weather;
        // Widgets com tamanho antigo (s/m/l) → largura em colunas
        const SIZE = { s: 4, m: 6, l: 12 };
        if (Array.isArray(st.widgets)) {
          st.widgets = st.widgets.filter((w) => w && w.id).map((w) => {
            const o = { ...w };
            if (!o.w && o.size) o.w = SIZE[o.size] || 6;
            delete o.size;
            return o;
          });
        }
        s.nt_data = { ...s.nt_data, settings: st };
      }
      return s;
    },
  },
];

export const CURRENT_SCHEMA = MIGRATIONS.reduce((v, m) => Math.max(v, m.to), 1);

/** Aplica os passos necessários a partir de `from`. Puro: não grava nada. */
export function applyMigrations(state, from) {
  let s = state;
  const applied = [];
  for (const m of MIGRATIONS) {
    if (m.to <= from) continue;
    s = m.up(s);
    applied.push(m.to);
  }
  return { state: s, applied };
}

/**
 * Lê, migra e grava. `store` = { get(keys) → obj, set(obj) } (chrome.storage.local ou um falso nos testes).
 * Instalação nova (sem dados): só marca a versão atual.
 */
export async function runMigrations(store, now = Date.now()) {
  const got = await store.get([META_KEY, ...MIGRATED_KEYS]);
  const meta = got[META_KEY] || {};
  const hasData = MIGRATED_KEYS.some((k) => got[k] !== undefined);
  const from = Number.isFinite(meta.schema) ? meta.schema : hasData ? 1 : CURRENT_SCHEMA;
  if (from > CURRENT_SCHEMA) {
    // Dados de uma versão mais nova (ex.: a extensão voltou de versão). Não mexe em nada.
    return { from, to: from, applied: [], skipped: 'newer' };
  }
  if (from === CURRENT_SCHEMA) {
    if (!Number.isFinite(meta.schema)) await store.set({ [META_KEY]: { ...meta, schema: CURRENT_SCHEMA, history: meta.history || [] } });
    return { from, to: from, applied: [] };
  }
  const before = Object.fromEntries(MIGRATED_KEYS.filter((k) => got[k] !== undefined).map((k) => [k, got[k]]));
  let result;
  try {
    result = applyMigrations(structuredClone(before), from);
  } catch (e) {
    await store.set({ [META_KEY]: { ...meta, schema: from, lastError: { at: now, message: String(e?.message || e) } } });
    return { from, to: from, applied: [], error: String(e?.message || e) };
  }
  const history = [...(meta.history || []), { from, to: CURRENT_SCHEMA, at: now }].slice(-20);
  await store.set({
    [MIGRATION_BACKUP_KEY]: { from, at: now, data: before },
    ...result.state,
    [META_KEY]: { schema: CURRENT_SCHEMA, history },
  });
  return { from, to: CURRENT_SCHEMA, applied: result.applied };
}

let running = null;
/** Roda as migrações uma vez por página/service worker (com trava entre abas quando disponível). */
export function migrateIfNeeded() {
  if (running) return running;
  const store = chrome.storage.local;
  const go = () => runMigrations(store).catch((e) => ({ error: String(e?.message || e) }));
  running = globalThis.navigator?.locks ? navigator.locks.request('neurotab-migrate', go) : go();
  return running;
}
