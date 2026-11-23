// NeuroTab — Configurações → Mídia → Salvar mídia (#67) e Sistema → Sobre e créditos.
import { h } from './lib/ui.js';
import { saveData } from './lib/store.js';
import { loadItems } from './lib/brain.js';
import { categoriesToText, categoriesFromText, DEFAULT_CATEGORIES, sanitizeMediaSave, noteMarkdown, notePath } from './lib/media.js';
import { MEDIA_ORIGINS } from './lib/media-save.js';
import { sanitizeMediaDl, DL_ORIGINS, DL_ERRORS } from './lib/media-download.js';
import { ponteDl } from './lib/media-dl-run.js';
import { NATIVE_HOST } from './lib/clipboard-share.js';
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
  setupApps();

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
      ['missing', 'old'].includes(e.code) ? h('p', { class: 'hint' }, '🛡️ ', t('Se o Windows ou o antivírus avisar ao baixar ou abrir, é normal em programa novo e é seguro.'), ' ', h('a', { href: '#apps' }, t('Veja como seguir'))) : null,
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

// ---------- Sistema → Apps externos ----------
/** Versão da NeuroTab Ponte instalada: { state: ok|missing|old|timeout, version }. */
function ponteInfo() {
  return new Promise((resolve) => {
    let port;
    try { port = chrome.runtime.connectNative(NATIVE_HOST); } catch { resolve({ state: 'missing' }); return; }
    let done = false;
    const fin = (v) => { if (done) return; done = true; try { port.disconnect(); } catch { /* já fechou */ } resolve(v); };
    port.onMessage.addListener((m) => fin(m?.type === 'net' ? { state: 'ok', version: m.version || '' } : { state: 'old' }));
    port.onDisconnect.addListener(() => {
      const msg = chrome.runtime.lastError?.message || '';
      fin(/not found|no such native|not registered|specified native messaging host/i.test(msg) ? { state: 'missing' } : { state: 'old' });
    });
    port.postMessage({ type: 'net', op: 'info' });
    setTimeout(() => fin({ state: 'timeout' }), 15000);
  });
}

const older = (a, b) => {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  if (x.some(Number.isNaN) || y.some(Number.isNaN)) return false; // "dev" (compilada à mão)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};

function setupApps() {
  if (!$('#appPonte')) return;
  const dl = ponteDownloads();
  const a = $('#ponteDownload');
  a.href = dl.url(dl.mine);
  a.textContent = `⬇ ${t('Baixar a Ponte para')} ${dl.all[dl.mine].label}`;
  $('#ponteCheck').onclick = () => checkApps(true);
  ponteAllowed().then((ok) => checkApps(false, ok));
}

async function checkApps(ask, allowed = null) {
  const st = $('#ponteStatus');
  const yt = $('#ytdlpStatus');
  const ff = $('#ffmpegStatus');
  const set = (el, txt, cls = '') => { el.textContent = txt; el.className = 'app-status ' + cls; };
  if (!(allowed ?? (await ponteAllowed())) && !(ask && (await askPonte()))) {
    set(st, t('Ainda não verificada. Clique em Verificar (o navegador pede permissão para falar com a Ponte).'));
    set(yt, t('Verifique a Ponte primeiro.'));
    set(ff, t('Verifique a Ponte primeiro.'));
    return;
  }
  set(st, '⏳ ' + t('Verificando…'));
  const info = await ponteInfo();
  const mine = chrome.runtime.getManifest().version;
  if (info.state === 'missing') set(st, '❌ ' + t('Não instalada neste computador. Baixe, abra o arquivo uma vez e clique em Verificar.'), 'bad');
  else if (info.state === 'old') set(st, '⚠️ ' + t('Instalada, mas é uma versão antiga. Baixe a nova e abra uma vez para atualizar.'), 'warn');
  else if (info.state === 'timeout') set(st, '⚠️ ' + t('A Ponte não respondeu. Um antivírus pode estar bloqueando: veja o aviso abaixo.'), 'warn');
  else if (info.version && older(info.version, mine)) set(st, `✅ ${t('Instalada')} — ${t('versão')} ${info.version}. ${t('Há uma versão mais nova')} (${mine}): ${t('baixe e abra uma vez para ter os recursos novos.')}`, 'warn');
  else set(st, `✅ ${t('Instalada')}${info.version ? ` — ${t('versão')} ${info.version}` : ''}.`, 'ok');
  if (info.state !== 'ok') { set(yt, '—'); set(ff, '—'); return; }
  try {
    const r = await ponteDl('tools');
    set(yt, r.ytdlp.path ? `✅ ${t('Instalado')} — ${r.ytdlp.version}` : '❌ ' + t('Não instalado'), r.ytdlp.path ? 'ok' : '');
    set(ff, r.ffmpeg.path ? `✅ ${t('Instalado')} — ${r.ffmpeg.version}` : '❌ ' + t('Não instalado'), r.ffmpeg.path ? 'ok' : '');
  } catch (e) {
    set(yt, t(DL_ERRORS[e.code] || e.message), 'warn');
    set(ff, '—');
  }
}
