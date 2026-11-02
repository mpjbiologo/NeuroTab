// NeuroTab — página de configurações.
import {
  DATA_KEY, SEARCH_ENGINES, DEFAULT_SETTINGS,
  loadData, saveData, loadBg, saveBg, parseBackup, toBackup, uid,
} from './lib/store.js';
import { PROJECT, DONATION } from './config.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let data;

init();

async function init() {
  $('#ver').textContent = 'v' + chrome.runtime.getManifest().version;
  for (const [k, e] of Object.entries(SEARCH_ENGINES)) $('#engines').add(new Option(e.name, k));
  for (let n = 2; n <= 12; n++) $('#cols').add(new Option(String(n), String(n)));

  data = await loadData();
  fillSettings();
  bindSettings();
  setupTabs();
  setupBackground();
  setupBackup();
  setupDonation();

  chrome.storage.onChanged.addListener(async (c, area) => {
    if (area === 'local' && c[DATA_KEY]) { data = await loadData(); fillSettings(); showStats(); }
  });
}

// ---------- Abas ----------
function setupTabs() {
  const open = (name) => {
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('main > section').forEach((s) => { s.hidden = s.id !== 'tab-' + name; });
    history.replaceState(null, '', '#' + name);
  };
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => open(b.dataset.tab)));
  $('#donateBtn').addEventListener('click', () => { open('apoie'); scrollTo({ top: 0, behavior: 'smooth' }); });
  const fromHash = () => { const h = location.hash.slice(1); if ($('#tab-' + h)) open(h); };
  window.addEventListener('hashchange', fromHash);
  fromHash();
}

// ---------- Configurações gerais ----------
function fillSettings() {
  for (const el of $$('[data-k]')) {
    const v = data.settings[el.dataset.k];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
  }
}

function bindSettings() {
  for (const el of $$('[data-k]')) {
    el.addEventListener(el.type === 'range' || el.type === 'color' ? 'input' : 'change', async () => {
      const k = el.dataset.k;
      data.settings[k] = el.type === 'checkbox' ? el.checked : 'num' in el.dataset ? Number(el.value) : el.value;
      await saveData(data);
      toast('Salvo ✓');
    });
  }
  $('#reset').addEventListener('click', async () => {
    if (!confirm('Restaurar as configurações padrão? Seus atalhos e grupos serão mantidos.')) return;
    data.settings = { ...DEFAULT_SETTINGS };
    await saveData(data);
    fillSettings();
    toast('Padrões restaurados');
  });
}

// ---------- Plano de fundo ----------
async function setupBackground() {
  const show = (bg) => {
    const p = $('#bgPreview');
    p.style.backgroundImage = bg ? `url("${bg}")` : 'none';
    p.classList.toggle('has', !!bg);
  };
  show(await loadBg());
  $('#bgFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Otimizando imagem…');
    const bg = await optimizeImage(await fileToDataUrl(file));
    await saveBg(bg);
    if (!data.settings.bgEnabled) { data.settings.bgEnabled = true; await saveData(data); fillSettings(); }
    show(bg);
    toast('Plano de fundo atualizado');
    e.target.value = '';
  });
  $('#bgRemove').addEventListener('click', async () => {
    await saveBg(null);
    show(null);
    toast('Imagem removida');
  });
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// Reduz para no máximo 2560 px e recomprime em JPEG — fundos de 6 MB viram ~300–600 KB.
async function optimizeImage(dataUrl, max = 2560, quality = 0.86) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const out = c.toDataURL('image/jpeg', quality);
  return out.length < dataUrl.length ? out : dataUrl;
}

// ---------- Importar / exportar ----------
function setupBackup() {
  showStats();
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const msg = $('#importMsg');
    msg.className = 'msg';
    msg.textContent = 'Lendo arquivo…';
    try {
      const parsed = parseBackup(JSON.parse(await file.text()));
      const mode = document.querySelector('input[name=mode]:checked').value;
      const current = await loadBg();
      if (mode === 'replace') {
        if (!confirm(`Substituir tudo por ${parsed.data.groups.length} grupos e ${parsed.data.links.length} atalhos?`)) {
          msg.textContent = '';
          return;
        }
        data = parsed.data;
      } else {
        // Juntar: novos ids para não colidir.
        const map = {};
        for (const g of parsed.data.groups) {
          const existing = data.groups.find((x) => x.name.toLowerCase() === g.name.toLowerCase());
          if (existing) map[g.id] = existing.id;
          else { map[g.id] = uid(); data.groups.push({ ...g, id: map[g.id] }); }
        }
        const urls = new Set(data.links.map((l) => l.url));
        for (const l of parsed.data.links) {
          if (urls.has(l.url)) continue;
          data.links.push({ ...l, id: uid(), groupId: map[l.groupId] });
        }
      }
      await saveData(data);
      if (parsed.background && (mode === 'replace' || !current)) {
        msg.textContent = 'Otimizando plano de fundo…';
        await saveBg(await optimizeImage(parsed.background));
        setupBackgroundPreview();
      }
      fillSettings();
      msg.className = 'msg ok';
      msg.textContent = `✓ Importado: ${parsed.data.groups.length} grupos e ${parsed.data.links.length} atalhos.`;
      showStats();
    } catch (err) {
      console.error(err);
      msg.className = 'msg err';
      msg.textContent = '✕ ' + (err.message || 'Não foi possível importar.');
    }
  });

  $('#exportBtn').addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(toBackup(data, await loadBg()))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `neurotab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

async function setupBackgroundPreview() {
  const bg = await loadBg();
  const p = $('#bgPreview');
  p.style.backgroundImage = bg ? `url("${bg}")` : 'none';
  p.classList.toggle('has', !!bg);
}

async function showStats() {
  const bytes = await chrome.storage.local.getBytesInUse(null);
  $('#stats').textContent = `${data.groups.length} grupos · ${data.links.length} atalhos · ${(bytes / 1024 / 1024).toFixed(2)} MB usados`;
}

// ---------- Apoie ----------
function setupDonation() {
  $('#author').textContent = PROJECT.author;
  $('#repoLink').href = PROJECT.repo;
  $('#starLink').href = PROJECT.repo;
  $('#issueLink').href = PROJECT.issues;
  $('#roadmapLink').href = PROJECT.repo + '#-roteiro';

  if (DONATION.pixKey) {
    $('#pixBox').hidden = false;
    $('#pixKey').textContent = DONATION.pixKey;
    $('#pixCopy').addEventListener('click', async () => {
      await navigator.clipboard.writeText(DONATION.pixKey);
      toast('Chave Pix copiada — obrigado! ❤');
    });
  }
  const box = $('#donateLinks');
  for (const l of DONATION.links.filter((x) => x.url)) {
    const a = document.createElement('a');
    a.className = 'btn primary';
    a.href = l.url;
    a.target = '_blank';
    a.textContent = `${l.icon || '❤'} ${l.label}`;
    box.appendChild(a);
  }
  if (!DONATION.pixKey && !box.children.length) {
    const a = document.createElement('a');
    a.className = 'btn primary';
    a.href = PROJECT.repo + '#-apoie-o-projeto';
    a.target = '_blank';
    a.textContent = '❤ Ver formas de apoiar';
    box.appendChild(a);
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}
