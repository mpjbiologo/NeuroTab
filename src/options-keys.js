// NeuroTab — Configurações → Sistema → Teclado (0.9.2.1, #75): mudar, desligar e voltar ao padrão
// os atalhos da nova aba; ver (e no Firefox, mudar) os atalhos que valem em qualquer aba.
// Também: Configurações → Nova aba → Páginas (lista e opções das páginas de widgets).
import { h } from './lib/ui.js';
import { t } from './lib/i18n.js';
import { saveData } from './lib/store.js';
import { HOTKEY_ACTIONS, effectiveHotkeys, comboFromEvent, conflictsFor, sanitizeHotkeys, RESERVED, KNOWN_APPS } from './lib/hotkeys.js';
import { hasPages, renamePage, movePage, removePage, addPage, MAX_PAGES } from './lib/pages.js';

const $ = (s) => document.querySelector(s);
let api;
const st = () => api.data().settings;
async function save(msg = 'Salvo ✓') { await saveData(api.data()); api.toast(msg); }
const isFirefox = () => navigator.userAgent.includes('Firefox');
const CMD_NAME = { 'voice-command': 'Comando de voz (abre a NeuroTab ouvindo)', 'quick-note': 'Anotar ou salvar a página atual', snip: 'Recortar uma área da tela', _execute_action: 'Abrir o pop-up da NeuroTab', _execute_browser_action: 'Abrir o pop-up da NeuroTab' };

// Grava a próxima combinação. Esc cancela; Backspace/Delete desliga.
function capture(btn, { digits = false } = {}) {
  return new Promise((resolve) => {
    document.body.classList.add('hk-capturing');
    const old = btn.textContent;
    btn.textContent = digits ? t('Segure Ctrl/Alt/Shift e aperte um número…') : t('Pressione as teclas…');
    btn.classList.add('rec');
    const done = (v) => {
      removeEventListener('keydown', fn, true);
      document.body.classList.remove('hk-capturing');
      btn.classList.remove('rec');
      btn.textContent = old;
      resolve(v);
    };
    const fn = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return done(null);
      if (e.key === 'Backspace' || e.key === 'Delete') return done('');
      const c = comboFromEvent(e);
      if (!c) return; // só um modificador: espera a tecla
      if (digits) {
        const m = c.match(/^(.+)\+([0-9])$/);
        if (!m || !/(Ctrl|Alt)/.test(m[1])) return; // precisa de modificador + número
        return done(m[1]);
      }
      done(c);
    };
    addEventListener('keydown', fn, true);
  });
}

function paintKeys() {
  const box = $('#hkList');
  if (!box) return;
  const custom = st().hotkeys || {};
  const eff = effectiveHotkeys(custom);
  box.replaceChildren(...HOTKEY_ACTIONS.map((a) => {
    const v = eff[a.id];
    const shown = a.digits ? (v ? `${v}+1…9` : '') : v;
    const warns = a.digits ? (v ? conflictsFor(a.id, `${v}+1`, custom) : []) : conflictsFor(a.id, v, custom);
    const changed = a.id in custom;
    const rec = h('button', { class: 'btn', 'data-hk': a.id, onclick: async () => {
      const c = await capture(rec, { digits: a.digits });
      if (c === null) return;
      st().hotkeys = sanitizeHotkeys({ ...custom, [a.id]: c });
      if (!a.digits && c && c === a.def) delete st().hotkeys[a.id];
      await save(c ? `${a.label}: ${a.digits ? c + '+1…9' : c}` : `${a.label}: ${t('desligado')}`);
      paintKeys();
    } }, t('Mudar'));
    return h('div', { class: 'opt hk-row', 'data-action': a.id },
      h('div', {}, h('b', {}, a.label),
        h('small', {}, h('kbd', { class: v ? '' : 'off' }, shown || t('desligado')), changed ? ` · ${t('padrão')}: ${a.def}` : ''),
        ...warns.map((w) => h('small', { class: 'hk-warn ' + w.kind }, '⚠ ', w.text))),
      h('div', { class: 'keybox' }, rec,
        v ? h('button', { class: 'btn', title: t('Desligar'), 'data-off': a.id, onclick: async () => { st().hotkeys = { ...custom, [a.id]: '' }; await save(); paintKeys(); } }, t('Desligar')) : null,
        changed ? h('button', { class: 'btn', 'data-reset': a.id, onclick: async () => { const c = { ...custom }; delete c[a.id]; st().hotkeys = c; await save(); paintKeys(); } }, t('Padrão')) : null));
  }));
}

