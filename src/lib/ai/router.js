// NeuroTab — qual servidor e modelo cada tarefa usa (0.8.0, #63). Puro: sem rede, fácil de testar.
// Ordem: 1) troca escolhida só para esta vez → 2) regra da tarefa → 3) Padrão. A Reserva só entra quando o escolhido falha.
import { PROVIDERS, whereOf, SHORT } from './catalog.js';
import { TASKS } from './tasks.js';
import { serverById, modelCaps, defaultModelFor } from './config.js';

export const PROBLEMS = {
  gone: 'o servidor foi removido',
  off: 'o servidor está desligado',
  nokey: 'falta a chave de API',
  nomodel: 'nenhum modelo escolhido',
  novision: 'o modelo não lê imagens',
  noembed: 'o servidor não oferece embeddings',
  notext: 'o modelo só gera embeddings',
};

/** Confere um candidato { server, model, source } para a tarefa. Devolve { pick } ou { problem }. */
export function check(ai, cand, task) {
  const s = serverById(ai, cand.server);
  const base = { server: cand.server, model: cand.model || '', source: cand.source };
  if (!s) return { problem: { ...base, why: 'gone' } };
  if (!s.on) return { problem: { ...base, why: 'off' } };
  if (!PROVIDERS[s.type].noKey && !ai.keys?.[s.id]) return { problem: { ...base, why: 'nokey' } };
  const needs = task.needs || 'text';
  // Herdando (ou sem modelo): cada servidor tem o seu modelo de embeddings e, se escolhido, o de imagens.
  let model = cand.model || '';
  if (needs === 'embed' && (cand.source === 'primary' || !model)) model = defaultModelFor(s, 'embed');
  if (needs === 'vision' && cand.source === 'primary' && s.visionModel) model = s.visionModel;
  if (needs === 'text' && !model) model = defaultModelFor(s, 'text');
  const caps = modelCaps(s, model);
  let auto = false;
  if (needs === 'embed' && !model) return { problem: { ...base, why: 'noembed' } };
  if (needs === 'embed' && caps.embed === false && !(cand.source === 'primary' || !cand.model)) return { problem: { ...base, model, why: 'noembed' } };
  if (needs === 'vision') {
    if (s.type === 'ollama' && (!model || caps.vision !== true)) auto = !cand.model || cand.source === 'primary'; // o Ollama procura um modelo com visão instalado
    if (caps.vision === false && !auto) return { problem: { ...base, model, why: 'novision' } };
    if (!model && !auto) model = defaultModelFor(s, 'text');
  }
  if (needs !== 'embed' && caps.text === false) return { problem: { ...base, model, why: 'notext' } };
  if (!model && !auto) return { problem: { ...base, why: 'nomodel' } };
  return {
    pick: {
      server: s.id, type: s.type, name: s.name || SHORT[s.type], base: s.base, key: ai.keys?.[s.id] || '',
      model, autoVision: auto, where: whereOf(s.type, s.base), source: cand.source,
    },
  };
}

/**
 * Resolve a tarefa: { use, reserve, problems }.
 * use: o que será usado (ou null); reserve: a Reserva válida para a tarefa (ou null); problems: o que foi pulado e por quê.
 */
export function resolve(ai, taskId = 'chat', { override = null } = {}) {
  const task = TASKS[taskId] || TASKS.chat;
  const cands = [];
  if (override?.server) cands.push({ server: override.server, model: override.model || '', source: 'override' });
  const rule = ai?.tasks?.[taskId];
  if (rule?.server) cands.push({ server: rule.server, model: rule.model || '', source: 'task' });
  if (ai?.primary?.server) cands.push({ server: ai.primary.server, model: ai.primary.model || '', source: 'primary' });
  const problems = [];
  let use = null;
  for (const c of cands) {
    const r = check(ai, c, task);
    if (r.pick) { use = r.pick; break; }
    problems.push(r.problem);
  }
  let reserve = null;
  if (task.reserve !== false && ai?.reserve?.server) {
    const r = check(ai, { ...ai.reserve, source: 'reserve' }, task);
    if (r.pick && !(use && r.pick.server === use.server && r.pick.model === use.model)) reserve = r.pick;
  }
  return { use, reserve, problems };
}

/** A troca local → internet precisa de permissão? (Reserva na internet e o escolhido no computador ou na rede de casa.) */
export const crossesToCloud = (from, to) => !!from && !!to && from.where !== 'cloud' && to.where === 'cloud';

/** Texto curto do que será usado: "Ollama · llama3.2". */
export const pickLabel = (p) => (p ? `${p.name} · ${p.autoVision ? 'modelo com visão (automático)' : p.model}` : '');
