// NeuroTab — página "Qual é a melhor IA para o meu computador?" (0.8.1, #61).
// 1) explica e detecta → 2) revisão (detectado × informado) → 3) recomendações → 4) guia, baixar, usar e testar.
import { h } from './lib/ui.js';
import { loadData, saveData } from './lib/store.js';
import { initI18n, t } from './lib/i18n.js';
import { startIconizer } from './lib/icons.js';
import { requestAccess } from './lib/permissions.js';
import { askPonte, ponteAllowed } from './lib/net-ponte.js';
import { requestPermission, aiOf } from './lib/ai.js';
import { sanitizeAi, addOllamaModel } from './lib/ai/config.js';
import { recommend, finalHw, PURPOSES, GRADES, WHERE_RUN, HW_FIELDS } from './lib/ai/advisor.js';
import { loadCatalog, updateCatalog } from './lib/ai/catalog-store.js';
import { detectHardware } from './lib/hw-detect.js';
import { ollamaStatus, pullModel, benchmark, speedVerdict, OLLAMA_DEFAULT, ollamaRoot } from './lib/ollama.js';
import { ponteDownloads } from './widgets/clipboard-share-ui.js';

const $ = (s) => document.querySelector(s);
const copyText = (text) => navigator.clipboard.writeText(text).catch(() => {});
const KEY = 'nt_advisor';
let data;
let catalog;
let diag = null; // { at, detected, sources, manual }
let ollama = null; // resultado de ollamaStatus
let guideModel = '';
let guideOs = '';
let lastResult = null;
const pulls = new Map(); // modelo → AbortController

const LABELS = {
  ramGB: ['Memória (RAM), em GB', 'number'],
  threads: ['Processador: núcleos lógicos (threads)', 'number'],
  cpuModel: ['Processador: modelo', 'text'],
  os: ['Sistema', 'os'],
  arch: ['Arquitetura', 'text'],
  gpuVendor: ['Placa de vídeo: fabricante', 'vendor'],
  gpuName: ['Placa de vídeo: modelo', 'text'],
  vramGB: ['Memória da placa de vídeo (VRAM), em GB', 'number'],
  diskFreeGB: ['Espaço livre no disco, em GB', 'number'],
};
const SRC = {
  ponte: ['✅', 'NeuroTab Ponte'], browser: ['✅', 'navegador'], lhm: ['✅', 'LibreHardwareMonitor'],
  estimate: ['⚠️', 'estimado pelo navegador'], manual: ['✍️', 'informado por você'], missing: ['❓', 'não disponível'], unknown: ['❓', 'você marcou "não sei"'],
};
const HELP = {
  windows: {
    ramGB: 'Gerenciador de Tarefas (Ctrl+Shift+Esc) → Desempenho → Memória.',
    vramGB: 'Gerenciador de Tarefas → Desempenho → GPU → "Memória dedicada da GPU".',
    gpuName: 'Gerenciador de Tarefas → Desempenho → GPU (o nome aparece no alto, à direita).',
    diskFreeGB: 'Explorador de Arquivos → Este Computador → disco C:.',
    threads: 'Gerenciador de Tarefas → Desempenho → CPU → "Processadores lógicos".',
  },
  mac: {
    ramGB: 'Menu Apple  → Sobre Este Mac → Memória.',
    gpuName: 'Menu Apple  → Sobre Este Mac → Chip (M1, M2…): a placa de vídeo é a do próprio chip.',
    vramGB: 'Nos Macs com chip M1/M2/M3/M4 a memória é compartilhada: deixe em branco.',
    diskFreeGB: 'Ajustes do Sistema → Geral → Armazenamento.',
    threads: 'Menu Apple  → Sobre Este Mac → Mais Informações → Relatório do Sistema → Hardware.',
  },
  linux: {
    ramGB: 'No terminal: free -h',
    vramGB: 'NVIDIA: nvidia-smi · AMD: rocm-smi --showmeminfo vram',
    gpuName: 'No terminal: lspci | grep -i vga',
    diskFreeGB: 'No terminal: df -h ~',
    threads: 'No terminal: nproc',
  },
};

