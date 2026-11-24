// NeuroTab — Configurações → Captura → Menu do botão direito (0.9.0, #55/#56).
import { h } from './lib/ui.js';
import { t } from './lib/i18n.js';
import { saveData } from './lib/store.js';
import { ACTIONS, GROUP_LABELS, orderedActions, sanitizeMenu, actionsFor, menuPlan, DEFAULT_MENU } from './lib/menu-actions.js';

const $ = (s) => document.querySelector(s);
const CTX = { selection: 'Texto', link: 'Link', image: 'Imagem', page: 'Página', video: 'Vídeo' };
let api;
let ctxNow = 'selection';

const menu = () => sanitizeMenu(api.data().settings.menu);
async function save(m) {
  const d = api.data();
  d.settings.menu = sanitizeMenu(m);
  await saveData(d);
  paint();
  api.toast?.(t('Salvo ✓'));
}

function paint() {
  const m = menu();
  const fav = new Set(m.fav);
  const hidden = new Set(m.hidden);
  const list = orderedActions(m);
  const ids = list.map((a) => a.id);
  const move = (id, d) => {
    const i = ids.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const o = [...ids];
    [o[i], o[j]] = [o[j], o[i]];
    save({ ...m, order: o });
  };
  $('#menuActs').replaceChildren(...list.map((a, i) => h('div', { class: 'menu-act' + (hidden.has(a.id) ? ' off' : ''), role: 'listitem', 'data-id': a.id },
    h('span', { class: 'ma-move' },
      h('button', { class: 'icon-btn', title: t('Subir'), 'aria-label': t('Subir'), disabled: i === 0, onclick: () => move(a.id, -1) }, '↑'),
      h('button', { class: 'icon-btn', title: t('Descer'), 'aria-label': t('Descer'), disabled: i === list.length - 1, onclick: () => move(a.id, 1) }, '↓')),
    h('span', { class: 'ma-name' }, a.icon, ' ', t(a.label).replace('"%s"', '…'), h('small', {}, ` · ${t(GROUP_LABELS[a.group])} · ${a.contexts.filter((c) => CTX[c]).map((c) => t(CTX[c])).join(', ')}`)),
    h('button', { class: 'chip ma-fav', 'aria-pressed': String(fav.has(a.id)), title: t('Favorita: fica direto no menu'), onclick: () => save({ ...m, fav: fav.has(a.id) ? m.fav.filter((x) => x !== a.id) : [...m.fav, a.id] }) }, fav.has(a.id) ? '⭐' : '☆'),
    h('label', { class: 'sw', title: t('Mostrar no menu') }, h('input', { type: 'checkbox', checked: !hidden.has(a.id), onchange: (e) => save({ ...m, hidden: e.target.checked ? m.hidden.filter((x) => x !== a.id) : [...m.hidden, a.id] }) }), h('span')))));
  paintPreview();
}

function paintPreview() {
  const groups = api.data().groups || [];
  const plan = menuPlan(menu(), groups, t).filter((x) => x.contexts.includes(ctxNow) && x.type !== 'separator' && !x.id.startsWith('nt-g-'));
  const kids = (pid) => plan.filter((x) => x.parentId === pid);
  const tree = (pid) => h('ul', {}, ...kids(pid).map((x) => h('li', {}, x.title.replace('%s', t('trecho')), kids(x.id).length ? tree(x.id) : null)));
  $('#menuPv').replaceChildren(h('div', { class: 'small muted' }, `${actionsFor(menu(), ctxNow).length} ${t('ações aqui')}`), h('b', {}, 'NeuroTab'), tree('nt-root'));
  for (const b of document.querySelectorAll('#menuCtx [data-ctx]')) b.setAttribute('aria-pressed', String(b.dataset.ctx === ctxNow));
}

async function paintKeys() {
  const cmds = await chrome.commands?.getAll?.().catch(() => []) || [];
  const name = { _execute_action: t('Anotar ou salvar a página atual'), 'voice-command': t('Falar um comando de voz'), snip: t('Recortar área da tela') };
  $('#menuKeys').replaceChildren(...cmds.map((c) => h('div', {}, h('kbd', {}, c.shortcut || t('sem atalho')), ' ', name[c.name] || c.description || c.name)));
}

export function setupMenuOptions(a) {
  api = a;
  if (!$('#menuActs')) return;
  paint();
  paintKeys();
  for (const b of document.querySelectorAll('#menuCtx [data-ctx]')) b.addEventListener('click', () => { ctxNow = b.dataset.ctx; paintPreview(); });
  $('#menuReset').onclick = () => { if (confirm(t('Voltar o menu do botão direito ao padrão?'))) save({ ...DEFAULT_MENU }); };
  $('#menuKeysBtn').onclick = () => chrome.tabs.create({ url: navigator.userAgent.includes('Edg/') ? 'edge://extensions/shortcuts' : navigator.userAgent.includes('Firefox') ? 'about:addons' : 'chrome://extensions/shortcuts' });
  addEventListener('nt-page', (e) => { if (e.detail === 'botao-direito') paint(); });
}
export { ACTIONS };
