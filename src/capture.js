// NeuroTab — Janelinha de revisão do botão direito (0.9.0, #55/#56/#12).
// Nada é criado sem a pessoa confirmar: nota, tarefa, lembrete, juntar a uma nota, imagem com anotação,
// dados extraídos e as ações de IA (com aviso de onde o texto é processado).
import { h, miniMarkdown } from './lib/ui.js';
import { setHTML } from './lib/safe-html.js';
import { loadData, saveData, hostOf } from './lib/store.js';
import { initI18n, t, LOCALE } from './lib/i18n.js';
import { startIconizer } from './lib/icons.js';
import * as Brain from './lib/brain.js';
import { complete, isConfigured, aiConfig } from './lib/ai.js';
import { extractData, aiPrompt } from './lib/menu-actions.js';
import { getCapture } from './lib/image-index.js';

const $ = (s) => document.querySelector(s);
const KEY = location.hash.slice(1);
let data;
let P; // { kind, text, url, pageTitle, ai, captureId }

const TITLES = {
  note: ['💾', 'Salvar como nota'], task: ['✅', 'Criar tarefa'], remind: ['⏰', 'Criar lembrete'], page: ['📝', 'Nota sobre esta página'],
  join: ['🔗', 'Juntar a uma nota existente'], extract: ['🧾', 'Dados encontrados no trecho'], image: ['📝', 'Salvar imagem e anotar'],
  summary: ['📝', 'Resumo'], explain: ['💡', 'Explicação'], translate: ['🌐', 'Tradução'], pageSummary: ['🤖', 'Resumo da página'],
};

const msg = (text, cls = '') => { const m = $('#msg'); m.className = 'small ' + cls; m.textContent = text; };
const tagsOf = (s) => String(s || '').split(/[,\s]+/).map((x) => x.replace(/^#/, '').trim()).filter(Boolean).slice(0, 12);
const origin = () => (P.url ? { url: P.url, pageTitle: P.pageTitle || '' } : {});
const done = (text) => { msg('✓ ' + text, 'ok'); setTimeout(() => window.close(), 900); };

function toLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function tagList() {
  const all = new Set();
  for (const it of await Brain.loadItems()) for (const tg of it.tags || []) all.add(tg);
  return h('datalist', { id: 'tagsDl' }, ...[...all].sort().slice(0, 200).map((x) => h('option', { value: '#' + x })));
}

// ---------- nota / tarefa / lembrete ----------
async function formNote() {
  let kind = P.kind === 'page' ? 'note' : P.kind;
  const quote = h('textarea', { class: 'quote', id: 'quote', rows: 4 }, P.text || '');
  const firstLine = String(P.text || P.pageTitle || '').split(/\n/)[0].slice(0, 90);
  const title = h('input', { type: 'text', id: 'ttl', value: kind === 'note' ? '' : firstLine, placeholder: t('Título (opcional)') });
  const comment = h('textarea', { id: 'comment', rows: 3, placeholder: t('Seu comentário (opcional)') });
  const guess = P.text ? Brain.parseReminder(P.text) : null;
  const when = h('input', { type: 'datetime-local', id: 'when', value: toLocalInput(guess && guess > Date.now() ? guess : null) });
  const tags = h('input', { type: 'text', id: 'tags', list: 'tagsDl', placeholder: t('#etiquetas (servem de projeto, ex.: #cliente-x)') });
  const whenBox = h('label', { class: 'f' }, t('Data e hora'), when);
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('Tipo') });
  const paint = () => {
    for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.k === kind));
    whenBox.hidden = kind === 'note';
    whenBox.firstChild.textContent = t(kind === 'remind' ? 'Quando lembrar' : 'Prazo (opcional)');
    $('#title').textContent = `${TITLES[kind][0]} ${t(TITLES[kind][1])}`;
  };
  for (const [k, l] of [['note', 'Nota'], ['task', 'Tarefa'], ['remind', 'Lembrete']]) seg.append(h('button', { type: 'button', 'data-k': k, onclick: () => { kind = k; paint(); } }, t(l)));
  const save = h('button', { class: 'btn primary', id: 'save' }, t('Salvar'));
  save.onclick = async () => {
    const remindAt = when.value ? new Date(when.value).getTime() : null;
    if (kind === 'remind' && !remindAt) { msg(t('Escolha quando lembrar.'), 'err'); when.focus(); return; }
    const q = quote.value.trim();
    const c = comment.value.trim();
    const text = [q, c && `💬 ${c}`].filter(Boolean).join('\n\n');
    if (!text && !title.value.trim()) { msg(t('Escreva alguma coisa.'), 'err'); return; }
    const type = kind === 'note' ? (q && P.kind !== 'page' ? 'clip' : P.kind === 'page' ? 'page' : 'note') : 'task';
    await Brain.addItem({ type, title: title.value.trim(), text, tags: tagsOf(tags.value), remindAt, ...origin(), source: 'context' });
    done(t(kind === 'remind' ? 'Lembrete criado.' : kind === 'task' ? 'Tarefa criada.' : 'Salvo no cérebro.'));
  };
  $('#body').replaceChildren(seg, ...(P.text ? [h('label', { class: 'f' }, t('Trecho'), quote)] : []), h('label', { class: 'f' }, t('Título'), title),
    h('label', { class: 'f' }, t('Comentário'), comment), whenBox, h('label', { class: 'f' }, t('Etiquetas'), tags), await tagList(),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => window.close() }, t('Cancelar')), save));
  paint();
  (P.text ? comment : title).focus();
}