// ---------- diagnóstico ----------
async function saveDiag() { await chrome.storage.local.set({ [KEY]: diag }); }

async function runDetect() {
  $('#introMsg').textContent = '⏳ ' + t('Verificando o computador…');
  const r = await detectHardware(data.settings);
  diag = { at: Date.now(), detected: r.detected, sources: r.sources, manual: diag?.manual || {} };
  await saveDiag();
  const used = [r.sources.ponte && 'NeuroTab Ponte', r.sources.browser && t('navegador'), r.sources.lhm && 'LibreHardwareMonitor'].filter(Boolean);
  $('#introMsg').textContent = used.length ? `${t('Lido com')}: ${used.join(', ')}.` : t('Sem a NeuroTab Ponte, a NeuroTab só consegue estimar. Confira e complete os dados abaixo.');
  paintHw();
  checkOllama(false);
}

function paintHw() {
  const os = finalHw(diag.detected, diag.manual).hw.os || '';
  const rows = HW_FIELDS.map((f) => {
    const [label, kind] = LABELS[f];
    const d = diag.detected[f];
    const m = diag.manual[f];
    const { src, divergences } = finalHw(diag.detected, diag.manual);
    let input;
    if (kind === 'os') input = h('select', {}, ...[['', '—'], ['windows', 'Windows'], ['mac', 'macOS'], ['linux', 'Linux']].map(([v, l]) => new Option(l, v)));
    else if (kind === 'vendor') input = h('select', {}, ...[['', '—'], ['nvidia', 'NVIDIA'], ['amd', 'AMD'], ['intel', t('Intel (integrada)')], ['apple', t('Apple (chip M)')]].map(([v, l]) => new Option(t(l), v)));
    else input = h('input', { type: kind, step: 'any', min: 0, placeholder: d?.value != null ? String(d.value) : t('não sei') });
    input.value = m != null && m !== 'unknown' ? m : d?.value ?? '';
    input.addEventListener('change', async () => {
      const raw = input.value.trim();
      const v = kind === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
      if (v === '' || (d && String(d.value) === String(v))) delete diag.manual[f]; else diag.manual[f] = v;
      await saveDiag();
      paintHw();
    });
    const unknown = h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: m === 'unknown', onchange: async (e) => { if (e.target.checked) diag.manual[f] = 'unknown'; else delete diag.manual[f]; await saveDiag(); paintHw(); } }), ' ', t('não sei'));
    const s = SRC[src[f]] || SRC.missing;
    const dv = divergences.find((x) => x.field === f);
    const help = (src[f] === 'missing' || src[f] === 'estimate') && HELP[os || 'windows']?.[f];
    return h('div', { class: 'hw-row' },
      h('span', {}, t(label)),
      input,
      h('span', { class: 'row' }, h('span', { class: 'badge b-' + src[f], title: t(s[1]) }, s[0], ' ', t(s[1])), unknown,
        dv ? h('span', { class: 'div' }, `⚠️ ${t('Detectado')}: ${dv.detected} (${t(SRC[dv.detectedSrc]?.[1] || '')}). ${t('Vale o que você escreveu.')} `, h('button', { class: 'btn sm', onclick: async () => { delete diag.manual[f]; await saveDiag(); paintHw(); } }, t('Usar o detectado'))) : null,
        help ? h('span', { class: 'small muted' }, '💡 ', t(help)) : null));
  });
  $('#hw').replaceChildren(...rows);
  $('#hwSec').hidden = false;
  $('#ollamaSec').hidden = false;
  paintFoot();
}

// ---------- Ollama ----------
function ollamaBase() {
  const s = aiOf(data.settings).servers.find((x) => x.type === 'ollama' && x.on);
  return s ? ollamaRoot(s.base) : OLLAMA_DEFAULT;
}