async function paintCommands() {
  const box = $('#hkGlobal');
  if (!box) return;
  const cmds = (await chrome.commands.getAll().catch(() => [])).filter((c) => c.name);
  const ff = isFirefox() && chrome.commands.update;
  box.replaceChildren(...cmds.map((c) => {
    const btn = ff ? h('button', { class: 'btn', onclick: async () => {
      const v = await capture(btn);
      if (v === null) return;
      try {
        if (v) await chrome.commands.update({ name: c.name, shortcut: v });
        else await chrome.commands.reset(c.name);
        api.toast(t('Atalho atualizado.'));
      } catch (e) { api.toast(t('O navegador não aceitou: ') + (e.message || e)); }
      paintCommands();
    } }, t('Mudar')) : null;
    const warn = c.shortcut && (RESERVED[c.shortcut] || KNOWN_APPS[c.shortcut]);
    return h('div', { class: 'opt' }, h('div', {}, h('b', {}, t(CMD_NAME[c.name] || c.description || c.name)),
      h('small', {}, h('kbd', { class: c.shortcut ? '' : 'off' }, c.shortcut || t('sem atalho'))),
      warn ? h('small', { class: 'hk-warn app' }, '⚠ ', t('costuma ser usado por: '), warn) : null), h('div', { class: 'keybox' }, btn));
  }));
  $('#hkBrowserBtn').hidden = !!ff;
}

// ── Páginas ─────────────────────────────────────────────────────────────────
function paintPages() {
  const box = $('#pagesList');
  if (!box) return;
  const s = st();
  if (!hasPages(s)) {
    box.replaceChildren(h('p', { class: 'hint' }, t('Você tem uma página só. Crie outras aqui ou na nova aba, no modo de edição (🧩 → ＋ Página).')),
      h('button', { class: 'btn', id: 'pagesAdd', onclick: async () => { addPage(s, { name: prompt(t('Nome da nova página:'), '') || '' }); await save(t('Página criada.')); paintPages(); } }, t('＋ Nova página')));
    return;
  }
  box.replaceChildren(...s.pages.map((p, i) => {
    const name = h('input', { type: 'text', class: 'txt', value: p.name, maxlength: 30, 'aria-label': t('Nome da página'), style: { minWidth: '0', width: '180px' } });
    const icon = h('input', { type: 'text', class: 'txt', value: p.icon, maxlength: 8, placeholder: '🙂', 'aria-label': t('Emoji'), style: { minWidth: '0', width: '60px' } });
    const ren = async () => { renamePage(s, p.id, { name: name.value, icon: icon.value }); await save(); };
    name.addEventListener('change', ren);
    icon.addEventListener('change', ren);
    const n = p.id === s.page ? s.widgets.length : p.widgets.length;
    return h('div', { class: 'opt', 'data-pg': p.id }, h('div', { class: 'row', style: { gap: '6px' } }, h('b', {}, `${i + 1}.`), icon, name, h('small', {}, `${n} widget(s)${p.id === s.page ? ' · ' + t('aberta agora') : ''}`)),
      h('div', { class: 'keybox' },
        h('button', { class: 'btn', title: t('Para a esquerda'), disabled: i === 0, onclick: async () => { movePage(s, p.id, -1); await save(); paintPages(); } }, '◀'),
        h('button', { class: 'btn', title: t('Para a direita'), disabled: i === s.pages.length - 1, onclick: async () => { movePage(s, p.id, 1); await save(); paintPages(); } }, '▶'),
        h('button', { class: 'btn danger-btn', title: t('Apagar'), onclick: async () => {
          if (!confirm(t(`Apagar a página "${p.name}"?`))) return;
          const keep = n ? confirm(t(`Mover os ${n} widget(s) para a primeira página? (Cancelar apaga os widgets junto.)`)) : false;
          removePage(s, p.id, { keepWidgets: keep });
          await save(t('Página apagada.'));
          paintPages();
        } }, '🗑')));
  }), h('button', { class: 'btn', id: 'pagesAdd', disabled: s.pages.length >= MAX_PAGES, onclick: async () => { addPage(s, { name: prompt(t('Nome da nova página:'), '') || '' }); await save(t('Página criada.')); paintPages(); } }, t('＋ Nova página')));
}

export function setupKeysAndPages(a) {
  api = a;
  const paint = (page) => {
    if (page === 'teclado') { paintKeys(); paintCommands(); }
    if (page === 'paginas') paintPages();
  };
  paint(location.hash.slice(1));
  addEventListener('nt-page', (e) => paint(e.detail));
  $('#hkResetAll')?.addEventListener('click', async () => { if (!confirm(t('Voltar todos os atalhos ao padrão?'))) return; st().hotkeys = {}; await save(); paintKeys(); });
  $('#hkBrowserBtn')?.addEventListener('click', () => chrome.tabs.create({ url: navigator.userAgent.includes('Edg/') ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' }));
}
