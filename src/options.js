// NeuroTab — página de configurações.
import {
  DATA_KEY, SEARCH_ENGINES, DEFAULT_SETTINGS, mergeSettings,
  loadData, saveData, loadBg, saveBg, parseBackup, toBackup, uid,
} from './lib/store.js';
import { loadItems, saveItems, fromKeepNote, toMarkdown, trashItems, purgeTrash, loadTrash } from './lib/brain.js';
import { voicesFor, speak } from './lib/ui.js';
import { SOUNDS } from './lib/sounds.js';
import { UPDATE_KEY } from './lib/update.js';
import { SOURCES, addFiles, listLocal, clearLocal } from './lib/photos.js';
import { initI18n, LOCALE } from './lib/i18n.js';
import { PROVIDERS, aiConfig, requestPermission, listModels, complete } from './lib/ai.js';
import { pixPayload, qrSvg } from './lib/pix.js';
import { PROJECT, DONATION } from './config.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let data;

init();

async function init() {
  $('#ver').textContent = 'v' + chrome.runtime.getManifest().version;
  for (const [k, e] of Object.entries(SEARCH_ENGINES)) $('#engines').add(new Option(e.name, k));
  for (let n = 2; n <= 12; n++) $('#cols').add(new Option(String(n), String(n)));
  for (const [k, v] of Object.entries(SOUNDS)) $('#timerSound').add(new Option(v, k));
  for (const [k, v] of Object.entries(SOURCES)) $('#slideSource').add(new Option(v, k));

  data = await loadData();
  initI18n(data.settings.lang);
  fillSettings();
  bindSettings();
  setupTabs();
  setupBackground();
  setupAi();
  setupNotes();
  setupBackup();
  setupDonation();
  setupVoiceOptions();
  setupPhotos();
  renderPlaces();
  setupUpdatesOptions();
  setupCleanup();

  chrome.storage.onChanged.addListener(async (c, area) => {
    if (area === 'local' && c[DATA_KEY]) { data = await loadData(); fillSettings(); showStats(); renderPlaces(); }
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

// ---------- Configurações simples (data-k) ----------
function fillSettings() {
  for (const el of $$('[data-k]')) {
    const v = data.settings[el.dataset.k];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : String(v);
  }
  $('#autoEnrich').checked = !!data.settings.ai.autoEnrich;
}

function bindSettings() {
  for (const el of $$('[data-k]')) {
    const evt = el.type === 'range' || el.type === 'color' || el.type === 'text' ? 'input' : 'change';
    el.addEventListener(evt, debounce(async () => {
      const k = el.dataset.k;
      data.settings[k] = el.type === 'checkbox' ? el.checked : 'num' in el.dataset ? Number(el.value) : el.value;
      await saveData(data);
      if (k === 'lang') { location.reload(); return; }
      toast('Salvo ✓');
    }, el.type === 'text' ? 500 : 0));
  }
  $('#reset').addEventListener('click', async () => {
    if (!confirm('Restaurar as configurações padrão? Atalhos, notas e chaves de IA serão mantidos.')) return;
    const keep = { ai: data.settings.ai, brapiToken: data.settings.brapiToken, places: data.settings.places, widgets: data.settings.widgets };
    data.settings = mergeSettings({ ...DEFAULT_SETTINGS, ...keep });
    await saveData(data);
    fillSettings();
    toast('Padrões restaurados');
  });
}

function debounce(fn, ms) {
  if (!ms) return fn;
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Plano de fundo ----------
async function setupBackground() {
  await showBgPreview();
  $('#bgFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Otimizando imagem…');
    await saveBg(await optimizeImage(await fileToDataUrl(file)));
    if (!data.settings.bgEnabled) { data.settings.bgEnabled = true; await saveData(data); fillSettings(); }
    await showBgPreview();
    toast('Plano de fundo atualizado');
    e.target.value = '';
  });
  $('#bgRemove').addEventListener('click', async () => { await saveBg(null); await showBgPreview(); toast('Imagem removida'); });
}

async function showBgPreview() {
  const bg = await loadBg();
  const p = $('#bgPreview');
  p.style.backgroundImage = bg ? `url("${bg}")` : 'none';
  p.classList.toggle('has', !!bg);
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

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

// ---------- IA ----------
function setupAi() {
  const sel = $('#provider');
  for (const [k, p] of Object.entries(PROVIDERS)) sel.add(new Option(p.name, k));

  const paint = () => {
    const ai = data.settings.ai;
    const id = sel.value;
    const p = PROVIDERS[id];
    $('#provNote').textContent = p.note || '';
    $('#keyRow').hidden = !!p.noKey;
    $('#keyLink').href = p.keyUrl || '#';
    $('#keyLink').parentElement.hidden = !p.keyUrl;
    $('#apiKey').value = ai.keys[id] || '';
    $('#baseRow').hidden = !p.editableBase;
    $('#baseUrl').value = ai.baseUrls[id] || p.base;
    $('#model').value = ai.models[id] || p.defaultModel;
    $('#modelList').replaceChildren();
    $('#aiMsg').textContent = '';
  };
  sel.value = data.settings.ai.provider in PROVIDERS ? data.settings.ai.provider : 'gemini';
  paint();
  sel.addEventListener('change', paint);
  $('#showKey').onclick = () => { const k = $('#apiKey'); k.type = k.type === 'password' ? 'text' : 'password'; };

  const staged = () => {
    const s = structuredClone(data.settings);
    const id = sel.value;
    s.ai.provider = id;
    s.ai.keys[id] = $('#apiKey').value.trim();
    s.ai.models[id] = $('#model').value.trim();
    if (PROVIDERS[id].editableBase) s.ai.baseUrls[id] = $('#baseUrl').value.trim();
    return s;
  };
  const msg = (t, cls = '') => { const m = $('#aiMsg'); m.className = 'msg ' + cls; m.textContent = t; };

  $('#loadModels').onclick = async () => {
    const s = staged();
    try {
      if (!(await requestPermission(aiConfig(s)))) return msg('Permissão negada.', 'err');
      msg('Carregando modelos…');
      const models = await listModels(s);
      $('#modelList').replaceChildren(...models.map((m) => new Option(m, m)));
      msg(`${models.length} modelos disponíveis — clique no campo "Modelo" para escolher.`, 'ok');
    } catch (e) {
      msg('✕ ' + e.message, 'err');
    }
  };

  $('#saveAi').onclick = async () => {
    const s = staged();
    const cfg = aiConfig(s);
    if (!cfg.p.noKey && !cfg.key) return msg('Cole a chave de API.', 'err');
    try {
      if (!(await requestPermission(cfg))) return msg('Permissão negada pelo navegador.', 'err');
      data.settings.ai = s.ai;
      await saveData(data);
      msg('Salvo. Testando…');
      const t0 = performance.now();
      const out = await complete(s, { messages: [{ role: 'user', content: 'Responda apenas: OK' }], maxTokens: 50 });
      msg(`✓ Funcionando (${cfg.model}, ${Math.round(performance.now() - t0)} ms): "${out.trim().slice(0, 40)}"`, 'ok');
    } catch (e) {
      msg('✕ ' + e.message, 'err');
    }
  };

  $('#autoEnrich').addEventListener('change', async (e) => {
    data.settings.ai.autoEnrich = e.target.checked;
    await saveData(data);
    toast('Salvo ✓');
  });

  $('#micPerm').onclick = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.getTracks().forEach((t) => t.stop());
      toast('Microfone liberado 🎤');
    } catch {
      toast('O navegador bloqueou o microfone. Libere no ícone da barra de endereço.');
    }
  };
}

// ---------- Notas: Keep e Markdown ----------
function setupNotes() {
  $('#issueLink2').href = PROJECT.issues;
  const handle = async (e) => {
    const files = [...e.target.files].filter((f) => f.name.endsWith('.json'));
    e.target.value = '';
    const m = $('#keepMsg');
    m.className = 'msg';
    if (!files.length) { m.textContent = 'Nenhum arquivo .json encontrado.'; return; }
    m.textContent = `Lendo ${files.length} arquivos…`;
    const items = await loadItems();
    const seen = new Set(items.filter((i) => i.keepId).map((i) => i.keepId));
    let added = 0;
    let skipped = 0;
    for (const f of files) {
      try {
        const it = fromKeepNote(JSON.parse(await f.text()), f.webkitRelativePath || f.name);
        if (!it) { skipped++; continue; }
        if (seen.has(it.keepId)) { skipped++; continue; }
        items.push(it);
        added++;
      } catch {
        skipped++;
      }
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    await saveItems(items);
    m.className = 'msg ok';
    m.textContent = `✓ ${added} notas importadas do Keep${skipped ? ` (${skipped} ignoradas: lixeira, vazias ou repetidas)` : ''}.`;
    showBrainStats();
  };
  $('#keepDir').addEventListener('change', handle);
  $('#keepFiles').addEventListener('change', handle);
  $('#exportMd').addEventListener('click', async () => {
    download(new Blob([toMarkdown(await loadItems())], { type: 'text/markdown' }), `neurotab-notas-${today()}.md`);
  });
  showBrainStats();
}

async function showBrainStats() {
  const items = await loadItems();
  const tasks = items.filter((i) => i.type === 'task' && !i.done).length;
  $('#brainStats').textContent = `${items.length} itens no cérebro · ${tasks} tarefas pendentes`;
}

// ---------- Backup ----------
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
      const secrets = { ai: data.settings.ai, brapiToken: data.settings.brapiToken };
      if (mode === 'replace') {
        if (!confirm(`Substituir tudo por ${parsed.data.groups.length} grupos e ${parsed.data.links.length} atalhos${parsed.brain.length ? ` e ${parsed.brain.length} notas` : ''}?`)) { msg.textContent = ''; return; }
        data = parsed.data;
        data.settings.ai = { ...data.settings.ai, keys: secrets.ai.keys };
        data.settings.brapiToken = data.settings.brapiToken || secrets.brapiToken;
        if (parsed.brain.length) await saveItems(parsed.brain);
      } else {
        const map = {};
        for (const g of parsed.data.groups) {
          const existing = data.groups.find((x) => x.name.toLowerCase() === g.name.toLowerCase());
          if (existing) map[g.id] = existing.id;
          else { map[g.id] = uid(); data.groups.push({ ...g, id: map[g.id] }); }
        }
        const urls = new Set(data.links.map((l) => l.url));
        for (const l of parsed.data.links) if (!urls.has(l.url)) data.links.push({ ...l, id: uid(), groupId: map[l.groupId] });
        if (parsed.brain.length) {
          const items = await loadItems();
          const ids = new Set(items.map((i) => i.id));
          await saveItems([...items, ...parsed.brain.filter((i) => !ids.has(i.id))].sort((a, b) => b.createdAt - a.createdAt));
        }
      }
      await saveData(data);
      if (parsed.background && (mode === 'replace' || !current)) {
        msg.textContent = 'Otimizando plano de fundo…';
        await saveBg(await optimizeImage(parsed.background));
        await showBgPreview();
      }
      fillSettings();
      msg.className = 'msg ok';
      msg.textContent = `✓ Importado: ${parsed.data.groups.length} grupos, ${parsed.data.links.length} atalhos${parsed.brain.length ? `, ${parsed.brain.length} notas` : ''}.`;
      showStats();
    } catch (err) {
      console.error(err);
      msg.className = 'msg err';
      msg.textContent = '✕ ' + (err.message || 'Não foi possível importar.');
    }
  });
  $('#exportBtn').addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(toBackup(data, await loadBg(), await loadItems()))], { type: 'application/json' });
    download(blob, `neurotab-backup-${today()}.json`);
  });
}