async function checkOllama(ask) {
  const base = ollamaBase();
  $('#ollamaAddr').textContent = base;
  if (ask) {
    const ok = await requestPermission({ base: base + '/v1' }).catch(() => false);
    if (!ok) { $('#ollamaStatus').textContent = t('Sem a permissão, a NeuroTab não consegue ver o Ollama.'); return; }
  } else if (!(await chrome.permissions.contains({ origins: [new URL(base).origin + '/*'] }).catch(() => false))) {
    $('#ollamaStatus').textContent = t('Clique em "Verificar o Ollama" para ver se ele está instalado e quais modelos já tem.');
    return;
  }
  $('#ollamaStatus').textContent = '⏳ ' + t('Procurando o Ollama…');
  ollama = await ollamaStatus(base);
  const st = $('#ollamaStatus');
  if (ollama.ok) {
    st.className = 'small ok';
    st.textContent = `✅ ${t('Ollama')} ${ollama.version} ${t('respondendo')}. ${ollama.models.length ? `${t('Modelos instalados')}: ${ollama.models.map((m) => m.name).join(', ')}` : t('Nenhum modelo instalado ainda.')}`;
  } else {
    st.className = 'small warn';
    st.textContent = `⚠️ ${t(ollama.error)} ${t('Se ainda não instalou, veja o guia abaixo.')}`;
  }
  if (lastResult) paintResults();
}

// ---------- recomendações ----------
const installedNames = () => (ollama?.ok ? ollama.models.map((m) => m.name) : []);

function paintResults() {
  const { hw } = finalHw(diag.detected, diag.manual);
  lastResult = recommend(catalog, hw, { installed: installedNames() });
  const r = lastResult;
  const g = GRADES[r.grade];
  const notes = [];
  if (r.budget.assumptions.includes('ram')) notes.push(t('Sem a quantidade de RAM, as recomendações supõem 8 GB. Preencha acima para ficarem certas.'));
  if (r.budget.assumptions.includes('vram')) notes.push(t('Sem a memória da placa de vídeo, as contas foram feitas só pelo processador. Preencha a VRAM para ver modelos que rodam na placa.'));
  if (r.budget.assumptions.includes('igpu')) notes.push(t('O Ollama não usa as placas de vídeo integradas da Intel: as contas são pelo processador.'));
  if (hw.gpuVendor === 'amd') notes.push(t('Placas AMD: o Ollama usa as Radeon mais recentes (série RX 6000 em diante, na maioria dos casos). Se a sua não for compatível, ele roda no processador.'));
  const summary = h('p', { class: 'small muted' },
    `${t('RAM')}: ${hw.ramGB ?? '?'} GB (${t('reserva para o sistema')}: ${r.budget.reserve} GB) · `,
    `${t('Placa de vídeo')}: ${hw.gpuName || hw.gpuVendor || '?'}${hw.vramGB ? ` (${hw.vramGB} GB)` : ''}${r.budget.unified ? ` · ${t('memória compartilhada (Apple)')}` : ''} · `,
    `${t('Disco livre')}: ${hw.diskFreeGB ?? '?'} GB`);
  const sections = Object.entries(PURPOSES).map(([p, def]) => {
    const { best, lighter, stronger } = r.purposes[p];
    const cards = [[best, 'Recomendada', true], [lighter, 'Mais leve', false], [stronger, 'Mais forte (se aceitar lentidão)', false]].filter(([c]) => c).map(([c, tag, main]) => modelCard(c, tag, main, p));
    return h('div', { class: 'purpose' }, h('h3', {}, def.icon, ' ', t(def.label)),
      cards.length ? h('div', { class: 'cards' }, ...cards) : h('p', { class: 'small muted' }, t('Nenhum modelo cabe com folga neste computador para esta finalidade.')));
  });
  $('#results').replaceChildren(
    h('h2', {}, t('Resultado')),
    h('p', { class: 'grade' }, g.icon, ' ', t(g.label)), h('p', {}, t(g.text)), summary,
    ...notes.map((n) => h('p', { class: 'small warn' }, 'ℹ️ ', n)),
    ...sections,
    h('p', { class: 'small muted' }, t('Os números são aproximados: a memória usada varia com o tamanho da conversa e com outros programas abertos. Depois de instalar, use "Testar no meu computador" para ver a velocidade real.')));
  $('#results').hidden = false;
  if (!guideModel) guideModel = r.purposes.chat.best?.model.id || r.purposes.search.best?.model.id || 'qwen3.5:4b';
  paintGuide();
  paintCloud(r);
  paintFoot();
}