// ---------- juntar a uma nota existente ----------
async function formJoin() {
  const items = (await Brain.loadItems()).filter((i) => !i.deletedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  let chosen = null;
  const q = h('input', { type: 'text', id: 'find', placeholder: t('Procurar a nota…') });
  const list = h('div', { class: 'pick', id: 'pick' });
  const comment = h('textarea', { id: 'comment', rows: 2, placeholder: t('Seu comentário (opcional)') });
  const paint = () => {
    const f = q.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const hits = items.filter((i) => !f || fold(i.title + ' ' + i.text).includes(f)).slice(0, 12);
    list.replaceChildren(...(hits.length ? hits.map((i) => h('button', { type: 'button', 'aria-pressed': String(chosen === i.id), 'data-id': i.id, onclick: () => { chosen = i.id; paint(); } }, Brain.TYPES[i.type]?.icon || '📝', ' ', Brain.displayTitle(i).slice(0, 90))) : [h('p', { class: 'small muted' }, t('Nenhuma nota encontrada.'))]));
  };
  q.addEventListener('input', paint);
  const save = h('button', { class: 'btn primary', id: 'save' }, t('Juntar'));
  save.onclick = async () => {
    const it = items.find((i) => i.id === chosen);
    if (!it) { msg(t('Escolha a nota.'), 'err'); return; }
    const src = P.url ? `\n— ${P.pageTitle || hostOf(P.url)} (${P.url})` : '';
    const add = `> ${String(P.text || '').trim().replace(/\n/g, '\n> ')}${src}${comment.value.trim() ? `\n💬 ${comment.value.trim()}` : ''}`;
    await Brain.updateItem(it.id, { text: `${it.text ? it.text + '\n\n' : ''}${add}` });
    done(t('Juntado à nota.'));
  };
  $('#body').replaceChildren(h('label', { class: 'f' }, t('Trecho'), h('textarea', { class: 'quote', rows: 3, readonly: true }, P.text || '')), h('label', { class: 'f' }, t('Juntar a'), q), list,
    h('label', { class: 'f' }, t('Comentário'), comment), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => window.close() }, t('Cancelar')), save));
  paint();
  q.focus();
}

