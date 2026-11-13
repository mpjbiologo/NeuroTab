// NeuroTab — barramento de eventos entre as partes da nova aba (#5).
//
// API pequena: on(evento, fn) → off(), once(evento, fn), emit(evento, dados), count(evento).
// - Um assinante com erro não impede os outros (o erro vai para o console).
// - Os dados são conferidos contra o catálogo EVENTS (nome conhecido e campos obrigatórios).
// - Não é armazenamento nem executa nada além dos assinantes: só avisa que algo aconteceu.
//
// Nomes antigos ('data', 'brain', 'ask') continuam funcionando como apelidos (ALIASES).

/**
 * Catálogo de eventos. `payload` descreve o que vai junto; `requires` lista campos obrigatórios
 * quando os dados são um objeto. Para um evento novo: acrescente aqui e documente em docs/dev/WIDGETS.md.
 */
export const EVENTS = {
  'data.changed': { payload: 'S.data inteiro (configurações, grupos, atalhos) depois de salvo' },
  'brain.changed': { payload: 'lista de itens do cérebro depois de qualquer mudança' },
  'ask.requested': { payload: 'texto da pergunta feita pela busca (Ctrl+K) para o widget "Pergunte ao seu cérebro"' },
  'brain.item.created': { payload: 'item criado', requires: ['id', 'type'] },
  'task.created': { payload: 'tarefa criada', requires: ['id'] },
  'task.completed': { payload: 'tarefa concluída', requires: ['id'] },
  'widget.mounted': { payload: 'widget montado', requires: ['id'] },
  'widget.unmounted': { payload: 'widget desmontado', requires: ['id'] },
  'knowledge.source.added': { payload: 'fonte de conhecimento adicionada (v0.9)', requires: ['id'] },
  'study.review.due': { payload: 'revisão de estudo pendente (v0.9)', requires: ['id'] },
};

/** Nomes antigos usados pelos widgets antes do barramento. */
export const ALIASES = { data: 'data.changed', brain: 'brain.changed', ask: 'ask.requested' };

/**
 * Compara a lista de itens antes e depois de uma mudança e devolve os eventos de domínio:
 * brain.item.created (e task.created para tarefas) e task.completed. Funciona venha a mudança
 * de onde vier (nova aba, popup, menu do botão direito, outra aba).
 */
export function brainEvents(prev = [], next = []) {
  const before = new Map(prev.map((i) => [i.id, i]));
  const out = [];
  for (const it of next) {
    const old = before.get(it.id);
    if (!old) {
      out.push(['brain.item.created', it]);
      if (it.type === 'task') out.push(['task.created', it]);
    } else if (it.type === 'task' && it.done && !old.done) {
      out.push(['task.completed', it]);
    }
  }
  return out;
}

export function createBus({ catalog = EVENTS, aliases = ALIASES, onError = (e, evt) => console.error(`NeuroTab: erro no evento ${evt}`, e) } = {}) {
  const subs = new Map(); // evento -> Set(fn)
  const name = (evt) => aliases[evt] || evt;
  const check = (evt) => {
    if (!catalog[evt]) throw new Error(`Evento desconhecido: ${evt}. Acrescente-o em EVENTS (lib/events.js).`);
  };

  function on(evt, fn) {
    const e = name(evt);
    check(e);
    if (typeof fn !== 'function') throw new TypeError('on(evento, fn): fn precisa ser uma função');
    if (!subs.has(e)) subs.set(e, new Set());
    const wrapped = (p) => fn(p); // cada inscrição é única, mesmo com a mesma função
    subs.get(e).add(wrapped);
    let done = false;
    return () => { if (!done) { done = true; subs.get(e)?.delete(wrapped); } };
  }

  function once(evt, fn) {
    const off = on(evt, (p) => { off(); fn(p); });
    return off;
  }

  function emit(evt, payload) {
    const e = name(evt);
    check(e);
    const req = catalog[e].requires;
    if (req && (payload == null || typeof payload !== 'object' || req.some((k) => payload[k] == null))) {
      throw new TypeError(`Evento ${e}: faltam campos obrigatórios (${req.join(', ')}).`);
    }
    let n = 0;
    for (const fn of [...(subs.get(e) || [])]) {
      try { fn(payload); n++; } catch (err) { onError(err, e); }
    }
    return n; // quantos assinantes rodaram sem erro
  }

  const count = (evt) => subs.get(name(evt))?.size || 0;
  const clear = () => subs.clear();

  return { on, once, emit, count, clear };
}