function modelCard(c, tag, main, purpose) {
  const m = c.model;
  const w = WHERE_RUN[c.where];
  const inst = installedNames().some((n) => n === m.id || n === m.id + ':latest' || n.replace(/:latest$/, '') === m.id);
  const prog = h('div', { class: 'small' });
  const actions = h('div', { class: 'row' });
  const paintActions = () => {
    const kids = [h('button', { class: 'btn sm', onclick: () => { guideModel = m.id; paintGuide(); $('#guide').scrollIntoView({ behavior: 'smooth' }); } }, '📋 ', t('Guia'))];
    if (ollama?.ok && !inst) kids.push(h('button', { class: 'btn sm', onclick: () => pull(m, prog, paintActions) }, '⬇ ', t('Baixar este modelo')));
    if (inst) {
      kids.push(h('button', { class: 'btn sm primary', onclick: () => useIt(m, purpose, prog) }, '✅ ', t('Usar no NeuroTab')));
      kids.push(h('button', { class: 'btn sm', onclick: () => test(m, prog) }, '⏱ ', t('Testar no meu computador')));
    }
    actions.replaceChildren(...kids);
  };
  paintActions();
  return h('div', { class: 'card' + (main ? ' main' : '') },
    h('span', { class: 'tag' }, t(tag)),
    h('code', {}, m.id),
    h('span', { class: 'small muted' }, m.family, m.moe ? ` · ${t('mistura de especialistas')}` : '', inst ? ' · ✅ ' + t('instalado') : ''),
    h('p', { class: 'small' }, t(m.note)),
    h('ul', {},
      h('li', {}, `${t('Memória')}: ~${c.need} GB · ${t('Download')}: ${m.sizeGB} GB`),
      h('li', {}, w.icon, ' ', t('Roda'), ' ', t(w.label), c.speed ? ` · ${t('velocidade')}: ${t(c.speed)}` : ''),
      h('li', {}, `${t('Português')}: ${'★'.repeat(m.ptbr)}${'☆'.repeat(3 - m.ptbr)} · ${t('Qualidade')}: ${'★'.repeat(m.quality)}${'☆'.repeat(5 - m.quality)}`),
      m.vision ? h('li', {}, '👁 ', t('Lê imagens')) : null,
      m.minOllama ? h('li', {}, t('Precisa do Ollama'), ` ${m.minOllama}+`) : null),
    actions, prog);
}

async function pull(m, prog, repaint) {
  if (!confirm(`${t('Baixar')} ${m.id} (~${m.sizeGB} GB) ${t('pelo Ollama? Pode levar alguns minutos.')}`)) return;
  const ctl = new AbortController();
  pulls.set(m.id, ctl);
  const bar = h('i', { style: { width: '0%' } });
  const label = h('span', {}, t('Começando…'));
  prog.replaceChildren(h('div', { class: 'bar' }, bar), h('div', { class: 'row' }, label, h('button', { class: 'btn sm', onclick: () => ctl.abort() }, t('Cancelar'))));
  try {
    await pullModel(ollamaBase(), m.id, {
      signal: ctl.signal,
      onProgress: (p) => { if (p.pct != null) bar.style.width = p.pct + '%'; label.textContent = `${p.status}${p.pct != null ? ` — ${p.pct}%` : ''}`; },
    });
    prog.replaceChildren(h('span', { class: 'ok' }, '✅ ', t('Baixado.')));
    await checkOllama(false);
  } catch (e) {
    prog.replaceChildren(h('span', { class: e.name === 'AbortError' ? 'muted' : 'err' }, e.name === 'AbortError' ? t('Download cancelado.') : '✕ ' + e.message));
  } finally {
    pulls.delete(m.id);
    repaint();
  }
}

