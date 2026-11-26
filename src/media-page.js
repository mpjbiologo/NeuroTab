// NeuroTab — Biblioteca de mídias (0.9.3.1, #45): imagens da biblioteca, posts e vídeos salvos e o que foi
// baixado para o computador, numa tela só. As imagens ficam no navegador (IndexedDB); vídeos, áudios e fotos
// baixados ficam na pasta Downloads, nas pastas de Configurações → Mídia.
import { h, toast } from './lib/ui.js';
import { loadData } from './lib/store.js';
import { initI18n, t } from './lib/i18n.js';
import { startIconizer } from './lib/icons.js';
import { loadItems, trashItems, displayTitle } from './lib/brain.js';
import { listCaptures, deleteCapture } from './lib/image-index.js';
import { PLATFORMS } from './lib/media-links.js';
import { sanitizeMediaDl, canDownload, canDownloadAudio, canDownloadPhotos, dlKey, DL_ERRORS, DL_STATE_KEY } from './lib/media-download.js';
import { dlSiteOf, safeFileName } from './lib/media-sites.js';
import { requestAccess } from './lib/permissions.js';
import { startMediaDownload, revealMedia, cancelMedia } from './lib/media-dl-client.js';

const $ = (s) => document.querySelector(s);
const OPTIONS_MEDIA = () => chrome.runtime.getURL('src/options.html#salvar-midia');
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString() : '');
const fmtMB = (n) => (n ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : '');
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };

let data;
let tab = ['tudo', 'imagens', 'posts', 'arquivos'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'tudo';
let q = '';
let cat = '';
let images = [];
let posts = [];
let urls = [];
const selected = new Set();
const progress = new Map(); // chave do download → estado

const cfg = () => sanitizeMediaDl(data.settings.mediaDl);
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function load() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  data = await loadData();
  const [caps, items] = await Promise.all([listCaptures().catch(() => []), loadItems()]);
  images = caps.map((rec) => ({ kind: 'image', id: rec.id, at: rec.capturedAt || 0, rec, title: rec.pageTitle || rec.fileName || t('Imagem'), hay: fold([rec.fileName, rec.pageTitle, rec.url, rec.pageUrl, rec.text, rec.description].join(' ')) }));
  posts = items.filter((it) => it.type === 'media').map((it) => ({ kind: 'post', id: it.id, at: it.createdAt || 0, it, title: displayTitle(it), hay: fold([it.title, it.pageTitle, it.url, it.summary, it.media?.caption, it.media?.category, it.media?.author, (it.tags || []).join(' ')].join(' ')) }));
  paintCats();
  render();
}

