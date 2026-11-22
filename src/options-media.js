// NeuroTab — Configurações → Mídia → Salvar mídia (#67) e Sistema → Sobre e créditos.
import { h } from './lib/ui.js';
import { saveData } from './lib/store.js';
import { loadItems } from './lib/brain.js';
import { categoriesToText, categoriesFromText, DEFAULT_CATEGORIES, sanitizeMediaSave, noteMarkdown, notePath } from './lib/media.js';
import { MEDIA_ORIGINS } from './lib/media-save.js';
import { sanitizeMediaDl, DL_ORIGINS, DL_ERRORS } from './lib/media-download.js';
import { ponteDl } from './lib/media-dl-run.js';
import { ponteAllowed, askPonte } from './lib/net-ponte.js';
import { ponteDownloads } from './widgets/clipboard-share-ui.js';
import { t } from './lib/i18n.js';

const $ = (s) => document.querySelector(s);
let api;

export function setupMediaSave(a) {
  api = a;
  const cfg = () => sanitizeMediaSave(api.data().settings.mediaSave);
  $('#mediaCats').value = categoriesToText(cfg().categories);
  $('#mediaCatsSave').onclick = async () => {
    const cats = categoriesFromText($('#mediaCats').value);
    api.data().settings.mediaSave = { ...cfg(), categories: cats, categoryList: Object.entries(cats) };
    await saveData(api.data());
    $('#mediaCats').value = categoriesToText(cats);
    api.toast(`${Object.keys(cats).length} categorias salvas`);
  };
  $('#mediaCatsReset').onclick = async () => {
    api.data().settings.mediaSave = { ...cfg(), categories: { ...DEFAULT_CATEGORIES }, categoryList: Object.entries(DEFAULT_CATEGORIES) };
    await saveData(api.data());
    $('#mediaCats').value = categoriesToText(DEFAULT_CATEGORIES);
    api.toast('Categorias padrão restauradas');
  };
  const paintPerm = async () => {
    const ok = await chrome.permissions.contains({ origins: MEDIA_ORIGINS }).catch(() => false);
    $('#mediaLinksState').textContent = ok ? '✓ Permitido.' : '';
    $('#mediaLinks').textContent = ok ? 'Remover permissão' : 'Permitir';
    $('#mediaLinks').dataset.on = ok ? '1' : '';
  };
  $('#mediaLinks').onclick = async () => {
    if ($('#mediaLinks').dataset.on) await chrome.permissions.remove({ origins: MEDIA_ORIGINS }).catch(() => false);
    else await chrome.permissions.request({ origins: MEDIA_ORIGINS }).catch(() => false);
    paintPerm();
  };
  paintPerm();
  const paintCount = async () => { const n = (await loadItems()).filter((x) => x.type === 'media' && !x.deletedAt).length; $('#mediaCount').textContent = `${n} ${n === 1 ? 'item' : 'itens'} de mídia.`; $('#mediaExport').disabled = !n; };
  paintCount();
  $('#mediaExport').onclick = exportObsidian;

  setupMediaDl();

  // Sobre e créditos
  $('#aboutVersion').textContent = 'v' + chrome.runtime.getManifest().version;
  $('#noticesLink').href = chrome.runtime.getURL('THIRD-PARTY-NOTICES.md');
}

