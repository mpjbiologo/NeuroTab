// NeuroTab — detalhes de um item "Mídia" na janela do item (#67): plataforma, categoria, pontos-chave,
// legenda e transcrição, e as ações Resumir/Reprocessar, Abrir original e Exportar nota (.md, formato do Obsidian).
import { h, toast } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { updateItem } from '../lib/brain.js';
import { isLocalAI } from '../lib/ai.js';
import { PLATFORMS } from '../lib/media-links.js';
import { sanitizeMediaSave, noteMarkdown, notePath, CONTENT_LABEL } from '../lib/media.js';
import { S } from './state.js';

export function mediaPanel(box, it, close) {
  if (!it) { box.hidden = true; box.replaceChildren(); return; }
  const m = it.media || {};
  const cfg = sanitizeMediaSave(S.data.settings.mediaSave);
  const plat = PLATFORMS[m.platform] || PLATFORMS.web;
  const cat = h('select', { class: 'small', title: t('Categoria'), onchange: async () => { await updateItem(it.id, { media: { ...m, category: cat.value } }); m.category = cat.value; toast('Categoria trocada'); } },
    new Option(t('Sem categoria'), ''), ...Object.keys(cfg.categories).map((c) => new Option(c, c)));
  cat.value = m.category || '';
  const cloud = m.error === 'cloud';
  const status = m.status === 'processado'
    ? h('small', { class: 'muted' }, `✓ ${t('Resumido por')} ${m.ai || 'IA'}`)
    : h('small', { class: 'warn' }, '⏳ ', cloud ? t('Resumo pendente: a IA configurada é na internet. Clique em Resumir para enviar a legenda e o texto deste item.') : m.error ? t(m.error) : t('Resumo pendente.'));
  const run = async (allowCloud) => {
    btn.disabled = true;
    btn.textContent = '⏳ ' + t('Resumindo…');
    const r = await chrome.runtime.sendMessage({ type: 'media:summarize', id: it.id, allowCloud }).catch((e) => ({ error: e.message }));
    if (r?.ok) { toast('Resumo pronto 🎬'); close(); } else { toast(t('Não deu para resumir:') + ' ' + (r?.error === 'cloud' ? t('autorize a IA na internet') : r?.error || '')); btn.disabled = false; btn.textContent = label; }
  };
  const label = m.status === 'processado' ? '↻ ' + t('Reprocessar') : '✨ ' + t('Resumir');
  const btn = h('button', { type: 'button', class: 'chip', onclick: () => {
    const needAsk = !isLocalAI(S.data.settings) && !cfg.cloudOK;
    if (needAsk && !confirm(t('A IA configurada é na internet. A legenda e o texto deste item vão para ela para gerar o resumo. Continuar?'))) return;
    run(needAsk);
  } }, label);
  const exp = h('button', { type: 'button', class: 'chip', title: t('Nota no formato do Obsidian'), onclick: () => {
    const { file } = notePath(it);
    const a = h('a', { href: URL.createObjectURL(new Blob([noteMarkdown(it)], { type: 'text/markdown' })), download: file });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } }, '⬇ .md');
  box.replaceChildren(...[
    h('div', { class: 'im-head' },
      h('span', { class: 'im-plat' }, `${plat.icon} ${plat.label}`),
      m.author ? h('span', {}, m.author) : null,
      m.published ? h('span', { class: 'muted' }, m.published) : null,
      h('span', { class: 'grow' }),
      cat),
    status,
    m.points?.length ? h('div', {}, h('b', {}, t('Pontos-chave')), h('ul', { class: 'im-points' }, ...m.points.map((p) => h('li', {}, p)))) : null,
    m.caption ? h('details', {}, h('summary', {}, t('Legenda original')), h('p', { class: 'im-text' }, m.caption)) : null,
    m.content ? h('details', {}, h('summary', {}, t(CONTENT_LABEL[m.contentType] || 'Conteúdo')), h('p', { class: 'im-text' }, m.content)) : null,
    h('div', { class: 'toolbar' }, btn, h('a', { class: 'chip', href: it.url, target: '_blank', rel: 'noopener' }, '↗ ', t('Abrir original')), exp)].filter(Boolean));
  box.hidden = false;
}
