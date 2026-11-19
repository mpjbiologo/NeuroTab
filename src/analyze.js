// Janela "Analisar imagem" (#54/#17): texto lido no computador, descrição e perguntas pela IA
// (só com autorização quando a IA está na internet), endereço → rota no widget Trânsito.
import { loadData, saveData } from './lib/store.js';
import { initI18n, t } from './lib/i18n.js';
import { startIconizer } from './lib/icons.js';
import { aiConfig, isConfigured, isLocalAI, requestPermission } from './lib/ai.js';
import { visionNeedsConsent, visionTarget, visionSettings } from './lib/vision.js';
import { getCapture, analyzeCapture, captureStatus, keepCapture } from './lib/image-index.js';

const $ = (s) => document.querySelector(s);
const id = new URLSearchParams(location.search).get('id') || '';
let data;
let rec;

const say = (text, cls = '') => { $('#status').className = 'status ' + cls; $('#status').textContent = t(text); };

function show() {
  const ai = rec.ai || {};
  const read = ai.text || rec.ocrText || '';
  $('#readBox').hidden = !read;
  $('#read').textContent = read;
  $('#addrBox').hidden = !rec.address;
  if (rec.address && !$('#addr').matches(':focus')) $('#addr').value = rec.address;
  $('#aiOut').hidden = !ai.description;
  $('#desc').textContent = ai.description || '';
  $('#tags').replaceChildren(...(ai.tags || []).map((x) => Object.assign(document.createElement('span'), { className: 'tag', textContent: '#' + x })));
  $('#answer').hidden = !ai.answer;
  $('#answer').textContent = ai.answer ? `💬 ${ai.answer}` : '';
  $('#model').textContent = ai.model ? t('Descrito por') + ' ' + ai.model : '';
  const st = captureStatus(rec);
  showKeep();
  $('#saved').textContent = rec.temp ? '' : t(st === 'done' ? '🧠 Guardado no cérebro: a busca e as perguntas já encontram esta imagem.'
    : st === 'empty' ? 'Nenhum texto encontrado na imagem. Peça uma descrição à IA para o cérebro encontrá-la.'
    : st === 'error' ? 'A imagem continua na biblioteca, mas não deu para ler agora.' : '');
}

// Imagem aberta só para análise (Configurações → Mídia): guardar ou não na biblioteca.
let declined = false;
function showKeep() {
  const mode = data.settings.media?.save || 'ask';
  $('#keepBox').hidden = !rec.temp || (mode === 'ask' && declined);
  $('#keepText').textContent = t(mode === 'never' ? 'Esta imagem não foi guardada. Quer guardar na biblioteca?' : 'Guardar esta imagem na biblioteca? Assim o cérebro também a encontra depois.');
  $('#noKeep').hidden = mode === 'never';
}

async function keep() {
  $('#keep').disabled = true;
  try {
    rec = await keepCapture(id);
    show();
    say('💾 Guardada na biblioteca.', 'ok');
  } catch (e) {
    say(e.message, 'err');
  } finally {
    $('#keep').disabled = false;
  }
}

function setupAi() {
  const ready = isConfigured(visionSettings(data.settings));
  $('#noAi').hidden = ready;
  $('#askRow').hidden = !ready;
  const ask = ready && visionNeedsConsent(data.settings);
  $('#consent').hidden = !ask;
  $('#target').textContent = ready ? visionTarget(data.settings) : '';
  $('#describe').textContent = t(ask ? '✨ Enviar e descrever' : '✨ Descrever');
}

async function describe({ auto = false } = {}) {
  const s = data.settings;
  // Pedido de acesso ao provedor: direto no clique, sem await antes (Firefox).
  const vs = visionSettings(s);
  const perm = auto ? Promise.resolve(true) : requestPermission(aiConfig(vs)).catch(() => false);
  const always = $('#always').checked;
  $('#describe').disabled = true;
  try {
    if (!(await perm)) throw new Error('Acesso ao provedor de IA não autorizado.');
    if (always && !s.ai.imagesAllowed) {
      s.ai.imagesAllowed = true;
      await saveData(data);
      setupAi();
    }
    say(isLocalAI(vs) ? 'Descrevendo aqui no computador…' : `Enviando a imagem a ${visionTarget(s)}…`);
    const r = await analyzeCapture(s, id, { ocr: !rec.analyzedAt || !!rec.analyzeError, ai: true, allowed: true, question: $('#question').value.trim() });
    rec = r.rec;
    show();
    say('✓ Pronto.', 'ok');
  } catch (e) {
    rec = (await getCapture(id)) || rec;
    show();
    say(auto ? 'Para descrever, clique em Descrever.' : e.message, auto ? '' : 'err');
  } finally {
    $('#describe').disabled = false;
  }
}

(async () => {
  data = await loadData();
  initI18n(data.settings.lang);
  startIconizer();
  $('#close').onclick = () => window.close();
  $('#keep').onclick = keep;
  $('#noKeep').onclick = () => { declined = true; showKeep(); say('Ok, a imagem não será guardada.'); };
  rec = id ? await getCapture(id).catch(() => null) : null;
  if (!rec) {
    say('Imagem não encontrada na biblioteca.', 'err');
    $('#aiBox').hidden = true;
    return;
  }
  // Fechou sem guardar: o fundo da extensão apaga a imagem temporária (o que sobrar, a nova aba limpa depois).
  if (rec?.temp) chrome.runtime.connect({ name: 'analyze-temp:' + id });
  const url = URL.createObjectURL(rec.blob);
  $('#img').src = url;
  if (rec.pageUrl || rec.url) {
    const a = Object.assign(document.createElement('a'), { href: rec.pageUrl || rec.url, target: '_blank', rel: 'noopener noreferrer', textContent: rec.pageTitle || rec.pageUrl || rec.url });
    $('#src').replaceChildren(t('De: '), a);
  }
  $('#copy').onclick = async () => { await navigator.clipboard.writeText($('#read').textContent); say('Texto copiado.', 'ok'); };
  $('#route').onclick = () => {
    const to = $('#addr').value.trim();
    if (to) chrome.tabs.create({ url: chrome.runtime.getURL('src/newtab.html?route=' + encodeURIComponent(to)) });
  };
  $('#describe').onclick = () => describe();
  $('#question').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); describe(); } });
  setupAi();
  show();

  if (data.settings.imageOcr !== false && (!rec.analyzedAt || rec.analyzeError)) {
    say('Lendo o texto aqui no computador…');
    try {
      rec = (await analyzeCapture(data.settings, id, {
        ocr: true,
        onProgress: (m) => { if (/language/.test(m.status || '') && m.progress < 1) say('Baixando o pacote do idioma (só na primeira vez)…'); },
      })).rec;
      say(rec.ocrText ? '✓ Texto lido no computador.' : 'Nenhum texto encontrado na imagem.', rec.ocrText ? 'ok' : '');
    } catch (e) {
      rec = (await getCapture(id)) || rec;
      say(e.message, 'err');
    }
    show();
  } else if (data.settings.imageOcr === false && !rec.analyzedAt) {
    say('A leitura do texto está desligada nas configurações.');
  }
  // IA no próprio computador: descreve sem perguntar.
  const vs = visionSettings(data.settings);
  if (isConfigured(vs) && isLocalAI(vs) && !rec.ai?.description) describe({ auto: true });
})();