/** Exporta para uma pasta (Chrome/Edge: a pessoa escolhe a pasta do vault) ou num arquivo .md único (Firefox). */
async function exportObsidian() {
  const items = (await loadItems()).filter((x) => x.type === 'media' && !x.deletedAt);
  if (!items.length) return;
  if (window.showDirectoryPicker) {
    let dir;
    try { dir = await window.showDirectoryPicker({ id: 'neurotab-obsidian', mode: 'readwrite' }); } catch { return; }
    let n = 0;
    for (const it of items) {
      const { dir: sub, file } = notePath(it);
      const d = await dir.getDirectoryHandle(sub, { create: true });
      const fh = await d.getFileHandle(file, { create: true });
      const w = await fh.createWritable();
      await w.write(noteMarkdown(it));
      await w.close();
      n++;
    }
    api.toast(`${n} notas exportadas para a pasta ${dir.name}`);
    return;
  }
  const all = items.map((it) => `<!-- ${notePath(it).dir}/${notePath(it).file} -->\n${noteMarkdown(it)}`).join('\n\n---\n\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([all], { type: 'text/markdown' })), download: `neurotab-midia-${new Date().toISOString().slice(0, 10)}.md` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- Baixar vídeos (0.7.11) ----------
const DL_ALL_ORIGINS = [...new Set(Object.values(DL_ORIGINS).flat())];

function setupMediaDl() {
  const cfg = () => sanitizeMediaDl(api.data().settings.mediaDl);
  const want = () => ({ permissions: ['downloads', ...(cfg().cookies ? ['cookies'] : [])], origins: DL_ALL_ORIGINS });
  const paint = async () => {
    const ok = await chrome.permissions.contains(want()).catch(() => false);
    $('#dlPermState').textContent = ok ? t('✓ Permitido.') : '';
    $('#dlPerms').textContent = ok ? t('Remover permissão') : t('Permitir');
    $('#dlPerms').dataset.on = ok ? '1' : '';
  };
  $('#dlPerms').onclick = async () => {
    if ($('#dlPerms').dataset.on) await chrome.permissions.remove({ permissions: ['downloads', 'cookies'] }).catch(() => false);
    else await chrome.permissions.request(want()).catch(() => false);
    paint();
  };
  document.querySelector('[data-k="mediaDl.cookies"]')?.addEventListener('change', () => setTimeout(paint, 100));
  paint();
  $('#dlCheck').onclick = () => checkTools(true);
  ponteAllowed().then((ok) => { if (ok) checkTools(false); });
}

async function checkTools(ask) {
  const box = $('#dlTools');
  const again = h('button', { type: 'button', class: 'btn', onclick: () => checkTools(true) }, t('Verificar de novo'));
  if (!(await ponteAllowed()) && !(ask && (await askPonte()))) {
    box.replaceChildren(h('p', { class: 'hint' }, t('Sem a permissão para falar com a NeuroTab Ponte.')), again);
    return;
  }
  box.replaceChildren(h('p', { class: 'hint' }, '⏳ ', t('Perguntando à NeuroTab Ponte…')));
  let r;
  try {
    r = await ponteDl('tools');
  } catch (e) {
    const dl = ponteDownloads();
    box.replaceChildren(h('p', { class: 'hint' }, '⚠️ ', t(DL_ERRORS[e.code] || e.message)),
      ['missing', 'old'].includes(e.code) ? h('a', { class: 'btn primary', href: dl.url(dl.mine), target: '_blank', rel: 'noopener' }, '⬇ ', t('Baixar a Ponte para'), ' ', dl.all[dl.mine].label) : null,
      again);
    return;
  }
  const line = (name, tool, canInstall, hint) => h('div', { class: 'dl-tool' },
    h('span', {}, tool.path ? '✅ ' : '❌ ', h('b', {}, name), ' ', tool.path ? h('small', { title: tool.path }, tool.version || t('encontrado')) : h('small', {}, t('não encontrado'))),
    !tool.path && canInstall ? h('button', { type: 'button', class: 'btn primary', onclick: (e) => install(name, e.target) }, t('Instalar')) : null,
    !tool.path && !canInstall && hint ? h('small', { class: 'hint' }, hint) : null,
    tool.path && canInstall ? h('button', { type: 'button', class: 'btn', title: t('Baixar a versão mais nova'), onclick: (e) => install(name, e.target) }, t('Atualizar')) : null);
  box.replaceChildren(
    line('yt-dlp', r.ytdlp, r.canInstall?.['yt-dlp'], t('Instale o yt-dlp pelo gerenciador de pacotes.')),
    line('ffmpeg', r.ffmpeg, r.canInstall?.ffmpeg, r.os === 'darwin' ? t('Instale com: brew install ffmpeg') : t('Instale com: sudo apt install ffmpeg (ou o gerenciador do seu sistema)')),
    !r.ffmpeg.path ? h('p', { class: 'hint' }, t('Sem o ffmpeg, a Ponte baixa só a versão do vídeo que já vem com áudio, às vezes em qualidade menor.')) : null,
    h('p', { class: 'hint' }, t('Os vídeos vão para:'), ' ', h('code', {}, r.root)),
    again);
}

async function install(what, btn) {
  btn.disabled = true;
  const label = btn.textContent;
  try {
    await ponteDl('install', { what: [what] }, (ev) => { if (ev.stage === 'install') btn.textContent = `${t('Baixando')} ${Math.round(ev.pct || 0)}%`; });
    api.toast(`${what} ${t('instalado')} ✓`);
    checkTools(false);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = label;
    api.toast(t('Não deu para instalar:') + ' ' + (e.code === 'manual' ? t('instale pelo gerenciador de pacotes do sistema') : e.message));
  }
}