function paintCats() {
  const cats = [...new Set(posts.map((p) => p.it.media?.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (cat && !cats.includes(cat)) cat = '';
  $('#cat').replaceChildren(new Option(t('Todas as categorias'), ''), ...cats.map((c) => new Option(c, c)));
  $('#cat').value = cat;
  $('#cat').hidden = !cats.length || tab === 'imagens';
}

const hasFiles = (it) => !!(it.media?.download || it.media?.audio || it.media?.photos);

function entries() {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  const match = (e) => terms.every((x) => e.hay.includes(x));
  let list = [];
  if (tab === 'tudo' || tab === 'imagens') list.push(...images);
  if (tab === 'tudo' || tab === 'posts') list.push(...posts);
  if (tab === 'arquivos') list = posts.filter((p) => hasFiles(p.it));
  if (cat) list = list.filter((e) => e.kind === 'post' && e.it.media?.category === cat);
  return list.filter(match).sort((a, b) => b.at - a.at);
}

function render() {
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  $('#cat').hidden = tab === 'imagens' || $('#cat').options.length <= 1;
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  const list = entries();
  const c = cfg();
  $('#count').textContent = `${list.length} ${t(list.length === 1 ? 'item' : 'itens')}`;
  $('#folders').replaceChildren(t('Pastas em Downloads:'), ' ', h('b', {}, c.folder), ' · ', h('b', {}, c.imageFolder), ' · ', h('b', {}, c.audioFolder), ' · ', h('a', { href: OPTIONS_MEDIA(), target: '_blank' }, t('Alterar')));
  const imgsShown = list.filter((e) => e.kind === 'image');
  $('#saveSel').hidden = !selected.size;
  $('#saveSel').textContent = `⬇ ${t('Salvar as selecionadas')} (${selected.size})`;
  $('#selAll').hidden = !imgsShown.length;
  if (!list.length) {
    $('#grid').replaceChildren(h('div', { class: 'empty' }, q || cat ? t('Nada encontrado com esse filtro.')
      : tab === 'arquivos' ? t('Nada baixado ainda. Nos posts e vídeos salvos, use ⬇ Vídeo, 🎧 Áudio ou 🖼 Fotos.')
        : t('Sua biblioteca está vazia. Salve imagens pelo botão direito (NeuroTab → Salvar imagem na biblioteca) e posts ou vídeos com "Salvar no cérebro com resumo".')));
    return;
  }
  $('#grid').replaceChildren(...list.slice(0, 400).map((e) => (e.kind === 'image' ? imageCard(e) : postCard(e))));
}

// ---------- imagens ----------
function imageCard(e) {
  const rec = e.rec;
  const url = URL.createObjectURL(rec.blob);
  urls.push(url);
  const pick = h('input', { type: 'checkbox', class: 'pick', title: t('Selecionar'), checked: selected.has(rec.id), onchange: () => { if (pick.checked) selected.add(rec.id); else selected.delete(rec.id); card.classList.toggle('sel', pick.checked); render(); } });
  const card = h('article', { class: 'card' + (selected.has(rec.id) ? ' sel' : ''), 'data-id': rec.id },
    h('div', { class: 'thumb' }, h('a', { href: url, target: '_blank', rel: 'noopener', title: t('Abrir imagem') }, h('img', { src: url, alt: rec.fileName || t('Imagem salva'), loading: 'lazy' })), pick, h('span', { class: 'kind' }, '🖼')),
    h('div', { class: 'body' },
      h('b', {}, rec.fileName || t('Imagem')),
      h('div', { class: 'meta' }, h('span', {}, fmtDate(rec.capturedAt)), h('span', {}, fmtMB(rec.size)), rec.pageUrl || rec.url ? h('a', { href: rec.pageUrl || rec.url, target: '_blank', rel: 'noopener noreferrer', title: rec.pageTitle || '' }, hostOf(rec.pageUrl || rec.url)) : null)),
    h('div', { class: 'acts' },
      h('button', { class: 'btn sm', type: 'button', title: t('Ler o texto, descrever e perguntar sobre a imagem'), onclick: () => chrome.windows.create({ url: chrome.runtime.getURL('src/analyze.html?id=' + encodeURIComponent(rec.id)), type: 'popup', width: 560, height: 760 }) }, '🔍 ', t('Analisar')),
      h('button', { class: 'btn sm', type: 'button', title: t('Salvar na pasta de imagens do computador'), onclick: () => saveImages([rec]) }, '⬇ ', t('Salvar')),
      h('button', { class: 'btn sm danger', type: 'button', title: t('Excluir imagem'), onclick: async () => {
        if (!confirm(t('Excluir esta imagem da biblioteca? O que o cérebro leu dela também sai.'))) return;
        await deleteCapture(rec.id);
        selected.delete(rec.id);
        chrome.runtime.sendMessage({ type: 'imageDeleted', id: rec.id }).catch(() => {});
        await load();
      } }, '🗑')));
  return card;
}

/** Salva imagens da biblioteca na pasta escolhida (dentro de Downloads). Nome repetido: o navegador numera. */
async function saveImages(recs) {
  if (!(await requestAccess({ permissions: ['downloads'] }))) { toast(t('Sem a permissão de downloads, não dá para salvar no computador.')); return; }
  const dir = cfg().imageFolder;
  let ok = 0;
  let fail = '';
  for (const rec of recs) {
    const url = URL.createObjectURL(rec.blob);
    const base = safeFileName(String(rec.fileName || rec.pageTitle || 'imagem').replace(/\.[a-z0-9]{2,5}$/i, ''), 80);
    const ext = EXT[rec.blob?.type] || (String(rec.fileName || '').match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'png').toLowerCase();
    try {
      await chrome.downloads.download({ url, filename: `${dir}/${base}.${ext}`, conflictAction: 'uniquify' })
        .catch((e) => (/invalid filename/i.test(e?.message) ? chrome.downloads.download({ url, filename: `${dir}/imagem.${ext}`, conflictAction: 'uniquify' }) : Promise.reject(e)));
      ok++;
    } catch (e) { fail = e.message; }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  toast(fail && !ok ? `${t('Não deu para salvar')}: ${fail}` : `⬇ ${ok} ${t(ok === 1 ? 'imagem salva em' : 'imagens salvas em')} Downloads/${dir}${fail ? ` · ${t('algumas falharam')}` : ''}`);
}

// ---------- posts e vídeos ----------
const WHAT = { video: ['⬇', 'Vídeo', 'download'], audio: ['🎧', 'Áudio', 'audio'], photos: ['🖼', 'Fotos', 'photos'] };

function postCard(e) {
  const it = e.it;
  const m = it.media || {};
  const plat = PLATFORMS[m.platform] || PLATFORMS.web;
  const site = dlSiteOf(it.url || '');
  const st = h('div', { class: 'st', role: 'status' });
  const files = h('div', { class: 'files' });
  const acts = h('div', { class: 'acts' });
  const paint = () => {
    files.replaceChildren(...Object.entries(WHAT).filter(([, w]) => m[w[2]]).map(([what, w]) => {
      const rec = m[w[2]];
      return h('span', { title: rec.file || (rec.files || []).join('\n') || '' }, `✓ ${t(w[1])}${what === 'photos' && rec.count ? ` (${rec.count})` : ''}`);
    }));
    const running = Object.keys(WHAT).find((w) => progress.get(dlKey(it.id, w))?.state === 'running');
    const btns = [];
    if (it.url) btns.push(h('a', { class: 'btn sm', href: it.url, target: '_blank', rel: 'noopener noreferrer', title: t('Abrir o original') }, '🔗'));
    if (running) {
      const p = progress.get(dlKey(it.id, running));
      st.className = 'st';
      st.textContent = `${WHAT[running][0]} ${p.stage === 'find' ? t('Procurando…') : p.stage === 'merge' ? t('Juntando áudio e vídeo…') : `${t('Baixando')} ${Math.round(p.pct || 0)}%`}${p.via === 'ponte' ? ' · Ponte' : ''}`;
      btns.push(h('button', { class: 'btn sm', type: 'button', onclick: () => cancelMedia(dlKey(it.id, running)) }, t('Cancelar')));
    } else {
      const can = { video: canDownload(it), audio: canDownloadAudio(it), photos: canDownloadPhotos(it) };
      for (const [what, w] of Object.entries(WHAT)) {
        if (!can[what]) continue;
        const rec = m[w[2]];
        btns.push(rec
          ? h('button', { class: 'btn sm ok', type: 'button', title: t('Mostrar na pasta'), onclick: async () => { const r = await revealMedia(it.id, what); if (r?.error) toast(t(r.error)); } }, '📁 ', t(w[1]))
          : h('button', { class: 'btn sm', type: 'button', title: t(what === 'audio' ? 'Baixar só o áudio' : what === 'photos' ? 'Baixar as fotos do post' : 'Baixar o vídeo'), onclick: () => start(what) }, `${w[0]} `, t(w[1])));
      }
      if (!can.video && !can.audio && !can.photos) {
        st.className = 'st';
        st.textContent = site.code === 'youtube' ? t('O YouTube não permite baixar vídeos por extensões.') : site.code === 'drm' ? t(DL_ERRORS.drm) : '';
      }
    }
    btns.push(h('button', { class: 'btn sm danger', type: 'button', title: t('Mandar para a lixeira do cérebro (30 dias)'), onclick: async () => {
      if (!confirm(t('Mandar este item para a lixeira? Os arquivos já baixados continuam na pasta.'))) return;
      await trashItems([it.id]);
      await load();
    } }, '🗑'));
    acts.replaceChildren(...btns);
  };
  async function start(what, via = null) {
    st.className = 'st';
    st.textContent = t('Procurando…');
    const r = await startMediaDownload(it, what, data.settings.mediaDl, { via });
    if (r?.ok) {
      m[WHAT[what][2]] = r.download;
      st.textContent = '';
      paint();
      toast(`${WHAT[what][0]} ${t('Pronto')}: ${t(WHAT[what][1])}`);
      return;
    }
    if (r?.need === 'ponte') {
      st.className = 'st';
      st.replaceChildren(t('Precisa da NeuroTab Ponte (yt-dlp).'), ' ', h('button', { class: 'btn sm', type: 'button', onclick: () => start(what, 'ponte') }, '🔌 ', t('Baixar pela Ponte')));
      return;
    }
    st.className = r?.code === 'canceled' ? 'st' : 'st err';
    st.textContent = t(r?.error || DL_ERRORS[r?.code] || 'Não deu para baixar.');
    paint();
  }
  const card = h('article', { class: 'card', 'data-id': it.id },
    h('div', { class: 'thumb icon' }, h('span', { class: 'big' }, plat.icon || '🎬'), h('span', { class: 'kind' }, m.platform && m.platform !== 'web' ? plat.label : site.label || hostOf(it.url) || plat.label)),
    h('div', { class: 'body' },
      h('b', { title: e.title }, e.title),
      h('div', { class: 'meta' }, h('span', {}, fmtDate(it.createdAt)), m.author ? h('span', {}, m.author) : null, m.category ? h('span', {}, '· ' + m.category) : null, h('span', {}, '· ' + hostOf(it.url))),
      it.summary || m.caption ? h('div', { class: 'sum' }, it.summary || m.caption) : null,
      files, st),
    acts);
  card._paint = paint;
  paint();
  return card;
}

// Andamento dos downloads (mesmo quando começou em outra aba)
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'session' && ch[DL_STATE_KEY]) {
    progress.clear();
    for (const [k, v] of Object.entries(ch[DL_STATE_KEY].newValue || {})) progress.set(k, v);
    for (const c of document.querySelectorAll('.card[data-id]')) c._paint?.();
  }
  if (area === 'local' && (ch.nt_brain || ch.nt_data)) { clearTimeout(load.t); load.t = setTimeout(load, 500); }
});
chrome.runtime.onMessage.addListener((m) => { if (['imageCaptured', 'imageDeleted'].includes(m?.type)) { clearTimeout(load.t); load.t = setTimeout(load, 400); } });

async function init() {
  data = await loadData();
  initI18n(data.settings.lang);
  startIconizer();
  $('#tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    history.replaceState(null, '', '#' + tab);
    render();
  });
  let tm;
  $('#q').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { q = $('#q').value; render(); }, 150); });
  $('#cat').addEventListener('change', () => { cat = $('#cat').value; render(); });
  $('#saveSel').addEventListener('click', () => saveImages(images.filter((e) => selected.has(e.id)).map((e) => e.rec)));
  $('#selAll').addEventListener('click', () => { for (const e of entries()) if (e.kind === 'image') selected.add(e.id); render(); });
  const st = (await chrome.storage.session.get(DL_STATE_KEY).catch(() => ({})))[DL_STATE_KEY] || {};
  for (const [k, v] of Object.entries(st)) if (Date.now() - (v.at || 0) < 120000) progress.set(k, v);
  await load();
}

init();
