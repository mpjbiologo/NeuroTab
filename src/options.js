// NeuroTab — página de configurações.
import { setupAccounts } from './options-accounts.js';
import { setupNav } from './options-nav.js';
import {
  DATA_KEY, SEARCH_ENGINES, DEFAULT_SETTINGS, mergeSettings,
  loadData, saveData, loadBg, saveBg, parseBackup, toBackup, collectSecrets, applySecrets, uid,
} from './lib/store.js';
import { encryptJSON, decryptJSON } from './lib/crypto.js';
import { loadItems, saveItems, fromKeepNote, toMarkdown, trashItems, purgeTrash, loadTrash } from './lib/brain.js';
import { voicesFor, speak, h } from './lib/ui.js';
import { SOUNDS } from './lib/sounds.js';
import { UPDATE_KEY, isStoreInstall } from './lib/update.js';
import { FEATURES, hasFeature, requestFeature, revokeFeature, grantedSites, revokeSite } from './lib/permissions.js';
import { SOURCES, addFiles, listLocal, clearLocal } from './lib/photos.js';
import { initI18n, LOCALE, t } from './lib/i18n.js';
import { greetingFor } from './lib/voice-session.js';
import { createViz } from './lib/voice-viz.js';
import { aiConfig, requestPermission, isLocalAI } from './lib/ai.js';
import { setupAiCentral, repaintAi } from './options-ai.js';
import { embedConfig, indexItems, indexStatus, clearIndex } from './lib/semantic.js';
import { pixPayload, qrSvg } from './lib/pix.js';
import { PROJECT, DONATION } from './config.js';
import { setHTML } from './lib/safe-html.js';
import { assistantName, wakePhraseOf, phraseSuggestions } from './lib/wake-word.js';
import { commandLang } from './lib/assistant.js';
import { applyLook, themeOf, THEMES } from './lib/theme.js';
import { setupLook, refreshLook } from './options-look.js';
import { setupMediaSave } from './options-media.js';
import { setupStorage } from './options-storage.js';
import { icon, startIconizer } from './lib/icons.js';
import { configureSpeech, deviceLangFor, deviceStatus, deviceSupported, installDevice, currentEngine, speechAvailable, ENGINE_ERRORS, WHISPER_PRESETS, encodeWav, transcribeRequest } from './lib/speech-engine.js';

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
  // Bing/NASA precisam do acesso "Fotos do dia": pedido na hora da escolha.
  $('#slideSource').addEventListener('change', async (e) => {
    if (e.target.value === 'local' || (await requestFeature('slides'))) return;
    e.target.value = 'local';
    e.target.dispatchEvent(new Event('change'));
  });

  data = await loadData();
  initI18n(data.settings.lang);
  applyLook(data.settings);
  setupThemePicker();
  fillSettings();
  bindSettings();
  setupBackground();
  setupAi();
  setupNotes();
  setupBackup();
  setupAccounts(toast);
  setupNav(); // depois de tudo montado: as seções viram páginas da lateral
  setupLook({ data: () => data, toast, afterTheme: () => paintThemePicker() });
  setupMediaSave({ data: () => data, toast });
  setupStorage({ data: () => data });
  setupDonation();
  setupVoiceOptions();
  setupPhotos();
  renderPlaces();
  setupUpdatesOptions();
  setupCleanup();
  startIconizer();

  chrome.storage.onChanged.addListener(async (c, area) => {
    if (area === 'local' && c[DATA_KEY]) { data = await loadData(); applyLook(data.settings); paintThemePicker(); fillSettings(); showStats(); renderPlaces(); refreshLook(); repaintAi(); }
  });
}