async function showStats() {
  const bytes = await chrome.storage.local.getBytesInUse(null);
  const n = (await loadItems()).length;
  $('#stats').textContent = `${data.groups.length} grupos · ${data.links.length} atalhos · ${n} notas · ${(bytes / 1024 / 1024).toFixed(2)} MB usados`;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Apoie ----------
function setupDonation() {
  $('#author').textContent = PROJECT.author;
  $('#repoLink').href = PROJECT.repo;
  $('#siteLink').href = PROJECT.site;
  $('#starLink').href = PROJECT.repo;
  $('#issueLink').href = PROJECT.issues;

  const pix = DONATION.pix;
  if (pix?.key) {
    const code = pixPayload(pix);
    $('#pixBox').hidden = false;
    $('#pixKey').textContent = pix.key;
    $('#pixQr').innerHTML = qrSvg(code, { size: 200 });
    $('#pixCopyCode').onclick = async () => { await navigator.clipboard.writeText(code); toast('Pix copia e cola copiado — obrigado! ❤'); };
    $('#pixCopyKey').onclick = async () => { await navigator.clipboard.writeText(pix.key); toast('Chave Pix copiada — obrigado! ❤'); };
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
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- Voz ----------
function setupVoiceOptions() {
  const sel = $('#ttsVoice');
  const fill = () => {
    const lang = data.settings.voiceLang || LOCALE;
    const list = voicesFor(lang).sort((a, b) => (/natural|online|neural/i.test(b.name) - /natural|online|neural/i.test(a.name)) || a.name.localeCompare(b.name));
    sel.replaceChildren(new Option('Automática (melhor disponível)', ''), ...list.map((v) => new Option(`${v.name}${v.localService ? '' : ' ☁'}`, v.voiceURI)));
    sel.value = list.some((v) => v.voiceURI === data.settings.ttsVoice) ? data.settings.ttsVoice : '';
  };
  fill();
  speechSynthesis.addEventListener?.('voiceschanged', fill);
  $('[data-k="voiceLang"]').addEventListener('change', () => setTimeout(fill, 100));
  sel.addEventListener('change', async () => { data.settings.ttsVoice = sel.value; await saveData(data); toast('Voz salva ✓'); });
  $('#testVoice').onclick = () => speak('Olá! Eu sou a NeuroTab. Posso anotar ideias, criar lembretes e responder perguntas sobre as suas notas.', data.settings);
  $('#shortcutsBtn').onclick = () => chrome.tabs.create({ url: navigator.userAgent.includes('Edg/') ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
  $('#testTimerSound').onclick = () => chrome.runtime.sendMessage({ type: 'previewSound', kind: $('#timerSound').value });
}

// ---------- Atualizações ----------
function setupUpdatesOptions() {
  $('#verNow').textContent = chrome.runtime.getManifest().version;
  const show = (u) => {
    if (!u) return;
    $('#updMsg').textContent = u.available
      ? `🎉 Versão ${u.latest} disponível — veja o aviso na nova aba.`
      : `✓ Você está na versão mais recente (verificado ${new Date(u.checkedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}).`;
  };
  chrome.storage.local.get(UPDATE_KEY).then((r) => show(r[UPDATE_KEY]));
  $('#checkNow').onclick = async () => {
    $('#updMsg').textContent = 'Verificando…';
    const r = await chrome.runtime.sendMessage({ type: 'checkUpdate' });
    if (r?.ok) show(r.u);
    else $('#updMsg').textContent = '✕ Não foi possível verificar: ' + (r?.error || 'sem resposta');
  };
}

// ---------- Limpeza ----------
function setupCleanup() {
  const msg = (t, cls = 'ok') => { const m = $('#cleanMsg'); m.className = 'msg ' + cls; m.textContent = t; };
  $('#cleanDone').onclick = async () => {
    const done = (await loadItems()).filter((i) => i.done);
    if (!done.length) return msg('Nenhuma tarefa concluída.', '');
    await trashItems(done.map((i) => i.id));
    msg(`✓ ${done.length} tarefa(s) concluída(s) movida(s) para a lixeira.`);
    showBrainStats();
  };
  $('#emptyTrash').onclick = async () => {
    const n = (await loadTrash()).length;
    if (!n) return msg('A lixeira já está vazia.', '');
    if (!confirm(`Apagar definitivamente ${n} item(ns) da lixeira?`)) return;
    await purgeTrash();
    msg(`✓ Lixeira esvaziada (${n} itens).`);
  };
  $('#wipeAll').onclick = async () => {
    const items = await loadItems();
    if (!items.length) return msg('Não há notas para apagar.', '');
    const typed = prompt(`Isto move TODAS as ${items.length} notas, tarefas e lembretes para a lixeira (recuperáveis por 30 dias).\nAntes, um backup será baixado.\n\nDigite APAGAR para confirmar:`);
    if (typed?.trim().toUpperCase() !== 'APAGAR') return;
    download(new Blob([toMarkdown(items)], { type: 'text/markdown' }), `neurotab-antes-de-apagar-${today()}.md`);
    await trashItems(items.map((i) => i.id));
    msg(`✓ ${items.length} itens movidos para a lixeira. Um backup em Markdown foi baixado.`);
    showBrainStats();
  };
}

// ---------- Cidades do relógio ----------
function renderPlaces() {
  const box = $('#placesList');
  if (!box) return;
  const places = data.settings.places || [];
  box.replaceChildren(...places.map((p, i) => {
    const row = document.createElement('div');
    row.className = 'pl';
    row.innerHTML = `<b>${i === 0 ? '⭐' : '🕐'}</b><span></span><button class="btn">Remover</button>`;
    row.querySelector('span').textContent = `${p.name}${p.region ? ' · ' + p.region : ''}${p.tz ? ' · ' + p.tz : ''}`;
    if (i === 0) row.querySelector('span').append(document.createElement('small'));
    if (i === 0) row.querySelector('small').textContent = ' (principal)';
    row.querySelector('button').onclick = async () => { data.settings.places.splice(i, 1); await saveData(data); renderPlaces(); };
    return row;
  }));
  if (!places.length) box.innerHTML = '<p class="hint">Nenhuma cidade ainda. Na nova aba, clique em "📍 Definir cidade" ao lado do relógio.</p>';
}

// ---------- Fotos ----------
function setupPhotos() {
  const count = async () => { const n = (await listLocal()).length; $('#photoCount').textContent = n ? `${n} foto(s) guardada(s) no navegador` : 'Nenhuma foto adicionada'; };
  count();
  const handle = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    $('#photoCount').textContent = 'Otimizando fotos…';
    const n = await addFiles(files, (d, t) => { $('#photoCount').textContent = `Otimizando ${d}/${t}…`; });
    toast(`${n} foto(s) adicionada(s)`);
    if (data.settings.bgMode !== 'slides') { data.settings.bgMode = 'slides'; data.settings.slideSource = 'local'; data.settings.bgEnabled = true; await saveData(data); fillSettings(); }
    count();
  };
  $('#photoFiles').addEventListener('change', handle);
  $('#photoDir').addEventListener('change', handle);
  $('#photoClear').onclick = async () => { if (!confirm('Apagar todas as fotos guardadas na NeuroTab? (Os arquivos no seu computador não são afetados.)')) return; await clearLocal(); count(); };
}
