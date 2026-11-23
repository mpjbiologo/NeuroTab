// NeuroTab — configuração da central de IA (0.8.0, #63): servidores, modelos, Padrão, Reserva e regras por tarefa.
// settings.ai = {
//   v: 2,
//   servers: [{ id, type, name, base, on, models: [{ id, caps: { vision, embed }, manual }], embedModel, visionModel }],
//   primary: { server, model },        // Padrão: o que toda tarefa usa
//   reserve: { server, model } | null, // Reserva: só quando o Padrão (ou a regra da tarefa) falha
//   tasks: { chat: { server, model }, … }, // ausente = herda do Padrão
//   keys: { [idDoServidor]: chave },  // fora dos servidores: a sincronização e o backup já tratam "keys" à parte
//   autoEnrich, semantic, imagesAllowed, sharePlaces…
//   provider, models, baseUrls, mirror // espelho do Padrão no formato antigo (aparelhos com versões antigas)
// }
import { PROVIDERS, SHORT, EMBED_DEFAULTS, guessCaps } from './catalog.js';

export const DEFAULT_AI = {
  v: 2,
  servers: [],
  primary: { server: '', model: '' },
  reserve: null,
  tasks: {},
  keys: {},
  autoEnrich: true,
  semantic: false, // busca por significado (embeddings)
  imagesAllowed: false, // enviar imagens à IA na internet sem perguntar a cada vez (IA local nunca pergunta)
  // formato antigo, mantido como espelho do Padrão
  provider: 'gemini',
  models: {},
  baseUrls: {},
  embedModels: {},
  visionModel: '',
};

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const bool3 = (v) => (v === true ? true : v === false ? false : null);

export function sanitizeServer(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = PROVIDERS[r.type] ? r.type : null;
  if (!type || !ID.test(String(r.id || ''))) return null;
  const p = PROVIDERS[type];
  const seen = new Set();
  const models = (Array.isArray(r.models) ? r.models : []).map((m) => (typeof m === 'string' ? { id: m } : m))
    .map((m) => ({ id: str(m?.id, 200), caps: { vision: bool3(m?.caps?.vision), embed: bool3(m?.caps?.embed) }, manual: !!m?.manual }))
    .filter((m) => m.id && !seen.has(m.id) && seen.add(m.id))
    .slice(0, 300);
  return {
    id: r.id,
    type,
    name: str(r.name, 60) || SHORT[type],
    base: (p.editableBase ? str(r.base, 300) || p.base : p.base).replace(/\/+$/, ''),
    on: r.on !== false,
    models,
    embedModel: str(r.embedModel, 200),
    visionModel: str(r.visionModel, 200),
  };
}

const pick = (v, ids) => (v && typeof v === 'object' && ids.has(v.server) ? { server: v.server, model: str(v.model, 200) } : null);

/** Assinatura do espelho antigo: se mudar sem a NeuroTab nova saber, alguém (versão antiga, teste, importação) trocou o provedor. */
const mirrorSig = (r) => JSON.stringify([r.provider || '', r.models?.[r.provider] || '', r.baseUrls?.[r.provider] || '']);
const keysSig = (r) => Object.keys(r.keys || {}).filter((k) => r.keys[k]).sort().join(',');

/** Tipos que a configuração antiga (até 0.7.x) tinha configurados. */
function legacyTypes(r) {
  return Object.keys(PROVIDERS).filter((t) => r.keys?.[t] || r.models?.[t] || r.baseUrls?.[t] || (r.provider === t && PROVIDERS[t].noKey));
}

function legacyServer(r, t) {
  return sanitizeServer({ id: t, type: t, name: SHORT[t], base: r.baseUrls?.[t] || '', models: r.models?.[t] ? [r.models[t]] : [], embedModel: r.embedModels?.[t] || '' });
}

/** Converte a configuração antiga (um provedor de cada vez) na central de IA. */
export function migrateAi(r, media = {}) {
  const servers = legacyTypes(r).map((t) => legacyServer(r, t)).filter(Boolean);
  const has = (id) => servers.some((s) => s.id === id);
  const primary = has(r.provider)
    ? { server: r.provider, model: r.models?.[r.provider] || PROVIDERS[r.provider].defaultModel }
    : servers[0] ? { server: servers[0].id, model: r.models?.[servers[0].id] || PROVIDERS[servers[0].type].defaultModel } : { server: '', model: '' };
  const tasks = {};
  const vision = str(r.visionModel, 200);
  if (media?.provider && has(media.provider) && media.provider !== primary.server) tasks.images = { server: media.provider, model: vision };
  else if (vision && primary.server) servers.find((s) => s.id === primary.server).visionModel = vision;
  return { servers, primary, tasks };
}