// ---------- Configurações simples (data-k) ----------
// ---------- Tema (#51) ----------
function setupThemePicker() {
  const box = $('#themePick');
  box.replaceChildren(...Object.entries(THEMES).map(([id, th]) => {
    // Cada cartão usa o próprio tema (data-theme), então a prévia mostra as cores de verdade.
    const card = h('button', { class: 'theme-card', type: 'button', role: 'radio', 'data-theme': id, 'data-id': id, onclick: () => chooseTheme(id) },
      h('span', { class: 'sw-prev', 'aria-hidden': 'true' }, h('i'), h('i'), h('b', {}, 'Salvar')),
      h('span', { class: 'tn' }, th.label, ' ', icon('check')),
      h('small', {}, th.desc));
    return card;
  }));
  box.addEventListener('keydown', (e) => {
    const ids = Object.keys(THEMES);
    const i = ids.indexOf(themeOf(data.settings));
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = ids[(i + d + ids.length) % ids.length];
    chooseTheme(next);
    box.querySelector(`[data-id="${next}"]`)?.focus();
  });
  paintThemePicker();
}
function paintThemePicker() {
  const cur = themeOf(data.settings);
  for (const b of $$('#themePick .theme-card')) {
    const on = b.dataset.id === cur;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
}
async function chooseTheme(id) {
  data.settings.theme = id;
  applyLook(data.settings);
  paintThemePicker();
  await saveData(data);
  toast(`Tema ${THEMES[id].label} aplicado`);
}

// data-k aceita caminho com ponto (ex.: "media.save").
const getK = (k) => k.split('.').reduce((o, p) => o?.[p], data.settings);
const setK = (k, v) => { const ps = k.split('.'); const last = ps.pop(); ps.reduce((o, p) => (o[p] ??= {}), data.settings)[last] = v; };

function fillSettings() {
  for (const el of $$('[data-k]')) {
    const v = getK(el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : String(v);
  }
  $('#autoEnrich').checked = !!data.settings.ai.autoEnrich;
  $('#imagesAllowed').checked = !!data.settings.ai.imagesAllowed;
  $('#sharePlaces').checked = data.settings.ai.sharePlaces !== false;
  $('#semantic').checked = !!data.settings.ai.semantic;
}

function bindSettings() {
  for (const el of $$('[data-k]')) {
    const evt = el.type === 'range' || el.type === 'color' || el.type === 'text' ? 'input' : 'change';
    el.addEventListener(evt, debounce(async () => {
      const k = el.dataset.k;
      setK(k, el.type === 'checkbox' ? el.checked : 'num' in el.dataset ? Number(el.value) : el.value);
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
  setupAiCentral({ data: () => data, toast, onChange: () => document.querySelector('#semantic').dispatchEvent(new Event('repaint')) });

  $('#sharePlaces').addEventListener('change', async (e) => {
    data.settings.ai.sharePlaces = e.target.checked;
    await saveData(data);
    toast('Salvo ✓');
  });
  $('#imagesAllowed').addEventListener('change', async (e) => {
    data.settings.ai.imagesAllowed = e.target.checked;
    await saveData(data);
    toast('Salvo ✓');
  });
  $('#autoEnrich').addEventListener('change', async (e) => {
    data.settings.ai.autoEnrich = e.target.checked;
    await saveData(data);
    toast('Salvo ✓');
  });

  // ---------- Busca por significado ----------
  const semMsg = (txt, cls = '') => { const m = $('#semMsg'); m.className = 'msg ' + cls; m.textContent = t(txt); };
  const paintSem = async () => {
    const on = !!data.settings.ai.semantic;
    $('#semBox').hidden = !on;
    if (!on) return;
    const c = embedConfig(data.settings);
    $('#semIndex').hidden = $('#semClear').hidden = !c.supported;
    if (!c.supported) {
      $('#semInfo').textContent = t('A busca por significado precisa de um modelo de embeddings (Configurações → IA → Modelo por tarefa → Busca por significado). Sem ele, o "Pergunte ao cérebro" usa a própria IA para escolher as notas relevantes (sem índice).');
      return;
    }
    const st = await indexStatus(data.settings, await loadItems());
    $('#semInfo').textContent = `${t('Modelo')}: ${c.name} · ${c.embedModel} · ${st.done} ${t('de')} ${st.total} ${t('notas indexadas. Notas novas são indexadas sozinhas quando você abre uma nova aba.')}`;
  };
  $('#semantic').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const c = embedConfig(data.settings);
      if (!(await requestPermission(c).catch(() => false)) && c.base) { e.target.checked = false; return toast('Permissão negada pelo navegador.'); }
    }
    data.settings.ai.semantic = e.target.checked;
    await saveData(data);
    await paintSem();
    if (e.target.checked && embedConfig(data.settings).supported) $('#semIndex').click();
  });
  $('#semIndex').onclick = async () => {
    const prog = $('#semProg');
    prog.hidden = false;
    semMsg('Indexando…');
    try {
      const r = await indexItems(data.settings, await loadItems(), (done, total) => { prog.value = total ? done / total : 1; semMsg(`Indexando… ${done}/${total}`); });
      if (r?.busy) semMsg('Outra aba já está indexando. Aguarde um pouco.', '');
      else semMsg(`✓ ${r.done} notas indexadas.`, 'ok');
    } catch (err) {
      semMsg('✕ ' + err.message, 'err');
    }
    prog.hidden = true;
    paintSem();
  };
  $('#semClear').onclick = async () => {
    await clearIndex();
    await paintSem();
    $('#semIndex').click();
  };
  paintSem();
  $('#semantic').addEventListener('repaint', paintSem);

  // ---------- Onde a voz é processada (#49) ----------
  const voiceLangNow = () => data.settings.voiceLang || LOCALE;
  const paintEngine = async () => {
    configureSpeech(data.settings);
    const eng = data.settings.voiceEngine || 'auto';
    $('#whisperBox').hidden = !(eng === 'whisper' || data.settings.whisperUrl || (data.settings.voiceLocalOnly && !deviceSupported()));
    const st = await deviceStatus(voiceLangNow(), { fresh: true });
    const lang = voiceLangNow();
    const use = deviceLangFor(lang);
    const sub = use !== lang ? ` Este navegador não tem ${lang} no computador; vamos usar ${use}, que também entende essa fala (pode errar um pouco mais em palavras regionais).` : '';
    $('#deviceStatus').textContent = {
      available: `🔒 O reconhecimento de ${use} já está no computador: a fala não sai daqui.${sub}`,
      downloadable: `O reconhecimento de ${use} pode rodar no computador. Baixe uma vez (cerca de 60 MB) e o áudio deixa de ir para a nuvem.${sub}`,
      downloading: `Baixando o reconhecimento de ${use}…${sub}`,
      unavailable: `Este navegador não tem reconhecimento de ${lang} no computador. Use o Whisper local para não mandar o áudio para a nuvem.`,
      unsupported: 'Este navegador não reconhece a fala no próprio computador (precisa do Chrome ou Edge 139+). Use o Whisper local.',
    }[st] || '';
    $('#deviceInstall').hidden = st !== 'downloadable';
    const pick = currentEngine(lang);
    const aiLocal = isLocalAI(data.settings, 'chat');
    $('#localAiNote').hidden = !(data.settings.voiceLocalOnly && !aiLocal);
    $('#localAiNote').textContent = `ℹ️ A fala fica no computador, mas as perguntas para a IA vão para ${aiConfig(data.settings, 'chat').name}. Para tudo ficar local, escolha o Ollama em "IA".`;
    $('#voiceEngine').title = pick.engine ? (pick.local ? 'Agora: no computador 🔒' : 'Agora: serviço do navegador ☁') : (ENGINE_ERRORS[pick.reason] || '');
    const hasSR = speechAvailable();
    $('#wakeRow').hidden = !hasSR;
    $('#wakeNo').hidden = hasSR;
  };
  $('#deviceInstall').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Baixando… (pode levar alguns minutos)';
    const res = await installDevice(voiceLangNow());
    b.disabled = false;
    b.textContent = '⬇ Baixar o reconhecimento do idioma';
    const why = res.error === 'timeout' ? 'o navegador não respondeu em 3 minutos'
      : /NotAllowed/.test(res.error) ? 'o navegador pediu um novo clique; clique de novo no botão'
      : res.error ? res.error
      : `o navegador recusou o pacote de ${res.lang} (o Edge, por exemplo, só oferece alguns idiomas no computador)`;
    if (res.ok) toast(`Reconhecimento de ${res.lang} baixado: a fala agora fica no computador 🔒`);
    else $('#deviceStatus').textContent = `Não foi possível baixar: ${why}. Clique de novo para tentar outro idioma parecido, ou use o Whisper local abaixo.`;
    if (!res.ok) { $('#whisperBox').hidden = false; return; }
    paintEngine();
  });
  $('#whisperPresets').replaceChildren(...WHISPER_PRESETS.map((p) => h('button', { class: 'chip', type: 'button', title: p.url, onclick: async () => {
    await requestFeature('local'); // acesso ao localhost, direto no clique
    $('#whisperUrl').value = p.url;
    data.settings.whisperUrl = p.url;
    if (!data.settings.voiceEngine || data.settings.voiceEngine === 'auto') { data.settings.voiceEngine = 'whisper'; $('#voiceEngine').value = 'whisper'; }
    await saveData(data);
    toast(`${p.label} ✓`);
    paintEngine();
  } }, p.label)));
  $('#whisperTest').addEventListener('click', async () => {
    const msg = $('#whisperMsg');
    const url = $('#whisperUrl').value.trim();
    if (!url) { msg.textContent = 'Escreva o endereço primeiro.'; return; }
    // Acesso ao localhost: pedido aqui, no clique.
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url) && !(await requestFeature('local'))) { msg.textContent = '❌ Sem permissão para acessar o computador (localhost). Clique em Testar de novo e aceite o pedido do navegador.'; return; }
    msg.textContent = 'Testando…';
    try {
      const silence = encodeWav(new Float32Array(16000 * 0.6), 16000);
      const { init } = transcribeRequest(url, silence, { lang: voiceLangNow(), model: data.settings.whisperModel });
      const r = await fetch(url, init);
      msg.textContent = r.ok ? '✅ O Whisper respondeu. A voz pode ser reconhecida aqui no computador.' : `❌ O servidor respondeu ${r.status}. Confira o endereço (whisper.cpp usa /inference; Speaches e LocalAI usam /v1/audio/transcriptions).`;
    } catch {
      msg.textContent = '❌ Nada respondeu nesse endereço. O Whisper local é um programa à parte: ele precisa estar instalado e aberto no seu computador (veja o guia abaixo). Se ele já está aberto, confira a porta no endereço.';
    }
  });
  for (const k of ['voiceEngine', 'voiceLocalOnly', 'whisperUrl', 'voiceLang']) $(`[data-k="${k}"]`)?.addEventListener('change', () => setTimeout(paintEngine, 50));
  paintEngine();

  // ---------- Palavra de ativação ----------
  const paintWake = () => { $('#wakeWord').checked = !!data.settings.wakeWord; $('#wakeBox').hidden = !data.settings.wakeWord; };
  paintWake();

  // Nome do assistente e sugestões de frase (#15)
  const paintSuggest = () => {
    const box = $('#wakeSuggest');
    const lang = commandLang(data.settings.voiceLang || LOCALE);
    box.replaceChildren(...phraseSuggestions(assistantName(data.settings), lang).map((p) => h('button', {
      type: 'button',
      class: 'chip' + (wakePhraseOf(data.settings) === p ? ' on' : ''),
      onclick: async () => {
        $('#wakePhrase').value = p;
        data.settings.wakePhrase = p;
        await saveData(data);
        paintSuggest();
        toast('Salvo ✓');
      },
    }, '“' + p + '”')));
  };
  // Trocar o nome leva a frase junto, se ela ainda era o nome antigo
  $('#assistantName').addEventListener('input', (e) => {
    const old = assistantName(data.settings);
    const next = e.target.value.trim() || 'NeuroTab';
    const cur = String(data.settings.wakePhrase || '').trim();
    if (!cur || cur === old) { data.settings.wakePhrase = next; $('#wakePhrase').value = next; }
    data.settings.assistantName = e.target.value;
    paintSuggest();
  });
  $('#wakePhrase').addEventListener('input', () => setTimeout(paintSuggest, 600));
  paintSuggest();
  $('#wakeWord').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const ok = confirm('Ligar a palavra de ativação?\n\nEnquanto a nova aba estiver aberta e em foco, o navegador vai ouvir continuamente. No Edge e no Chrome, o áudio é enviado ao serviço de reconhecimento da Microsoft ou do Google.\n\nVocê pode pausar a qualquer momento pelo indicador no canto da tela.');
      if (!ok) { e.target.checked = false; return; }
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: true });
        st.getTracks().forEach((tr) => tr.stop());
      } catch {
        e.target.checked = false;
        return toast('O navegador bloqueou o microfone. Libere no ícone da barra de endereço.');
      }
    }
    data.settings.wakeWord = e.target.checked;
    await saveData(data);
    paintWake();
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
      const imported = await readSecrets(parsed.secrets);
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
      const nKeys = imported ? applySecrets(data.settings, imported, mode === 'replace') : 0;
      await saveData(data);
      if (parsed.background && (mode === 'replace' || !current)) {
        msg.textContent = 'Otimizando plano de fundo…';
        await saveBg(await optimizeImage(parsed.background));
        await showBgPreview();
      }
      fillSettings();
      msg.className = 'msg ok';
      msg.textContent = `✓ Importado: ${parsed.data.groups.length} grupos, ${parsed.data.links.length} atalhos${parsed.brain.length ? `, ${parsed.brain.length} notas` : ''}.`;
      if (nKeys) msg.textContent += ' ' + t('🔑 Chaves de API restauradas.');
      else if (parsed.secrets && !imported) msg.textContent += ' ' + t('Chaves de API não restauradas.');
      showStats();
    } catch (err) {
      console.error(err);
      msg.className = 'msg err';
      msg.textContent = '✕ ' + (err.message || 'Não foi possível importar.');
    }
  });
  const incl = $('#inclKeys');
  incl.addEventListener('change', () => { $('#keysBox').hidden = !incl.checked; });
  $('#exportBtn').addEventListener('click', async () => {
    let secrets = null;
    if (incl.checked) {
      const s = collectSecrets(data.settings);
      if (!Object.keys(s.aiKeys).length && !s.brapiToken) {
        alert('Não há chaves de API salvas para incluir.');
      } else {
        const p1 = $('#bkPwd').value;
        const p2 = $('#bkPwd2').value;
        if (p1 !== p2) { alert('As senhas não conferem.'); return; }
        if (p1) {
          if (p1.length < 6) { alert('Use uma senha com pelo menos 6 caracteres.'); return; }
          secrets = { protected: true, ...(await encryptJSON(s, p1)) };
        } else {
          if (!confirm('As chaves vão ficar legíveis no arquivo, sem senha. Quem tiver o arquivo poderá usá-las. Continuar?')) return;
          secrets = { protected: false, value: s };
        }
      }
    }
    const blob = new Blob([JSON.stringify(toBackup(data, await loadBg(), await loadItems(), secrets))], { type: 'application/json' });
    download(blob, `neurotab-backup-${today()}${secrets ? '-com-chaves' : ''}.json`);
    $('#bkPwd').value = $('#bkPwd2').value = '';
  });
}

