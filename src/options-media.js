// NeuroTab — Configurações → Mídia → Salvar mídia (#67) e Sistema → Sobre e créditos.
import { h } from './lib/ui.js';
import { saveData } from './lib/store.js';
import { loadItems } from './lib/brain.js';
import { categoriesToText, categoriesFromText, DEFAULT_CATEGORIES, sanitizeMediaSave, noteMarkdown, notePath } from './lib/media.js';
import { MEDIA_ORIGINS } from './lib/media-save.js';

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