/** Normaliza (e migra, se preciso) settings.ai. `media` = settings.media, para a IA de imagens antiga. */
export function sanitizeAi(raw, media = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_AI, ...r, keys: { ...(r.keys || {}) }, models: { ...(r.models || {}) }, baseUrls: { ...(r.baseUrls || {}) }, embedModels: { ...(r.embedModels || {}) } };
  let servers;
  let primary = r.primary;
  let tasks = r.tasks && typeof r.tasks === 'object' ? { ...r.tasks } : {};
  // sem servidores, mas o formato antigo mudou por fora (chave ou provedor colocados por backup antigo, teste ou versão antiga)
  if (!Array.isArray(r.servers) || (!r.servers.length && legacyTypes(r).length && (r.mirror !== mirrorSig(r) || r.mirrorKeys !== keysSig(r)))) {
    const m = migrateAi(r, media);
    servers = m.servers;
    primary = m.primary;
    tasks = { ...m.tasks, ...tasks };
  } else {
    const seen = new Set();
    servers = r.servers.map(sanitizeServer).filter((s) => s && !seen.has(s.id) && seen.add(s.id));
    // O provedor no formato antigo mudou por fora (aparelho com versão antiga, backup antigo, teste): vira o Padrão.
    if (r.mirror && r.mirror !== mirrorSig(r) && PROVIDERS[r.provider]) {
      const t = r.provider;
      const legacy = legacyServer(r, t);
      const i = servers.findIndex((s) => s.id === t);
      if (i < 0) servers.push(legacy);
      else {
        if (PROVIDERS[t].editableBase && r.baseUrls?.[t]) servers[i].base = legacy.base;
        for (const m of legacy.models) if (!servers[i].models.some((x) => x.id === m.id)) servers[i].models.push(m);
      }
      primary = { server: t, model: r.models?.[t] || PROVIDERS[t].defaultModel };
    }
  }
  const ids = new Set(servers.map((s) => s.id));
  out.servers = servers;
  out.primary = pick(primary, ids) || (servers[0] ? { server: servers[0].id, model: PROVIDERS[servers[0].type].defaultModel } : { server: '', model: '' });
  if (!out.primary.model && out.primary.server) out.primary.model = PROVIDERS[servers.find((s) => s.id === out.primary.server).type].defaultModel;
  out.reserve = pick(r.reserve, ids);
  out.tasks = Object.fromEntries(Object.entries(tasks).filter(([k]) => /^[a-z][a-z0-9-]{1,30}$/.test(k)).map(([k, v]) => [k, pick(v, ids)]).filter(([, v]) => v));
  out.v = 2;
  // espelho no formato antigo: o Padrão como "provedor" (versões antigas continuam funcionando com o Padrão)
  const ps = servers.find((s) => s.id === out.primary.server);
  if (!servers.length) { out.provider = 'gemini'; out.models = {}; out.baseUrls = {}; out.embedModels = {}; out.visionModel = ''; } // sem servidores: nada para ressuscitar
  if (ps) {
    out.provider = ps.type;
    out.models[ps.type] = out.primary.model;
    if (PROVIDERS[ps.type].editableBase) out.baseUrls[ps.type] = ps.base;
    if (ps.id !== ps.type && out.keys[ps.id]) out.keys[ps.type] ||= out.keys[ps.id];
  }
  out.mirror = mirrorSig(out);
  out.mirrorKeys = keysSig(out);
  return out;
}