async function useIt(m, purpose, prog) {
  const tasks = PURPOSES[purpose].tasks;
  const choice = h('select', {},
    new Option(t('Só para') + ' ' + t(PURPOSES[purpose].label).toLowerCase(), 'tasks'),
    ...(purpose === 'chat' ? [new Option(t('Como Padrão (tudo usa este modelo)'), 'primary')] : []),
    new Option(t('Só adicionar à lista de modelos'), 'add'));
  const dlg = h('dialog', { class: 'card', style: { maxWidth: '420px' } }, h('form', { method: 'dialog', style: { display: 'grid', gap: '10px' } },
    h('b', {}, `${t('Usar')} ${m.id} ${t('no NeuroTab')}`), choice,
    h('div', { class: 'row' }, h('button', { class: 'btn', value: 'cancel' }, t('Cancelar')), h('button', { class: 'btn primary', value: 'ok' }, t('Salvar')))));
  document.body.append(dlg);
  dlg.showModal();
  await new Promise((r) => dlg.addEventListener('close', r, { once: true }));
  dlg.remove();
  if (dlg.returnValue !== 'ok') return;
  const use = choice.value === 'primary' ? 'primary' : choice.value === 'tasks' ? tasks : null;
  data = await loadData();
  data.settings.ai = sanitizeAi(addOllamaModel(aiOf(data.settings), ollamaBase(), m.id, { caps: { vision: m.vision, embed: m.embed }, use }), data.settings.media);
  await saveData(data);
  prog.replaceChildren(h('span', { class: 'ok' }, '✅ ', use === 'primary' ? t('Agora é o Padrão da NeuroTab.') : use ? t('Configurado para esta finalidade.') : t('Adicionado à lista do Ollama.'), ' '),
    h('a', { href: chrome.runtime.getURL('src/options.html#ia-tarefas'), target: '_blank' }, t('Ver em Modelo por tarefa')));
}

async function test(m, prog) {
  prog.replaceChildren(h('span', {}, '⏳ ', t('Testando (a primeira vez carrega o modelo na memória e demora mais)…')));
  try {
    const r = await benchmark(ollamaBase(), m.id);
    const v = speedVerdict(r.tokensPerSec);
    prog.replaceChildren(h('div', { class: 'small' },
      h('b', {}, v.icon, ' ', `~${r.wordsPerSec} ${t('palavras por segundo')}`), ` (${r.tokensPerSec} tokens/s) — ${t(v.text)}.`,
      r.gpuPct != null ? h('div', {}, r.gpuPct >= 95 ? '🎮 ' + t('Rodou inteiro na placa de vídeo.') : r.gpuPct > 0 ? `⚖️ ${r.gpuPct}% ${t('na placa de vídeo, o resto no processador.')}` : '🧠 ' + t('Rodou no processador.')) : null));
  } catch (e) {
    prog.replaceChildren(h('span', { class: 'err' }, '✕ ', e.message));
  }
}

// ---------- guia ----------
function cmd(text) {
  return h('div', { class: 'cmd' }, h('code', {}, text), h('button', { class: 'btn sm', onclick: async (e) => { await copyText(text); e.target.textContent = '✓'; setTimeout(() => { e.target.textContent = t('Copiar'); }, 1500); } }, t('Copiar')));
}

