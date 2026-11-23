// NeuroTab — IA (fachada). Desde a 0.8.0 a central de IA escolhe o servidor e o modelo de cada tarefa
// (lib/ai/router.js) e cada tipo de provedor tem um adaptador (lib/ai/providers/). As chamadas vão direto do
// navegador para o servidor escolhido, com a chave do próprio usuário.
import { displayTitle, TYPES } from './brain.js';
import { hostOf } from './store.js';
import { contextItems } from './semantic.js';
import { requestAccess, hasData } from './permissions.js';
import { PROVIDERS, SHORT, whereOf } from './ai/catalog.js';
import { AIError, AI_ERRORS, RETRYABLE } from './ai/errors.js';
import { sanitizeAi, serverById } from './ai/config.js';
import { resolve, crossesToCloud, pickLabel, PROBLEMS } from './ai/router.js';
import { adapterFor } from './ai/providers/index.js';
import { organizePrompt, askPrompt, commandPrompt } from './ai/prompts.js';

export { PROVIDERS, AIError, pickLabel };

/** settings.ai já no formato da central (migra na hora se vier no formato antigo). */
export function aiOf(settings) {
  const ai = settings?.ai;
  return ai?.v === 2 && Array.isArray(ai.servers) && ai.mirror ? ai : sanitizeAi(ai, settings?.media);
}

/** O que a tarefa vai usar, no formato antigo ({ id, p, key, model, base }) mais { server, name, where, source }. */
export function aiConfig(settings, task = 'chat', { override = null } = {}) {
  const ai = aiOf(settings);
  const { use } = resolve(ai, task, { override });
  if (use) return { ...use, id: use.type, p: PROVIDERS[use.type] };
  const s = serverById(ai, ai.primary?.server);
  const type = s?.type || 'gemini';
  return { id: type, type, p: PROVIDERS[type], key: '', model: '', base: s?.base || PROVIDERS[type].base, server: s?.id || '', name: s?.name || SHORT[type], where: whereOf(type, s?.base || PROVIDERS[type].base), none: true };
}

export function isConfigured(settings, task = 'chat') {
  return !!resolve(aiOf(settings), task).use;
}

/** O que a tarefa usa fica no computador ou na rede de casa (não vai para a internet)? */
export function isLocalAI(settings, task = 'chat', opts) {
  return aiConfig(settings, task, opts).where !== 'cloud'; // sem IA pronta: onde iria o Padrão
}

/** Por que a tarefa não tem IA: "o servidor está desligado" etc. (vazio se tem). */
export function whyNotConfigured(settings, task = 'chat') {
  const { use, problems } = resolve(aiOf(settings), task);
  if (use) return '';
  const p = problems[0];
  return p ? PROBLEMS[p.why] || '' : '';
}

export function originsFor(cfg) {
  try {
    const u = new URL(cfg.base);
    return [`${u.protocol}//${u.hostname}/*`];
  } catch {
    return [];
  }
}

// Precisa ser chamado a partir de um clique (gesto do usuário), SEM await antes:
// o Firefox só mostra o pedido se ele acontecer direto no clique. Se já houver permissão, não aparece nada.
// No Firefox, pede junto o consentimento para enviar conteúdo das notas ao provedor.
export function requestPermission(cfg) {
  const origins = originsFor(cfg);
  if (!origins.length) return Promise.reject(new Error('URL do provedor inválida.'));
  // Servidor por http na rede de casa (ex.: Ollama em outro computador): a NeuroTab não pede acesso a "todos os
  // sites por http"; o próprio servidor libera a extensão (OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*").
  if (/^http:\/\//.test(origins[0]) && !/^http:\/\/(localhost|127\.0\.0\.1)\//.test(origins[0])) return requestAccess({ origins: [], data: ['websiteContent'] }).then(() => true, () => true);
  return requestAccess({ origins, data: ['websiteContent'] });
}

// No Firefox, sem o consentimento de dados nada é enviado ao provedor.
async function ensureDataConsent() {
  if (!(await hasData('websiteContent'))) throw new Error('No Firefox, autorize o envio de conteúdo à IA: Configurações → IA e voz → Salvar.');
}

/**
 * Pede uma resposta à IA da tarefa.
 * messages: [{ role: 'user' | 'assistant', content: string | partes (texto e imagem) }]
 * opts.task: tarefa (chat, organize, commands, media, images…); opts.override: { server, model } só desta vez;
 * opts.allowCloudReserve: a pessoa autorizou cair na Reserva da internet; opts.onUse(pick): avisa o que foi usado;
 * opts.model: outro modelo do mesmo servidor só nesta chamada (ex.: um com visão no Ollama).
 */
export async function complete(settings, { task = 'chat', override = null, allowCloudReserve = false, onUse = null, system = '', messages, json = false, maxTokens = 1200, model = '' }) {
  await ensureDataConsent();
  const { use, reserve, problems } = resolve(aiOf(settings), task, { override });
  if (!use) {
    const why = problems[0] && PROBLEMS[problems[0].why];
    throw new AIError('config', why ? `${AI_ERRORS.config} (${problems[0].server}: ${why})` : AI_ERRORS.config, { problems });
  }
  const run = (p, m) => adapterFor(p.type).generate({ ...p, model: m || p.model }, { system, messages, json, maxTokens });
  try {
    onUse?.(use);
    return await run(use, model);
  } catch (e) {
    const err = e instanceof AIError ? e : new AIError('failed', e?.message);
    if (!reserve || !RETRYABLE.has(err.code)) throw err;
    if (crossesToCloud(use, reserve) && !allowCloudReserve) {
      throw new AIError('consent', `${pickLabel(use)} não respondeu (${err.message}). A Reserva, ${pickLabel(reserve)}, fica na internet: o conteúdo deste pedido seria enviado para lá.`, { from: use, to: reserve, cause: err });
    }
    onUse?.(reserve);
    return await run(reserve, '');
  }
}

/** Lista os modelos de um servidor (com o que cada um sabe fazer, quando o provedor informa). */
export function listServerModels(server, key = '') {
  return adapterFor(server.type).listModels({ type: server.type, base: server.base, key });
}

/** Testa um servidor e modelo: devolve { ms, text }. */
export async function testServer(server, key, model) {
  await ensureDataConsent();
  const t0 = performance.now();
  const text = await adapterFor(server.type).generate({ type: server.type, base: server.base, key, model }, { messages: [{ role: 'user', content: 'Responda apenas: OK' }], maxTokens: 50 });
  return { ms: Math.round(performance.now() - t0), text: String(text || '').trim() };
}

export function parseJson(text) {
  const clean = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new AIError('invalid', 'Resposta da IA em formato inesperado.');
  }
}