// ---------- ajudantes ----------
/** Remove um servidor, a chave dele e o que sobrou dele no espelho antigo (para não voltar sozinho). */
export function removeServer(ai, id) {
  const s = (ai.servers || []).find((x) => x.id === id);
  const out = { ...ai, servers: (ai.servers || []).filter((x) => x.id !== id), keys: { ...(ai.keys || {}) }, models: { ...(ai.models || {}) }, baseUrls: { ...(ai.baseUrls || {}) }, embedModels: { ...(ai.embedModels || {}) } };
  delete out.keys[id];
  if (s && !out.servers.some((x) => x.id === s.type)) { delete out.keys[s.type]; delete out.models[s.type]; delete out.baseUrls[s.type]; delete out.embedModels[s.type]; }
  if (out.primary?.server === id) out.primary = { server: '', model: '' };
  if (out.reserve?.server === id) out.reserve = null;
  if (!out.servers.length) { out.provider = 'gemini'; out.models = {}; out.baseUrls = {}; out.embedModels = {}; out.visionModel = ''; }
  out.mirror = mirrorSig(out);
  out.mirrorKeys = keysSig(out);
  return out;
}

export const serverById = (ai, id) => (ai?.servers || []).find((s) => s.id === id) || null;

export function newServerId(ai, type) {
  const ids = new Set((ai?.servers || []).map((s) => s.id));
  if (!ids.has(type)) return type;
  for (let i = 2; ; i++) if (!ids.has(`${type}-${i}`)) return `${type}-${i}`;
}

/** O que o modelo sabe fazer: o que a pessoa marcou ou o provedor informou; senão, o palpite pelo nome. */
export function modelCaps(server, model) {
  const g = guessCaps(server?.type, model);
  const m = (server?.models || []).find((x) => x.id === model);
  return { text: g.text, vision: m?.caps?.vision ?? g.vision, embed: m?.caps?.embed ?? g.embed };
}

/** Modelo que o servidor usa para uma necessidade, quando a tarefa herda (sem modelo escolhido). */
export function defaultModelFor(server, needs, fallback = '') {
  if (!server) return '';
  if (needs === 'embed') return server.embedModel || (EMBED_DEFAULTS[server.type] ?? '') || '';
  if (needs === 'vision') return server.visionModel || fallback;
  return fallback || PROVIDERS[server.type].defaultModel;
}

/** Configuração para exportar (sem as chaves). */
export function exportAi(ai) {
  const { servers, primary, reserve, tasks } = ai;
  return { neurotab: 'ai-config', v: 2, servers, primary, reserve, tasks };
}

/** Importa uma configuração exportada; as chaves deste navegador continuam (pelo id do servidor). */
export function importAi(ai, data, media) {
  if (data?.neurotab !== 'ai-config' || !Array.isArray(data.servers)) throw new Error('Este arquivo não é uma configuração de IA da NeuroTab.');
  return sanitizeAi({ ...ai, servers: data.servers, primary: data.primary, reserve: data.reserve, tasks: data.tasks || {}, mirror: undefined }, media);
}

/**
 * Cadastra um modelo do Ollama na central (cria o servidor se ainda não existir).
 * use: 'primary' (vira o Padrão), uma lista de tarefas, ou nada (só adiciona). Devolve o settings.ai novo.
 */
export function addOllamaModel(ai, base, model, { caps = {}, use = null } = {}) {
  const root = String(base || 'http://localhost:11434').replace(/\/+$/, '').replace(/\/v1$/, '');
  const out = { ...ai, servers: [...(ai.servers || [])], tasks: { ...(ai.tasks || {}) } };
  let s = out.servers.find((x) => x.type === 'ollama' && x.base.replace(/\/v1$/, '') === root);
  if (!s) {
    s = sanitizeServer({ id: newServerId(out, 'ollama'), type: 'ollama', name: SHORT.ollama, base: root + '/v1', models: [] });
    out.servers.push(s);
  } else {
    s = { ...s, models: [...s.models] };
    out.servers = out.servers.map((x) => (x.id === s.id ? s : x));
  }
  if (!s.on) s.on = true;
  const entry = { id: model, caps: { vision: caps.vision ?? null, embed: caps.embed ?? null }, manual: caps.vision != null || caps.embed != null };
  const i = s.models.findIndex((m) => m.id === model);
  if (i >= 0) s.models[i] = { ...s.models[i], caps: entry.caps }; else s.models.push(entry);
  if (use === 'primary') out.primary = { server: s.id, model };
  else if (Array.isArray(use)) for (const t of use) out.tasks[t] = { server: s.id, model };
  if (!out.primary?.server) out.primary = { server: s.id, model };
  return out;
}
