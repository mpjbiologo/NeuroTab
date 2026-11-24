// NeuroTab — Central do botão direito (0.9.0, #55/#56/#12/#37): o catálogo de ações, por contexto, e o plano do
// menu conforme as preferências (favoritas no topo, IA num submenu, o resto em "Mais ▸"). Puro.

/** group: save | organize | ai | send | tools. review: abre a janelinha de revisão antes de salvar. */
export const ACTIONS = [
  { id: 'sel-note', icon: '💾', label: 'Salvar como nota…', contexts: ['selection'], group: 'save', review: 'note', fav: true },
  { id: 'sel-task', icon: '✅', label: 'Criar tarefa…', contexts: ['selection'], group: 'organize', review: 'task', fav: true },
  { id: 'sel-remind', icon: '⏰', label: 'Criar lembrete…', contexts: ['selection'], group: 'organize', review: 'remind' },
  { id: 'sel-join', icon: '🔗', label: 'Juntar a uma nota existente…', contexts: ['selection'], group: 'organize', review: 'join' },
  { id: 'ai-summary', icon: '📝', label: 'Resumir', contexts: ['selection'], group: 'ai', ai: 'summary' },
  { id: 'ai-explain', icon: '💡', label: 'Explicar', contexts: ['selection'], group: 'ai', ai: 'explain' },
  { id: 'ai-translate', icon: '🌐', label: 'Traduzir', contexts: ['selection'], group: 'ai', ai: 'translate' },
  { id: 'sel-extract', icon: '🧾', label: 'Extrair dados (telefone, e-mail, datas, preços)', contexts: ['selection'], group: 'ai', review: 'extract' },
  { id: 'sel-search', icon: '🔎', label: 'Pesquisar "%s"', contexts: ['selection'], group: 'send', fav: true },
  { id: 'sel-route', icon: '🧭', label: 'Traçar rota até "%s"', contexts: ['selection'], group: 'send' },
  { id: 'link-save', icon: '🔗', label: 'Salvar link no cérebro', contexts: ['link'], group: 'save', fav: true },
  { id: 'link-media', icon: '🎬', label: 'Salvar link no cérebro com resumo', contexts: ['link'], group: 'save' },
  { id: 'link-doc', icon: '📄', label: 'Salvar o documento no cérebro', contexts: ['link'], group: 'save', fav: true, docs: true },
  { id: 'img-save', icon: '🖼️', label: 'Salvar imagem na biblioteca', contexts: ['image'], group: 'save', fav: true },
  { id: 'img-analyze', icon: '🔍', label: 'Analisar imagem', contexts: ['image'], group: 'ai' },
  { id: 'img-ocr', icon: '🔤', label: 'Extrair o texto da imagem', contexts: ['image'], group: 'ai' },
  { id: 'img-note', icon: '📝', label: 'Salvar imagem e anotar…', contexts: ['image'], group: 'save', review: 'image' },
  { id: 'page-save', icon: '🔖', label: 'Salvar página no cérebro (ler depois)', contexts: ['page'], group: 'save', fav: true },
  { id: 'page-media', icon: '🎬', label: 'Salvar no cérebro com resumo', contexts: ['page'], group: 'save' },
  { id: 'page-summary', icon: '🤖', label: 'Resumir a página', contexts: ['page'], group: 'ai', ai: 'page' },
  { id: 'page-note', icon: '📝', label: 'Nota sobre esta página…', contexts: ['page'], group: 'save', review: 'page' },
  { id: 'media-dl', icon: '⬇', label: 'Baixar o vídeo (e salvar no cérebro)', contexts: ['page', 'video'], group: 'save', dl: true },
  { id: 'snip', icon: '✂️', label: 'Recortar área da tela', contexts: ['page', 'selection', 'link', 'image'], group: 'tools', fav: true },
  { id: 'snip-full', icon: '⇣', label: 'Capturar a página inteira', contexts: ['page'], group: 'tools' },
  { id: 'add', icon: '➕', label: 'Adicionar aos atalhos', contexts: ['page', 'link'], group: 'send', groups: true },
];
export const ACTION_IDS = ACTIONS.map((a) => a.id);
export const byId = (id) => ACTIONS.find((a) => a.id === id);

/** Arquivos que o "Salvar o documento" reconhece pelo endereço (sem baixar nada). */
export const DOC_EXT = ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub'];
export const DOC_PATTERNS = DOC_EXT.flatMap((e) => [`*://*/*.${e}`, `*://*/*.${e}?*`, `*://*/*.${e.toUpperCase()}`]);

export const GROUP_LABELS = { save: 'Salvar', organize: 'Organizar', ai: 'Analisar com IA', send: 'Enviar e abrir', tools: 'Ferramentas' };

export const DEFAULT_MENU = { order: [], hidden: [], fav: ACTIONS.filter((a) => a.fav).map((a) => a.id) };

export function sanitizeMenu(m = {}) {
  const ok = (list) => (Array.isArray(list) ? [...new Set(list.filter((id) => ACTION_IDS.includes(id)))] : null);
  return { order: ok(m.order) || [], hidden: ok(m.hidden) || [], fav: ok(m.fav) ?? DEFAULT_MENU.fav };
}