function paintGuide() {
  const os = guideOs || finalHw(diag.detected, diag.manual).hw.os || 'windows';
  const m = guideModel;
  const origins = 'chrome-extension://*,moz-extension://*';
  const tabs = h('div', { class: 'tabs' }, ...[['windows', 'Windows'], ['mac', 'macOS'], ['linux', 'Linux']].map(([k, l]) => h('button', { class: 'btn sm', 'aria-pressed': String(os === k), onclick: () => { guideOs = k; paintGuide(); } }, l)));
  const install = {
    windows: [h('span', {}, t('Baixe e instale o Ollama para Windows'), ': '), h('a', { href: 'https://ollama.com/download/windows', target: '_blank', rel: 'noopener' }, 'ollama.com/download/windows')],
    mac: [h('span', {}, t('Baixe o Ollama para macOS e arraste para Aplicativos'), ': '), h('a', { href: 'https://ollama.com/download/mac', target: '_blank', rel: 'noopener' }, 'ollama.com/download/mac')],
    linux: [h('span', {}, t('No terminal')), cmd('curl -fsSL https://ollama.com/install.sh | sh')],
  }[os];
  const allow = {
    windows: [h('span', {}, t('No PowerShell, rode o comando abaixo. Depois feche o Ollama (ícone perto do relógio → Quit Ollama) e abra de novo.')), cmd(`setx OLLAMA_ORIGINS "${origins}"`)],
    mac: [h('span', {}, t('No Terminal, rode o comando abaixo. Depois feche o Ollama (ícone na barra de menus → Quit Ollama) e abra de novo.')), cmd(`launchctl setenv OLLAMA_ORIGINS "${origins}"`)],
    linux: [h('span', {}, t('Rode o comando abaixo, acrescente as duas linhas no editor que abrir, salve e reinicie o serviço.')), cmd('sudo systemctl edit ollama'), cmd(`[Service]\nEnvironment="OLLAMA_ORIGINS=${origins}"`), cmd('sudo systemctl restart ollama')],
  }[os];
  const steps = [
    ['Instalar o Ollama', install],
    ['Liberar a NeuroTab', [h('span', {}, t('Por segurança, o Ollama só aceita pedidos de outros programas que você liberar.'), ' '), ...allow]],
    ['Conferir se está funcionando', [cmd('ollama --version'), h('span', { class: 'small muted' }, t('Aqui na página, clique em "Verificar o Ollama".'))]],
    ['Baixar o modelo', [h('span', {}, t('Use o botão "⬇ Baixar este modelo" no cartão, ou no terminal:')), cmd(`ollama pull ${m}`)]],
    ['Testar', [cmd(`ollama run ${m} "Olá! Responda em uma frase."`), h('span', { class: 'small muted' }, t('Para sair, digite /bye.'))]],
    ['Ligar à NeuroTab', [h('span', {}, t('Clique em "✅ Usar no NeuroTab" no cartão do modelo. Ou, em Configurações → IA → Servidores e modelos: Adicionar servidor → Ollama → endereço'), ' '), h('code', {}, 'http://localhost:11434/v1'), h('span', {}, ' → ', t('Carregar modelos.'))]],
    ['Atualizar, remover ou trocar', [cmd(`ollama pull ${m}`), cmd(`ollama rm ${m}`), cmd('ollama list')]],
  ];
  const trouble = [
    ['A NeuroTab diz que o Ollama não respondeu', 'Confira se o Ollama está aberto e se o passo 2 (liberar a NeuroTab) foi feito; feche e abra o Ollama de novo.'],
    ['Erro de memória ou o computador trava', 'Use a opção "Mais leve" e feche programas pesados. Modelos maiores que a memória ficam lentíssimos ou nem abrem.'],
    ['Muito lento', 'Use "Testar no meu computador": se a maior parte rodar no processador, escolha um modelo menor ou um que caiba inteiro na placa de vídeo.'],
    ['Endereço ou porta errados', 'O padrão é http://localhost:11434. Se mudou a porta (OLLAMA_HOST), use o mesmo endereço em Configurações → IA.'],
    ['"model not found"', `O modelo não foi baixado: rode ollama pull ${m} (o nome tem que ser exatamente igual).`],
  ];
  $('#guide').replaceChildren(
    h('h2', {}, t('Guia de instalação')), tabs,
    h('p', { class: 'small muted' }, t('Modelo do guia'), ': ', h('code', {}, m), ' · ', h('a', { href: 'https://docs.ollama.com', target: '_blank', rel: 'noopener' }, t('Documentação oficial do Ollama'))),
    h('ol', {}, ...steps.map(([title, body]) => h('li', {}, h('b', {}, t(title)), h('div', {}, ...body)))),
    h('h3', {}, t('Problemas comuns')),
    h('ul', { class: 'small' }, ...trouble.map(([q, a]) => h('li', {}, h('b', {}, t(q)), ': ', t(a)))));
  $('#guide').hidden = false;
}