// Lê os segredos do backup: pede a senha quando estão criptografados. Retorna null se pulados.
async function readSecrets(box) {
  if (!box) return null;
  if (!box.protected) return box.value || null;
  const dlg = $('#pwdDlg');
  const input = $('#pwdIn');
  const err = $('#pwdErr');
  err.textContent = '';
  input.value = '';
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); dlg.close('ok'); } };
  for (;;) {
    dlg.showModal();
    input.focus();
    const choice = await new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue), { once: true }));
    if (choice !== 'ok') return null;
    try {
      return await decryptJSON(box, input.value);
    } catch (e) {
      err.textContent = t(e.message);
      input.value = '';
    }
  }
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
    setHTML($('#pixQr'), qrSvg(code, { size: 200 }));
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
function toast(msg, action, fn) {
  const t = $('#toast');
  t.textContent = msg;
  if (action && fn) t.append(h('button', { type: 'button', class: 'toast-act', onclick: () => { t.hidden = true; fn(); } }, action));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 2200);
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
  // Conversa e visual da voz (0.8.2): ouvir a saudação e prévia do visual passando pelos estados.
  $('#testGreeting').onclick = () => speak(greetingFor({ ...data.settings, voiceGreeting: $('#voiceGreeting').value }, data.settings.voiceLang || LOCALE), { ...data.settings, voiceLang: data.settings.voiceLang || LOCALE });
  const pv = $('#vizPreview');
  if (pv) {
    const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const viz = createViz(pv, { style: data.settings.voiceViz, reduced, fps: 24 });
    const cycle = ['listening', 'thinking', 'speaking'];
    let i = 0;
    viz.setState(cycle[0]);
    setInterval(() => { if (!document.hidden) viz.setState(cycle[++i % cycle.length]); }, 2500);
    setInterval(() => { if (viz.state === 'speaking') viz.pulse(); }, 320);
    $('#voiceViz').addEventListener('change', (e) => viz.setStyle(e.target.value));
  }
  $('#shortcutsBtn').onclick = () => chrome.tabs.create({ url: navigator.userAgent.includes('Edg/') ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
  $('#testTimerSound').onclick = () => chrome.runtime.sendMessage({ type: 'previewSound', kind: $('#timerSound').value });
}

// ---------- Atualizações ----------
// ---------- Permissões ----------
async function renderPermissions() {
  const box = $('#permList');
  if (!box) return;
  const rows = [];
  for (const [id, f] of Object.entries(FEATURES)) {
    if (f.perSite) continue;
    const on = await hasFeature(id);
    let control;
    if (f.required) control = h('span', { class: 'perm-state on' }, 'Sempre ativo');
    else if (f.managed) control = h('span', { class: 'perm-state ' + (on ? 'on' : 'off') }, on ? 'Permitido' : 'Pedido ao configurar');
    else {
      control = h('div', { class: 'keybox' },
        h('span', { class: 'perm-state ' + (on ? 'on' : 'off') }, on ? 'Permitido' : 'Não permitido'),
        h('button', { class: 'btn', onclick: async () => { if (on) await revokeFeature(id); else await requestFeature(id); renderPermissions(); } }, on ? 'Remover' : 'Permitir'));
    }
    rows.push(h('div', { class: 'opt' }, h('div', {}, h('b', {}, f.label), h('small', {}, f.why)), control));
  }
  box.replaceChildren(...rows);
  const sites = await grantedSites();
  $('#permSites').replaceChildren(
    h('p', { class: 'hint' }, sites.length ? 'Sites liberados individualmente (feeds, imagens, IA com endereço próprio). Clique para remover:' : 'Nenhum site liberado individualmente.'),
    ...sites.map((o) => h('button', { class: 'chip', title: 'Remover acesso', onclick: async () => { await revokeSite(o); renderPermissions(); } }, o.replace(/\/\*$/, '') + ' ✕')));
}

function setupUpdatesOptions() {
  renderPermissions();
  chrome.permissions.onAdded?.addListener(renderPermissions);
  chrome.permissions.onRemoved?.addListener(renderPermissions);
  $('#verNow').textContent = chrome.runtime.getManifest().version;
  isStoreInstall().then((store) => {
    if (!store) return;
    $('#storeUpd').hidden = false;
    $('#updRow').hidden = true;
    $('#checkNow').hidden = true;
  });
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
  const msg = (txt, cls = 'ok') => { const m = $('#cleanMsg'); m.className = 'msg ' + cls; m.textContent = t(txt); };
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
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Remover';
    row.append(Object.assign(document.createElement('b'), { textContent: i === 0 ? '⭐' : '🕐' }), document.createElement('span'), btn);
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