/** Ordem final: a salva pela pessoa, e as ações novas (que ela ainda não viu) no fim, na ordem do catálogo. */
export function orderedActions(menu) {
  const m = sanitizeMenu(menu);
  const seen = new Set(m.order);
  return [...m.order, ...ACTION_IDS.filter((id) => !seen.has(id))].map(byId);
}

/**
 * Plano do menu: [{ id, parentId?, title, contexts, … }] na ordem de criação.
 * Favoritas ficam direto em "NeuroTab"; as de IA (não favoritas) em "🤖 IA ▸"; o resto em "Mais ▸".
 * `groups` = grupos de atalhos (para "Adicionar aos atalhos ▸"); `t` traduz.
 */
export function menuPlan(menu, groups = [], t = (x) => x) {
  const m = sanitizeMenu(menu);
  const hidden = new Set(m.hidden);
  const fav = new Set(m.fav);
  const list = orderedActions(m).filter((a) => !hidden.has(a.id));
  const union = (acts) => [...new Set(acts.flatMap((a) => a.contexts))];
  const all = union(ACTIONS);
  const out = [{ id: 'nt-root', title: 'NeuroTab', contexts: all }];
  const item = (a, parentId) => {
    const o = { id: 'nt-' + a.id, parentId, title: `${a.icon} ${t(a.label)}`, contexts: a.contexts };
    if (a.docs) o.targetUrlPatterns = DOC_PATTERNS;
    if (a.dl) o.dl = true;
    return o;
  };
  const sub = (a, parentId) => {
    const kids = [item(a, parentId)];
    if (a.groups) for (const g of groups) kids.push({ id: 'nt-g-' + g.id, parentId: 'nt-' + a.id, title: `${g.icon || ''} ${g.name}`.trim(), contexts: a.contexts });
    return kids;
  };
  const favs = list.filter((a) => fav.has(a.id));
  const ai = list.filter((a) => !fav.has(a.id) && a.group === 'ai');
  const more = list.filter((a) => !fav.has(a.id) && a.group !== 'ai');
  for (const a of favs) out.push(...sub(a, 'nt-root'));
  if (ai.length) {
    out.push({ id: 'nt-sep-1', parentId: 'nt-root', type: 'separator', contexts: union(ai) });
    out.push({ id: 'nt-ai', parentId: 'nt-root', title: '🤖 ' + t('IA'), contexts: union(ai) });
    for (const a of ai) out.push(...sub(a, 'nt-ai'));
  }
  if (more.length) {
    out.push({ id: 'nt-more', parentId: 'nt-root', title: t('Mais'), contexts: union(more) });
    for (const a of more) out.push(...sub(a, 'nt-more'));
  }
  return out;
}

/** Ações que aparecem num contexto (para a prévia nas Configurações e para os testes). */
export function actionsFor(menu, context) {
  const m = sanitizeMenu(menu);
  const hidden = new Set(m.hidden);
  return orderedActions(m).filter((a) => !hidden.has(a.id) && a.contexts.includes(context));
}

// ---------- Extrair dados de um trecho (sem IA) ----------
const uniq = (a) => [...new Set(a.map((x) => x.trim()).filter(Boolean))];
export function extractData(text) {
  const s = String(text || '');
  const emails = uniq(s.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []);
  const urls = uniq((s.match(/\bhttps?:\/\/[^\s<>"')]+/g) || []).map((u) => u.replace(/[.,;:!?]+$/, '')));
  const phones = uniq((s.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}\b/g) || []).filter((p) => p.replace(/\D/g, '').length >= 8));
  const prices = uniq(s.match(/(?:R\$|US\$|\$|€|£)\s?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?|\d{1,3}(?:\.\d{3})*,\d{2}\s?(?:reais|R\$)/gi) || []);
  const dates = uniq(s.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} de (?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?: de \d{4})?\b/gi) || []);
  const times = uniq(s.match(/\b(?:[01]?\d|2[0-3])(?::|h)[0-5]\d\b|\b(?:[01]?\d|2[0-3])h\b/gi) || []);
  const cpfCnpj = []; // de propósito: documentos pessoais não são extraídos
  return { emails, phones, urls, prices, dates, times, cpfCnpj };
}

/** Prompts das ações de IA no trecho. */
export function aiPrompt(kind, lang = 'pt-BR', target = '') {
  const base = `Responda em ${lang}, em texto simples (listas curtas se ajudar). Não invente nada que não esteja no texto.`;
  if (kind === 'summary') return `Resuma o texto abaixo em poucas linhas, com os pontos principais. ${base}`;
  if (kind === 'explain') return `Explique de forma simples o texto ou o termo abaixo, como para alguém inteligente que não é da área. Dê um exemplo curto. Responda em ${lang}.`;
  if (kind === 'translate') return `Traduza o texto abaixo para ${target || lang}. Responda só com a tradução, mantendo a formatação.`;
  if (kind === 'page') return `Resuma esta página em até 8 tópicos curtos e uma frase final com a conclusão. ${base}`;
  return base;
}