// ---------- Organizar um item (título, resumo, tags, tipo, lembrete) ----------
export async function enrich(settings, item, opts = {}) {
  const system = organizePrompt();
  const content = [
    item.title && `Título atual: ${item.title}`,
    item.pageTitle && `Página: ${item.pageTitle} (${hostOf(item.url)})`,
    `Conteúdo:\n${(item.text || item.url || '').slice(0, 6000)}`,
  ].filter(Boolean).join('\n');
  const out = parseJson(await complete(settings, { ...opts, task: 'organize', system, messages: [{ role: 'user', content }], json: true, maxTokens: 400 }));
  const map = { nota: 'note', tarefa: 'task', ideia: 'idea', trecho: 'clip', pagina: 'page', página: 'page' };
  const patch = { enriched: true };
  if (!item.title && out.titulo) patch.title = String(out.titulo).slice(0, 90);
  if (out.resumo && (item.text || '').length > 140) patch.summary = String(out.resumo).slice(0, 300);
  if (Array.isArray(out.tags)) patch.tags = [...new Set([...(item.tags || []), ...out.tags.map((t) => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean)])].slice(0, 6);
  if (item.type === 'note' && map[out.tipo] && map[out.tipo] !== 'page') patch.type = map[out.tipo];
  if (!item.remindAt && out.lembrete) {
    const ts = Date.parse(out.lembrete);
    if (ts && ts > Date.now() - 60e3) patch.remindAt = ts;
  }
  return patch;
}

// ---------- Perguntar ao cérebro ----------
export async function buildContext(settings, items, question, limit = 14) {
  let found = await contextItems(settings, items, question, limit);
  if (found.length < 4) {
    const recent = items.filter((i) => !found.includes(i)).slice(0, limit - found.length);
    found = [...found, ...recent];
  }
  const text = found.map((it, i) => {
    const meta = [TYPES[it.type]?.label, new Date(it.createdAt).toLocaleDateString('pt-BR'), it.tags?.length && '#' + it.tags.join(' #'), it.url && hostOf(it.url), it.remindAt && 'lembrete ' + new Date(it.remindAt).toLocaleString('pt-BR'), it.type === 'task' && (it.done ? 'concluída' : 'pendente'), it.type === 'image' && 'texto lido de uma imagem salva, pode ter erros'].filter(Boolean).join(' · ');
    return `[${i + 1}] ${displayTitle(it)} (${meta})\n${(it.text || it.summary || it.url).slice(0, 1500)}`;
  }).join('\n\n');
  return { found, text };
}

/**
 * Pergunta ao cérebro. `extras` são trechos de dados dos widgets ({ title, text, note? }),
 * ex.: locais e rotas do widget de mapas (lib/places.js), incluídos só quando a pergunta pede.
 */
export async function ask(settings, items, question, history = [], extras = [], opts = {}) {
  const { found, text } = await buildContext(settings, items, question);
  // A agenda dos próximos dias vai junto: "tenho algo livre na quinta?", "quando é o dentista?"
  const agenda = await import('./calendar.js').then((m) => m.calendarContext()).catch(() => '');
  if (agenda) extras = [...(extras || []), { title: 'AGENDA DO USUÁRIO (próximos 14 dias; horários no fuso dele)', text: agenda }];
  const extra = (extras || []).filter((x) => x?.text).map((x) => `\n\n${x.title}:${x.note ? `\n(${x.note})` : ''}\n${x.text}`).join('');
  const system = askPrompt(text, extra);
  const messages = [...history.slice(-6), { role: 'user', content: question }];
  const answer = await complete(settings, { ...opts, task: 'chat', system, messages, maxTokens: 900 });
  return { answer, sources: found };
}

// ---------- Interpretar um comando de voz (plano B quando as regras não entendem) ----------
export async function interpretCommand(settings, text) {
  return parseJson(await complete(settings, { task: 'commands', system: commandPrompt(), messages: [{ role: 'user', content: text }], json: true, maxTokens: 200 }));
}
