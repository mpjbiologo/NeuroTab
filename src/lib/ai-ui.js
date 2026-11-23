// NeuroTab — peças de interface da central de IA (0.8.0): o selo "🖥️ Ollama · llama3.2 ▾" para ver e trocar
// o modelo só desta vez, e a pergunta antes de cair na Reserva da internet.
import { h } from './ui.js';
import { t } from './i18n.js';
import { aiOf } from './ai.js';
import { resolve, check, pickLabel } from './ai/router.js';
import { TASKS } from './ai/tasks.js';
import { WHERE, PROVIDERS } from './ai/catalog.js';
import { modelCaps } from './ai/config.js';

/** Opções de servidor e modelo que servem para a tarefa: [{ server, model, label, where }]. */
export function modelOptions(settings, task) {
  const ai = aiOf(settings);
  const def = TASKS[task] || TASKS.chat;
  const out = [];
  for (const s of ai.servers) {
    if (!s.on) continue;
    const ids = [...new Set([...s.models.map((m) => m.id), ...(ai.primary.server === s.id ? [ai.primary.model] : []), ...(ai.tasks[task]?.server === s.id ? [ai.tasks[task].model] : [])].filter(Boolean))];
    for (const model of ids) {
      const caps = modelCaps(s, model);
      if (def.needs === 'embed' ? caps.embed !== true && !(caps.embed === null && model === s.embedModel) : caps.text === false) continue;
      if (def.needs === 'vision' && caps.vision === false) continue;
      const r = check(ai, { server: s.id, model, source: 'override' }, def);
      if (r.pick) out.push({ server: s.id, model, label: pickLabel(r.pick), where: r.pick.where });
    }
  }
  return out;
}

/**
 * Selo com o que a tarefa vai usar; escolher outro vale só para as próximas ações desta tela.
 * Devolve { el, override: () => { server, model } | null, refresh }.
 */
export function modelChip(getSettings, task, { onChange } = {}) {
  let override = null;
  const sel = h('select', { class: 'ai-chip', title: t('IA usada nesta ação. Escolha outra só para esta vez.') });
  const paint = () => {
    const settings = getSettings();
    const { use } = resolve(aiOf(settings), task, { override });
    const base = resolve(aiOf(settings), task).use;
    const opts = modelOptions(settings, task);
    sel.replaceChildren();
    const icon = (w) => WHERE[w]?.icon || '';
    sel.add(new Option(base ? `${icon(base.where)} ${pickLabel(base)}` : t('IA não configurada'), ''));
    for (const o of opts) {
      if (base && o.server === base.server && o.model === base.model) continue;
      sel.add(new Option(`${icon(o.where)} ${o.label}`, JSON.stringify({ server: o.server, model: o.model })));
    }
    sel.value = override ? JSON.stringify(override) : '';
    if (sel.value === '' && override) override = null;
    sel.hidden = !base && !opts.length;
    sel.disabled = sel.options.length < 2;
    sel.title = use ? `${t('IA usada nesta ação')}: ${pickLabel(use)} — ${t(WHERE[use.where].label)}. ${t('Escolha outra só para esta vez.')}` : t('IA não configurada');
  };
  sel.addEventListener('change', () => {
    override = sel.value ? JSON.parse(sel.value) : null;
    onChange?.(override);
  });
  paint();
  return { el: sel, override: () => override, refresh: paint };
}

/** A IA principal falhou e a Reserva fica na internet: pergunta se pode mandar para lá só desta vez. */
export function confirmReserve(err) {
  if (err?.code !== 'consent') return false;
  return confirm(`${t(err.message)}\n\n${t('Usar a Reserva só desta vez?')}`);
}

export const providerName = (type) => PROVIDERS[type]?.name || type;