function paintCloud(r) {
  const sec = $('#cloud');
  sec.hidden = !r.cloud;
  if (!r.cloud) return;
  sec.replaceChildren(h('h2', {}, '☁️ ', t('IA na internet')),
    h('p', {}, t('Neste computador, a IA local fica lenta ou não cabe. Uma IA na internet responde rápido em qualquer computador:')),
    h('ul', {},
      h('li', {}, h('b', {}, 'Google Gemini'), ' — ', t('tem camada gratuita; a chave sai em aistudio.google.com.')),
      h('li', {}, h('b', {}, 'OpenRouter'), ' — ', t('uma chave para modelos de vários fornecedores, alguns gratuitos.'))),
    h('p', { class: 'small warn' }, '⚠️ ', t('Com IA na internet, o texto das notas e das perguntas vai para o fornecedor escolhido, com a sua chave. Configure em Configurações → IA.')),
    h('a', { class: 'btn', href: chrome.runtime.getURL('src/options.html#ia'), target: '_blank' }, t('Abrir Configurações → IA')));
}

function paintFoot() {
  $('#foot').hidden = !diag;
  if (diag) $('#diagAt').textContent = `${t('Diagnóstico de')} ${new Date(diag.at).toLocaleString()}`;
  if (catalog) $('#catInfo').textContent = `${t('Recomendações')}: ${t('versão')} ${catalog.version} (${catalog.updated})${catalog.from === 'github' ? ' · GitHub' : ''}`;
}

// ---------- início ----------
async function init() {
  data = await loadData();
  initI18n(data.settings.lang);
  startIconizer();
  catalog = await loadCatalog();
  updateCatalog().then((r) => { if (r.updated) { catalog = r.catalog; if (lastResult) paintResults(); else paintFoot(); } }).catch(() => {});
  const browserOk = !!globalThis.chrome?.system?.cpu || !navigator.userAgent.includes('Firefox');
  $('#useBrowser').hidden = !browserOk || (await chrome.permissions.contains({ permissions: ['system.cpu', 'system.memory'] }).catch(() => true));
  $('#usePonte').hidden = await ponteAllowed();
  $('#usePonte').onclick = async () => {
    if (await askPonte()) { $('#usePonte').hidden = true; if (diag) runDetect(); }
  };
  $('#useBrowser').onclick = async () => {
    if (await requestAccess({ permissions: ['system.cpu', 'system.memory'] })) { $('#useBrowser').hidden = true; if (diag) runDetect(); }
  };
  $('#start').onclick = runDetect;
  $('#calc').onclick = () => { paintResults(); $('#results').scrollIntoView({ behavior: 'smooth' }); };
  $('#ollamaCheck').onclick = () => checkOllama(true);
  $('#redo').onclick = () => { diag = { ...diag, manual: {} }; runDetect(); };
  $('#forget').onclick = async () => {
    await chrome.storage.local.remove(KEY);
    diag = null;
    lastResult = null;
    for (const s of ['#hwSec', '#ollamaSec', '#results', '#guide', '#cloud']) $(s).hidden = true;
    $('#introMsg').textContent = t('Diagnóstico apagado.');
    paintFoot();
  };
  $('#catUpdate').onclick = async () => {
    $('#catInfo').textContent = '⏳ ' + t('Procurando recomendações novas…');
    const r = await updateCatalog({ force: true });
    catalog = r.catalog;
    paintFoot();
    if (r.error) $('#catInfo').textContent += ` · ${t('não deu para atualizar')}: ${r.error}`;
    else if (!r.updated) $('#catInfo').textContent += ` · ${t('já é a mais nova')}`;
    if (lastResult) paintResults();
  };
  // diagnóstico guardado: mostra de novo, sem detectar outra vez
  diag = (await chrome.storage.local.get(KEY))[KEY] || null;
  if (diag) { paintHw(); checkOllama(false); paintResults(); }
  const dl = ponteDownloads();
  $('#introMsg').append(...(diag ? [] : [h('span', { class: 'muted' }, t('Não tem a Ponte?'), ' '), h('a', { href: dl.url(dl.mine), target: '_blank', rel: 'noopener' }, t('Baixar para'), ' ', dl.all[dl.mine].label)]));
}

init();
