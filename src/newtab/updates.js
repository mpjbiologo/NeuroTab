// NeuroTab — Aviso de versão nova e janela de novidades.
import { $, h } from '../lib/ui.js';
import { UPDATE_KEY, WHATSNEW_KEY, cmpVersion } from '../lib/update.js';
import { WHATS_NEW } from '../whatsnew.js';
import { LANG } from '../lib/i18n.js';
import { S } from './state.js';

// =====================================================================
// ATUALIZAÇÕES E NOVIDADES
// =====================================================================
export async function setupUpdates() {
  const paint = async () => {
    const u = (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY];
    const bar = $('#updateBar');
    const cur = chrome.runtime.getManifest().version;
    if (!u || !u.latest || cmpVersion(u.latest, cur) <= 0 || u.dismissed === u.latest || S.data.settings.checkUpdates === false) { bar.hidden = true; return; }
    bar.replaceChildren(
      h('span', {}, '🎉'),
      h('b', {}, `NeuroTab ${u.latest} disponível`),
      h('span', { class: 'muted' }, `(você usa a ${cur})`),
      h('span', { class: 'grow' }),
      h('a', { class: 'btn', href: u.url, target: '_blank' }, '📄 Novidades'),
      h('a', { class: 'btn primary', href: u.zip, target: '_blank' }, '⬇ Baixar'),
      h('button', { class: 'btn', title: 'Como atualizar', onclick: () => alert('Como atualizar:\n\n1. Baixe e descompacte o neurotab.zip.\n2. Substitua os arquivos na pasta onde a NeuroTab está instalada.\n3. Abra edge://extensions e clique em ↻ (Recarregar) na NeuroTab.\n\nSeus atalhos, notas e configurações são mantidos.') }, '❓'),
      h('button', { class: 'btn', title: 'Dispensar', onclick: async () => { await chrome.storage.local.set({ [UPDATE_KEY]: { ...u, dismissed: u.latest } }); bar.hidden = true; } }, '✕'),
    );
    bar.hidden = false;
  };
  paint();
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c[UPDATE_KEY]) paint(); });

  // Novidades após atualizar
  const v = (await chrome.storage.local.get(WHATSNEW_KEY))[WHATSNEW_KEY];
  const entry = v && WHATS_NEW[v];
  const news = entry && (entry.items ? entry : entry[LANG] || entry.pt);
  if (news) {
    $('#newsTitle').textContent = news.title;
    $('#newsList').replaceChildren(...news.items.map(([i, t, d]) => h('div', {}, h('span', { class: 'ni' }, i), h('div', {}, h('b', {}, t), h('span', {}, d)))));
    $('#newsDlg').showModal();
    await chrome.storage.local.remove(WHATSNEW_KEY);
  }
}
