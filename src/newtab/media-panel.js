// NeuroTab — detalhes de um item "Mídia" na janela do item (#67): plataforma, categoria, pontos-chave,
// legenda e transcrição, e as ações Resumir/Reprocessar, Abrir original e Exportar nota (.md, formato do Obsidian).
import { h, toast } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { updateItem } from '../lib/brain.js';
import { isLocalAI } from '../lib/ai.js';
import { modelChip } from '../lib/ai-ui.js';
import { PLATFORMS } from '../lib/media-links.js';
import { sanitizeMediaSave, noteMarkdown, notePath, CONTENT_LABEL } from '../lib/media.js';
import { S } from './state.js';
import { sanitizeMediaDl, canDownload, DL_ORIGINS, DL_ERRORS, DL_STATE_KEY } from '../lib/media-download.js';
import { requestAccess } from '../lib/permissions.js';

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
  const chip = modelChip(() => S.data.settings, 'media');
  const run = async (allowCloud, allowCloudReserve = false) => {
    btn.disabled = true;
    btn.textContent = '⏳ ' + t('Resumindo…');
    const r = await chrome.runtime.sendMessage({ type: 'media:summarize', id: it.id, allowCloud, allowCloudReserve, override: chip.override() }).catch((e) => ({ error: e.message }));
    if (r?.ok) { toast('Resumo pronto 🎬'); close(); return; }
    btn.disabled = false;
    btn.textContent = label;
    if (r?.error === 'reserve' && confirm(`${t(r.message || '')}\n\n${t('Usar a Reserva só desta vez?')}`)) { run(allowCloud, true); return; }
    toast(t('Não deu para resumir:') + ' ' + (r?.error === 'cloud' ? t('autorize a IA na internet') : r?.error === 'reserve' ? t('a IA principal não respondeu') : t(r?.error || '')));
  };
  const label = m.status === 'processado' ? '↻ ' + t('Reprocessar') : '✨ ' + t('Resumir');
  const btn = h('button', { type: 'button', class: 'chip', onclick: () => {
    const needAsk = !isLocalAI(S.data.settings, 'media', { override: chip.override() }) && !cfg.cloudOK;
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
    h('div', { class: 'toolbar' }, btn, chip.el, h('a', { class: 'chip', href: it.url, target: '_blank', rel: 'noopener' }, '↗ ', t('Abrir original')), exp),
    canDownload(it) ? downloadBox(it) : m.platform === 'youtube' ? h('small', { class: 'muted' }, '⬇ ', t('O YouTube não permite baixar vídeos por extensões.')) : null].filter(Boolean));
  box.hidden = false;
}

// ---------- Baixar o vídeo (0.7.11) ----------
const OPTIONS_MEDIA = () => chrome.runtime.getURL('src/options.html#salvar-midia');

function downloadBox(it) {
  const wrap = h('div', { class: 'im-dl' });
  let dl = it.media?.download || null;
  let stop = null;
  const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ error: e.message }));
  const cfg = () => sanitizeMediaDl(S.data.settings.mediaDl);

  const paint = (st = null, note = null) => {
    if (st?.state === 'running') {
      const txt = st.stage === 'merge' ? t('Juntando áudio e vídeo…') : st.stage === 'find' ? t('Procurando o vídeo…') : `${t('Baixando')} ${Math.round(st.pct || 0)}%${st.sizeText ? ` ${t('de')} ${st.sizeText}` : st.size ? ` ${t('de')} ${(st.size / 1048576).toFixed(1).replace('.', ',')} MB` : ''}${st.via === 'ponte' ? ' · Ponte' : ''}`;
      wrap.replaceChildren(
        h('span', { class: 'im-dl-bar' }, h('i', { style: { width: `${Math.max(3, st.pct || 0)}%` } })),
        h('small', {}, '⬇ ', txt),
        h('button', { type: 'button', class: 'chip', onclick: () => send({ type: 'media:download-cancel', id: it.id }) }, t('Cancelar')));
      return;
    }
    const kids = [];
    if (dl) {
      kids.push(h('small', { class: 'ok' }, '✓ ', t('Vídeo baixado'), dl.via === 'ponte' ? ' (Ponte)' : ''),
        h('button', { type: 'button', class: 'chip', onclick: () => reveal(false) }, '📁 ', t('Mostrar na pasta')),
        dl.via === 'ponte' ? h('button', { type: 'button', class: 'chip', onclick: () => reveal(true) }, '▶ ', t('Abrir')) : null,
        h('button', { type: 'button', class: 'chip', title: t('Baixar de novo'), onclick: () => start() }, '↻'));
    } else kids.push(h('button', { type: 'button', class: 'chip primary', onclick: () => start() }, '⬇ ', t('Baixar vídeo')));
    if (note) kids.push(note);
    wrap.replaceChildren(...kids.filter(Boolean));
  };

  async function reveal(open) {
    const r = await send({ type: 'media:reveal', id: it.id, open });
    if (r?.error) toast(t(r.error));
  }

  function watch() {
    const on = (ch, area) => { if (area === 'session' && ch[DL_STATE_KEY]) { const st = ch[DL_STATE_KEY].newValue?.[it.id]; if (st?.state === 'running') paint(st); } };
    chrome.storage.onChanged.addListener(on);
    stop = () => chrome.storage.onChanged.removeListener(on);
  }

  async function start(via = null) {
    const c = cfg();
    // permissões pedidas aqui, no clique (o service worker não pode perguntar)
    if (!via && c.engine !== 'ponte') {
      const ok = await requestAccess({ permissions: ['downloads'], origins: DL_ORIGINS[it.media.platform] || [] });
      if (!ok && c.engine === 'browser') { toast('Sem a permissão de downloads, não dá para baixar.'); return; }
    }
    if (via === 'ponte' || c.engine === 'ponte') {
      const perms = ['nativeMessaging', ...(c.cookies ? ['cookies'] : [])];
      if (!(await requestAccess({ permissions: perms, origins: c.cookies ? DL_ORIGINS[it.media.platform] || [] : [] }))) { toast('Sem a permissão, a NeuroTab Ponte não pode baixar.'); paint(); return; }
    }
    paint({ state: 'running', stage: 'find', pct: 0 });
    watch();
    const r = await send({ type: 'media:download', id: it.id, via });
    stop?.();
    if (r?.ok) { dl = r.download; it.media.download = dl; paint(); toast('⬇ Vídeo baixado'); return; }
    if (r?.need === 'ponte') {
      paint(null, h('div', { class: 'im-dl-note' },
        h('small', {}, t('Este vídeo vem com o áudio separado (ou o site não entrega o arquivo). A NeuroTab Ponte baixa com o yt-dlp e junta tudo num .mp4.')),
        h('button', { type: 'button', class: 'chip', onclick: () => start('ponte') }, '🔌 ', t('Baixar pela Ponte'))));
      return;
    }
    const code = r?.code;
    const msg = r?.error || DL_ERRORS[code] || t('Não deu para baixar.');
    paint(null, h('div', { class: 'im-dl-note' }, h('small', { class: code === 'canceled' ? 'muted' : 'warn' }, t(msg)),
      ['notools', 'missing', 'old', 'login'].includes(code) ? h('a', { class: 'chip', href: OPTIONS_MEDIA(), target: '_blank' }, '⚙️ ', t('Configurar')) : null));
  }

  paint();
  chrome.storage.session.get(DL_STATE_KEY).then((r) => { const st = r?.[DL_STATE_KEY]?.[it.id]; if (st?.state === 'running' && Date.now() - st.at < 60000) { paint(st); watch(); } }).catch(() => {});
  return wrap;
}