// ---------- dados extraídos (sem IA) ----------
function formExtract() {
  const x = extractData(P.text);
  const groups = [['phones', '📞 Telefones'], ['emails', '✉️ E-mails'], ['dates', '📅 Datas'], ['times', '🕒 Horários'], ['prices', '💲 Preços'], ['urls', '🔗 Endereços']];
  const rows = groups.filter(([k]) => x[k].length).map(([k, l]) => h('div', { class: 'xgroup' }, h('h3', {}, t(l)),
    ...x[k].map((v) => h('label', { class: 'xrow' }, h('input', { type: 'checkbox', checked: true, 'data-v': v }), h('span', {}, v),
      k === 'dates' ? h('button', { class: 'btn sm', type: 'button', onclick: () => { P = { ...P, kind: 'remind', text: `${v} ${x.times[0] || ''} ${P.text}`.trim() }; start(); } }, '⏰ ', t('Lembrete nesta data')) : null))));
  if (!rows.length) { $('#body').replaceChildren(h('p', { class: 'muted' }, t('Nenhum telefone, e-mail, data, horário, preço ou endereço encontrado no trecho.'))); return; }
  const picked = () => [...document.querySelectorAll('.xrow input:checked')].map((i) => i.dataset.v);
  $('#body').replaceChildren(...rows, h('p', { class: 'small muted' }, t('Lido no seu computador, sem IA.')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', id: 'copy', onclick: async () => { await navigator.clipboard.writeText(picked().join('\n')).catch(() => {}); msg('✓ ' + t('Copiado'), 'ok'); } }, '📋 ', t('Copiar')),
      h('button', { class: 'btn primary', id: 'save', onclick: async () => { const v = picked(); if (!v.length) return; await Brain.addItem({ type: 'note', title: t('Dados de') + ' ' + (P.pageTitle || hostOf(P.url) || ''), text: v.join('\n'), ...origin(), source: 'context' }); done(t('Salvo no cérebro.')); } }, t('Salvar como nota'))));
}

// ---------- imagem com anotação ----------
async function formImage() {
  const rec = P.captureId ? await getCapture(P.captureId).catch(() => null) : null;
  const img = rec?.blob ? h('img', { class: 'img-pv', alt: '', src: URL.createObjectURL(rec.blob) }) : h('p', { class: 'small warn' }, t('Não deu para mostrar a imagem, mas ela está na biblioteca.'));
  const comment = h('textarea', { id: 'comment', rows: 3, placeholder: t('O que é esta imagem? Por que guardar?') });
  const tags = h('input', { type: 'text', id: 'tags', list: 'tagsDl', placeholder: t('#etiquetas') });
  const save = h('button', { class: 'btn primary', id: 'save' }, t('Salvar'));
  save.onclick = async () => {
    await Brain.addItem({ type: 'image', title: P.pageTitle || '', text: comment.value.trim(), captureId: P.captureId, tags: tagsOf(tags.value), ...origin(), source: 'context' });
    done(t('Salvo no cérebro.'));
  };
  $('#body').replaceChildren(img, h('label', { class: 'f' }, t('Anotação'), comment), h('label', { class: 'f' }, t('Etiquetas'), tags), await tagList(),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => window.close() }, t('Cancelar')), save));
  comment.focus();
}

