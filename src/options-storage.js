// NeuroTab — Configurações → Sistema → Armazenamento (0.8.3, #68).
import { h } from './lib/ui.js';
import { t, LOCALE } from './lib/i18n.js';
import { summarize, localUsage, idbUsage, browserQuota, fmtBytes, keysToClear, downloadedItems } from './lib/storage-usage.js';
import { loadItems, updateItem, purgeTrash, loadTrash } from './lib/brain.js';
import { clearIndex } from './lib/semantic.js';
import { clearLocal } from './lib/photos.js';
import { purgeTemp } from './lib/image-index.js';
import { listMeetings, deleteAudio } from './lib/meeting-store.js';
import { ponteDl, revealDownload } from './lib/media-dl-run.js';
import { ponteAllowed } from './lib/net-ponte.js';

const $ = (s) => document.querySelector(s);
const COLORS = ['var(--accent)', 'var(--accent-2)', 'var(--ok)', 'var(--warn)', 'var(--bad)', 'var(--text-3)', 'var(--text-2)'];
let api;

const CLEARS = {
  trash: { ask: 'Esvaziar a lixeira? Os itens apagados somem de vez.', run: () => purgeTrash() },
  caches: { ask: 'Limpar os caches? Eles são baixados de novo quando precisar.', run: async () => chrome.storage.local.remove(keysToClear(Object.keys(await chrome.storage.local.get(null)), 'caches')) },
  history: { ask: 'Apagar o histórico da calculadora e da área de transferência?', run: async () => chrome.storage.local.remove(keysToClear(Object.keys(await chrome.storage.local.get(null)), 'history')) },
  backup: { ask: 'Apagar a cópia de segurança guardada na última atualização?', run: () => chrome.storage.local.remove('nt_migration_backup') },
  vectors: { ask: 'Apagar o índice da busca por significado? Ele é refeito quando a busca for usada (usa a sua IA de novo).', run: () => clearIndex() },
  photos: { ask: 'Apagar as fotos que você enviou para os slides do fundo? Faça backup antes se quiser guardá-las.', run: () => clearLocal() },
  'captures-temp': { ask: 'Apagar as imagens abertas só para análise (não guardadas na biblioteca)?', run: () => purgeTemp(0) },
  'meeting-audio': { ask: 'Apagar o áudio de todas as reuniões? As transcrições, os resumos e as notas ficam.', run: async () => { for (const m of await listMeetings()) if (m.audioBytes || m.audioChunks) await deleteAudio(m.id); } },
};

async function paint() {
  const [local, idb, quota] = await Promise.all([localUsage(), idbUsage(), browserQuota()]);
  const cats = summarize(local, idb);
  const total = cats.reduce((a, c) => a + c.bytes, 0);
  const trashN = (await loadTrash()).length;
  $('#storTotal').replaceChildren(
    h('div', {}, h('b', {}, `${t('Total da NeuroTab')}: ${fmtBytes(total, LOCALE)}`), quota.quota ? h('span', { class: 'small muted' }, ` · ${t('o navegador permite até')} ${fmtBytes(quota.quota, LOCALE)}`) : null),
    h('div', { class: 'stor-bar', role: 'img', 'aria-label': t('Espaço por categoria') }, ...cats.filter((c) => c.bytes > 0).map((c, i) => h('i', { title: `${t(c.label)}: ${fmtBytes(c.bytes, LOCALE)}`, style: { width: `${Math.max(0.5, (c.bytes / (total || 1)) * 100)}%`, background: COLORS[i % COLORS.length] } }))));
  $('#storList').replaceChildren(...cats.map((c, i) => {
    const empty = c.bytes === 0 || (c.id === 'trash' && !trashN);
    const btn = c.clear ? h('button', { class: 'btn sm', 'data-clear': c.clear, disabled: empty, onclick: () => clear(c.clear) }, c.clear === 'trash' ? t('Esvaziar') : t('Limpar')) : c.id === 'meetings' ? h('a', { class: 'btn sm', href: 'meeting.html', target: '_blank' }, t('Abrir')) : h('span');
    return h('div', { class: 'stor-row', 'data-cat': c.id },
      h('span', { class: 'sw-dot', style: { background: c.bytes > 0 ? COLORS[i % COLORS.length] : 'var(--tint-2)' } }),
      h('div', {}, h('span', {}, c.icon, ' ', t(c.label)), h('small', {}, t(c.where), c.hint ? ` · ${t(c.hint)}` : '', c.id === 'trash' ? ` · ${trashN} ${t(trashN === 1 ? 'item' : 'itens')}` : '')),
      h('span', { class: 'sz' }, fmtBytes(c.bytes, LOCALE)), btn);
  }));
  await paintDownloads();
}

async function clear(kind) {
  const c = CLEARS[kind];
  if (!c || !confirm(t(c.ask))) return;
  await c.run();
  await paint();
}

// ---------- vídeos baixados ----------
async function checkFiles(list) {
  const byBrowser = list.filter((d) => d.via === 'browser' && d.downloadId != null);
  const byPonte = list.filter((d) => d.via === 'ponte' && d.file);
  const st = new Map();
  if (byBrowser.length && chrome.downloads && (await chrome.permissions.contains({ permissions: ['downloads'] }).catch(() => false))) {
    for (const d of byBrowser) {
      const [x] = await chrome.downloads.search({ id: d.downloadId }).catch(() => []);
      st.set(d.id, x ? { exists: !!x.exists, size: x.fileSize || x.totalBytes || d.size, file: x.filename } : { exists: false });
    }
  }
  if (byPonte.length && (await ponteAllowed().catch(() => false))) {
    try {
      const r = await ponteDl('stat', { paths: byPonte.map((d) => d.file) });
      byPonte.forEach((d, i) => { const f = r.files?.[i]; if (f) st.set(d.id, { exists: f.exists, size: f.size }); });
    } catch { /* Ponte antiga ou fechada: não dá para conferir */ }
  }
  return st;
}

async function paintDownloads() {
  const s = api.data().settings;
  const folder = s.mediaDl?.folder || 'NeuroTab';
  const list = downloadedItems(await loadItems());
  const hasDl = chrome.downloads && (await chrome.permissions.contains({ permissions: ['downloads'] }).catch(() => false));
  $('#dlFolder').replaceChildren(`${t('Pasta')}: Downloads/${folder} ${t('(muda em Mídia → Salvar mídia)')} `,
    hasDl ? h('button', { class: 'btn sm', onclick: () => chrome.downloads.showDefaultFolder() }, '📂 ', t('Abrir a pasta Downloads')) : '');
  const box = $('#storDl');
  if (!list.length) { box.replaceChildren(h('p', { class: 'small muted' }, t('A NeuroTab ainda não baixou nenhum vídeo.'))); return; }
  const st = await checkFiles(list);
  const total = list.reduce((a, d) => a + ((st.get(d.id)?.exists !== false && (st.get(d.id)?.size || d.size)) || 0), 0);
  const rows = list.map((d) => {
    const info = st.get(d.id);
    const gone = info && !info.exists;
    const name = String(info?.file || d.file || d.title).split(/[\\/]/).pop();
    return h('div', { class: 'stor-file' + (gone ? ' gone' : ''), 'data-item': d.id },
      h('span', { title: info?.file || d.file || '' }, gone ? '⚠️ ' : '🎬 ', name, ' ', h('small', { class: 'muted' }, [d.at && new Date(d.at).toLocaleDateString(LOCALE), (info?.size || d.size) && fmtBytes(info?.size || d.size, LOCALE), gone && t('não encontrado'), !info && t('não deu para conferir')].filter(Boolean).join(' · '))),
      gone ? h('span') : h('button', { class: 'btn sm', onclick: async () => { const r = await revealDownload(d.id); if (r.error) alert(t(r.error)); } }, t('Mostrar na pasta')),
      gone ? h('button', { class: 'btn sm', onclick: () => forget(d.id) }, t('Tirar da lista')) : h('button', { class: 'btn sm', onclick: () => removeFile(d, true) }, t('Apagar do computador')));
  });
  box.replaceChildren(h('p', { class: 'small' }, `${list.length} ${t('vídeos')} · ${fmtBytes(total, LOCALE)}`), ...rows,
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', id: 'dlDeleteAll', onclick: () => removeAll(list, st) }, t('Apagar todos os vídeos baixados'))));
}

async function forget(id) {
  const it = (await loadItems()).find((x) => x.id === id);
  if (!it) return;
  const media = { ...it.media };
  delete media.download;
  await updateItem(id, { media });
  await paintDownloads();
}

async function removeFile(d, ask) {
  if (ask && !confirm(t('Apagar este vídeo do computador? O item continua no cérebro.'))) return false;
  try {
    if (d.via === 'browser' && d.downloadId != null) {
      await chrome.downloads.removeFile(d.downloadId).catch(() => {});
      await chrome.downloads.erase({ id: d.downloadId }).catch(() => {});
    } else if (d.via === 'ponte' && d.file) {
      await ponteDl('remove', { path: d.file });
    }
  } catch (e) {
    alert(t(e.message));
    return false;
  }
  await forget(d.id);
  return true;
}

async function removeAll(list, st) {
  const live = list.filter((d) => st.get(d.id)?.exists !== false);
  if (!confirm(`${t('Apagar')} ${live.length} ${t('vídeos baixados pela NeuroTab do computador? Os itens continuam no cérebro.')}`)) return;
  for (const d of list) await removeFile(d, false);
  await paintDownloads();
}

export function setupStorage(a) {
  api = a;
  let done = false;
  const go = () => { if (done) return; done = true; paint(); };
  // Calcula só quando a página é aberta (ler o banco inteiro custa um pouco).
  if (location.hash === '#armazenamento') go();
  addEventListener('nt-page', (e) => { if (e.detail === 'armazenamento') { done = false; go(); } });
  $('#storRefresh').onclick = () => paint();
  $('#storBackup').onclick = () => { location.hash = '#exportar'; };
}