// ---------- IA: resumir, explicar, traduzir, resumir a página ----------
const LANGS = [['pt-BR', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'], ['de', 'Alemão'], ['it', 'Italiano'], ['ja', 'Japonês'], ['zh', 'Chinês']];

async function formAi() {
  const s = data.settings;
  const kind = P.ai;
  const body = $('#body');
  if (!isConfigured(s, 'chat')) {
    body.replaceChildren(h('p', { class: 'warn' }, t('Configure uma IA para usar esta ação.')), h('a', { class: 'btn', href: 'options.html#ia', target: '_blank' }, t('Abrir Configurações → IA')));
    return;
  }
  const cfg = aiConfig(s, 'chat');
  const cloud = cfg.where === 'cloud';
  const where = h('p', { class: 'where' }, cloud ? `☁ ${cfg.name || cfg.p?.name || ''}${cfg.model ? ' · ' + cfg.model : ''} — ${t('o texto vai para esse serviço, com a sua chave.')}` : `🔒 ${cfg.name || ''}${cfg.model ? ' · ' + cfg.model : ''} — ${t('processado no seu computador ou na sua rede.')}`);
  const target = h('select', { id: 'target' }, ...LANGS.map(([v, l]) => new Option(t(l), v)));
  target.value = LANGS.some(([v]) => v === LOCALE) ? (String(P.text).match(/[ãõçáéí]/i) && LOCALE.startsWith('pt') ? 'en' : LOCALE) : 'pt-BR';
  const out = h('div', { class: 'result', id: 'result', hidden: true });
  const actions = h('div', { class: 'actions' });
  const src = h('details', {}, h('summary', {}, t('Texto enviado'), ` (${String(P.text).length} ${t('letras')})`), h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' } }, String(P.text).slice(0, 4000)));
  let answer = '';
  const run = async () => {
    out.hidden = false;
    out.textContent = '⏳ ' + t('Pensando…');
    actions.replaceChildren();
    try {
      answer = await complete(s, { task: 'chat', system: aiPrompt(kind === 'page' ? 'page' : kind, LOCALE, kind === 'translate' ? target.selectedOptions[0].text : ''), messages: [{ role: 'user', content: String(P.text).slice(0, 24000) }], maxTokens: 1200 });
      setHTML(out, miniMarkdown(answer));
      actions.replaceChildren(
        h('button', { class: 'btn', id: 'copy', onclick: async () => { await navigator.clipboard.writeText(answer).catch(() => {}); msg('✓ ' + t('Copiado'), 'ok'); } }, '📋 ', t('Copiar')),
        h('button', { class: 'btn primary', id: 'save', onclick: async () => {
          const label = { summary: 'Resumo', explain: 'Explicação', translate: 'Tradução', page: 'Resumo' }[kind];
          await Brain.addItem({ type: 'note', title: `${t(label)}: ${(P.pageTitle || String(P.text).slice(0, 60)).trim()}`, text: kind === 'page' ? answer : `${answer}\n\n> ${String(P.text).slice(0, 1500).replace(/\n/g, '\n> ')}`, ...origin(), source: 'context' });
          done(t('Salvo no cérebro.'));
        } }, t('Salvar como nota')));
    } catch (e) {
      out.textContent = '✕ ' + t(e.message);
    }
  };
  // Primeira ida à nuvem por este caminho: pergunta antes (dá para não perguntar de novo).
  const allowed = !cloud || (s.menuCloudOk || []).includes(cfg.server || cfg.type);
  const go = h('button', { class: 'btn primary', id: 'go' }, cloud ? t('Enviar e ver') : t('Ver'));
  const remember = h('label', { class: 'small' }, h('input', { type: 'checkbox', id: 'remember' }), ' ', t('Não perguntar de novo para este serviço'));
  go.onclick = async () => {
    if (cloud && remember.querySelector('input').checked) {
      data = await loadData();
      data.settings.menuCloudOk = [...new Set([...(data.settings.menuCloudOk || []), cfg.server || cfg.type])];
      await saveData(data);
    }
    go.remove();
    remember.remove();
    run();
  };
  body.replaceChildren(where, ...(kind === 'translate' ? [h('label', { class: 'f' }, t('Traduzir para'), target)] : []), src, ...(allowed ? [] : [remember, h('div', { class: 'actions' }, go)]), out, actions);
  if (kind === 'translate') target.addEventListener('change', () => { if (!out.hidden) run(); });
  if (allowed) run();
}

function start() {
  const k = P.ai ? (P.ai === 'page' ? 'pageSummary' : P.ai) : P.kind;
  const [icon, label] = TITLES[k] || TITLES.note;
  $('#title').textContent = `${icon} ${t(label)}`;
  document.title = `NeuroTab — ${t(label)}`;
  $('#src').replaceChildren(...(P.url ? [t('De'), ': ', h('a', { href: P.url, target: '_blank', rel: 'noopener' }, P.pageTitle || hostOf(P.url))] : []));
  msg('');
  if (P.ai) return formAi();
  if (P.kind === 'join') return formJoin();
  if (P.kind === 'extract') return formExtract();
  if (P.kind === 'image') return formImage();
  return formNote();
}

async function init() {
  data = await loadData();
  initI18n(data.settings.lang);
  startIconizer();
  P = KEY ? (await chrome.storage.session.get(KEY))[KEY] : null;
  if (!P) { $('#title').textContent = t('Nada para revisar.'); return; }
  chrome.storage.session.remove(KEY).catch(() => {});
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#save')?.click(); });
  start();
}

init();
