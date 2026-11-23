// Configurações → IA (0.8.0, #63): servidores e modelos, Padrão e Reserva, modelo por tarefa,
// exportar e importar a configuração (sem as chaves).
import { h, toast as uiToast } from './lib/ui.js';
import { t } from './lib/i18n.js';
import { saveData } from './lib/store.js';
import { requestPermission, listServerModels, testServer, aiOf } from './lib/ai.js';
import { PROVIDERS, SHORT, WHERE, whereOf, guessCaps, EMBED_DEFAULTS } from './lib/ai/catalog.js';
import { sanitizeAi, newServerId, serverById, exportAi, importAi, modelCaps, defaultModelFor, removeServer as removeServerCfg } from './lib/ai/config.js';
import { TASKS, EXTERNAL_TASKS } from './lib/ai/tasks.js';
import { resolve, check, pickLabel, PROBLEMS } from './lib/ai/router.js';
import { modelOptions } from './lib/ai-ui.js';

let api;
const $ = (s) => document.querySelector(s);
const D = () => api.data();
const toast = (m) => (api.toast || uiToast)(m);
const status = new Map(); // id do servidor → { ok, text }

async function commit(ai) {
  const d = D();
  d.settings.ai = sanitizeAi(ai, d.settings.media);
  await saveData(d);
  paintAll();
  api.onChange?.();
}

const enc = (v) => JSON.stringify({ server: v.server, model: v.model || '' });
const dec = (s) => { try { const v = JSON.parse(s); return v?.server ? v : null; } catch { return null; } };
const whereChip = (w) => h('span', { class: 'ai-where ai-where-' + w, title: t(WHERE[w].label) }, WHERE[w].icon, ' ', t(WHERE[w].label));

// ---------- Padrão e Reserva ----------
function paintRoles() {
  const ai = aiOf(D().settings);
  const opts = modelOptions(D().settings, 'chat');
  const fill = (sel, cur, none) => {
    sel.replaceChildren();
    if (none) sel.add(new Option(t(none), ''));
    const list = [...opts];
    if (cur?.server && !list.some((o) => o.server === cur.server && o.model === cur.model)) {
      const s = serverById(ai, cur.server);
      if (s) list.unshift({ server: cur.server, model: cur.model, label: `${s.name} · ${cur.model}`, where: whereOf(s.type, s.base) });
    }
    for (const o of list) sel.add(new Option(`${WHERE[o.where].icon} ${o.label}`, enc(o)));
    if (!list.length && !none) sel.add(new Option(t('Adicione um servidor abaixo'), ''));
    sel.value = cur?.server ? enc(cur) : '';
  };
  fill($('#aiPrimary'), ai.primary, '');
  fill($('#aiReserve'), ai.reserve, 'Nenhuma');
}

// ---------- Servidores ----------
function serverCard(s) {
  const ai = aiOf(D().settings);
  const w = whereOf(s.type, s.base);
  const st = status.get(s.id);
  const roles = [ai.primary.server === s.id && t('Padrão'), ai.reserve?.server === s.id && t('Reserva')].filter(Boolean).join(' · ');
  const capIcons = (m) => { const c = modelCaps(s, m.id); return `${c.vision ? ' 👁' : ''}${c.embed ? ' 🔎' : ''}`; };
  return h('div', { class: 'ai-server' + (s.on ? '' : ' off'), 'data-id': s.id },
    h('div', { class: 'ai-sh' },
      h('b', {}, s.name), h('small', { class: 'muted' }, SHORT[s.type]), whereChip(w),
      roles ? h('span', { class: 'ai-role' }, roles) : null,
      h('span', { class: 'grow' }),
      st ? h('small', { class: st.ok ? 'ok' : 'err', title: st.text }, st.ok ? '● ' : '✕ ', st.short || st.text) : !s.on ? h('small', { class: 'muted' }, t('desligado')) : null),
    PROVIDERS[s.type].editableBase ? h('small', { class: 'muted ai-base' }, s.base) : null,
    !PROVIDERS[s.type].noKey && !ai.keys?.[s.id] ? h('small', { class: 'err' }, '⚠️ ', t('Falta a chave de API.')) : null,
    h('div', { class: 'ai-models' }, ...(s.models.length ? s.models.map((m) => h('span', { class: 'chip-s', title: t('👁 lê imagens · 🔎 embeddings (busca por significado)') }, m.id, capIcons(m))) : [h('small', { class: 'muted' }, t('Nenhum modelo escolhido ainda. Clique em Editar → Carregar modelos.'))])),
    h('div', { class: 'ai-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => test(s.id) }, t('Testar')),
      h('button', { type: 'button', class: 'btn', onclick: () => editServer(s.id) }, t('Editar')),
      h('button', { type: 'button', class: 'btn', onclick: async () => { const a = aiOf(D().settings); serverById(a, s.id).on = !s.on; await commit(a); } }, s.on ? t('Desligar') : t('Ligar')),
      h('button', { type: 'button', class: 'btn', onclick: () => removeServer(s.id) }, t('Remover'))));
}

function paintServers() {
  const ai = aiOf(D().settings);
  $('#aiServers').replaceChildren(...(ai.servers.length ? ai.servers.map(serverCard)
    : [h('p', { class: 'hint ai-empty' }, t('Nenhum servidor ainda. O Gemini tem camada gratuita; o Ollama roda no seu computador, sem chave e sem internet.'))]));
}

async function test(id) {
  const ai = aiOf(D().settings);
  const s = serverById(ai, id);
  const model = ai.primary.server === id ? ai.primary.model : s.models.find((m) => modelCaps(s, m.id).text !== false)?.id || PROVIDERS[s.type].defaultModel;
  if (!model) { status.set(id, { ok: false, text: t('Escolha um modelo para testar.') }); paintServers(); return; }
  status.set(id, { ok: true, text: '…', short: t('testando…') });
  paintServers();
  try {
    if (!(await requestPermission(s))) throw new Error(t('Permissão negada pelo navegador.'));
    const r = await testServer(s, ai.keys?.[id] || '', model);
    status.set(id, { ok: true, text: `${model}: "${r.text.slice(0, 40)}"`, short: `${r.ms} ms` });
  } catch (e) {
    status.set(id, { ok: false, text: e.message, short: e.code === 'auth' ? t('chave recusada') : e.code === 'offline' ? t('sem conexão') : e.code === 'missing' ? t('modelo não existe') : e.code === 'limit' ? t('limite de uso') : t('erro') });
  }
  paintServers();
}

async function removeServer(id) {
  const ai = aiOf(D().settings);
  const s = serverById(ai, id);
  if (!confirm(t('Remover o servidor') + ` ${s.name}?` + (PROVIDERS[s.type].noKey ? '' : '\n\n' + t('A chave dele será apagada deste navegador.')))) return;
  status.delete(id);
  await commit(removeServerCfg(ai, id));
  toast('Servidor removido');
}

// ---------- Editor de servidor ----------
function editServer(id = null) {
  const ai = aiOf(D().settings);
  const old = id ? serverById(ai, id) : null;
  const type = h('select', { disabled: !!old }, ...Object.entries(PROVIDERS).map(([k, p]) => new Option(p.name, k)));
  type.value = old?.type || 'gemini';
  const name = h('input', { type: 'text', class: 'txt', maxlength: 60, value: old?.name || '' });
  const base = h('input', { type: 'url', class: 'txt wide', value: old?.base || '' });
  const key = h('input', { type: 'password', class: 'txt wide', autocomplete: 'off', placeholder: t('Cole sua chave aqui'), value: (old && ai.keys?.[old.id]) || '' });
  const show = h('button', { type: 'button', class: 'btn', title: t('Mostrar/ocultar') }, '👁');
  show.onclick = () => { key.type = key.type === 'password' ? 'text' : 'password'; };
  const keyLink = h('a', { target: '_blank', rel: 'noopener' }, t('Obter uma chave →'));
  const note = h('small', { class: 'muted' });
  const filter = h('input', { type: 'search', class: 'txt', placeholder: t('Filtrar modelos') });
  const manual = h('input', { type: 'text', class: 'txt', placeholder: t('Outro modelo (nome exato)') });
  const list = h('div', { class: 'ai-mlist' });
  const msg = h('p', { class: 'msg', role: 'status' });
  /** id do modelo → { on, vision, embed, manual } */
  const rows = new Map((old?.models || []).map((m) => [m.id, { on: true, caps: { ...m.caps }, manual: m.manual }]));

  const keyRow = h('label', {}, h('span', {}, t('Chave de API'), ' ', keyLink), h('span', { class: 'keybox' }, key, show));
  const baseRow = h('label', {}, t('Endereço da API'), base, h('small', { class: 'muted' }, t('Ex.: http://localhost:11434/v1 · na rede de casa: http://192.168.0.10:11434/v1 (no outro computador, rode o Ollama com OLLAMA_HOST=0.0.0.0 e OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*")')));
  const paintType = () => {
    const p = PROVIDERS[type.value];
    note.textContent = t(p.note || '');
    keyRow.hidden = !!p.noKey;
    keyLink.href = p.keyUrl || '#';
    keyLink.hidden = !p.keyUrl;
    baseRow.hidden = !p.editableBase;
    if (!old) { base.value = p.base; name.placeholder = SHORT[type.value]; }
    paintList();
  };
  const paintList = () => {
    const q = filter.value.trim().toLowerCase();
    const ids = [...rows.keys()].filter((m) => !q || m.toLowerCase().includes(q)).slice(0, 300);
    list.replaceChildren(...(ids.length ? ids.map((m) => {
      const r = rows.get(m);
      const g = guessCaps(type.value, m);
      const vis = r.caps?.vision ?? g.vision;
      const emb = r.caps?.embed ?? g.embed;
      const box = (checked, title, label, k) => h('label', { class: 'ai-cap', title: t(title) }, h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => { r.caps = { ...r.caps, [k]: e.target.checked }; r.manual = true; } }), label);
      return h('div', { class: 'ai-mrow' },
        h('label', { class: 'ai-mon' }, h('input', { type: 'checkbox', checked: r.on, onchange: (e) => { r.on = e.target.checked; } }), h('span', {}, m)),
        box(vis, 'Lê imagens', '👁', 'vision'),
        box(emb, 'Gera embeddings (busca por significado)', '🔎', 'embed'));
    }) : [h('small', { class: 'muted' }, t('Clique em "Carregar modelos" ou escreva o nome de um modelo.'))]));
  };
  const draft = () => {
    const p = PROVIDERS[type.value];
    const sid = old?.id || newServerId(ai, type.value);
    return {
      id: sid,
      type: type.value,
      name: name.value.trim() || SHORT[type.value],
      base: p.editableBase ? base.value.trim() : p.base,
      on: old?.on !== false,
      models: [...rows].filter(([, r]) => r.on).map(([m, r]) => ({ id: m, caps: r.manual ? r.caps : { vision: r.caps?.vision ?? null, embed: r.caps?.embed ?? null }, manual: !!r.manual })),
      embedModel: old?.embedModel || '',
      visionModel: old?.visionModel || '',
    };
  };
  const say = (txt, cls = '') => { msg.className = 'msg ' + cls; msg.textContent = t(txt); };
  const load = async () => {
    const s = draft();
    if (!s.base) return say('Informe o endereço da API.', 'err');
    say('Carregando modelos…');
    try {
      if (!(await requestPermission(s))) return say('Permissão negada pelo navegador.', 'err');
      const found = await listServerModels(s, key.value.trim());
      for (const m of found) {
        const r = rows.get(m.id);
        if (r) { if (!r.manual && m.caps) r.caps = { ...m.caps }; } else rows.set(m.id, { on: false, caps: m.caps ? { ...m.caps } : {}, manual: false });
      }
      paintList();
      say(`${found.length} ${t('modelos. Marque os que você quer usar.')}`, 'ok');
    } catch (e) {
      say('✕ ' + e.message, 'err');
    }
  };
  const addManual = () => {
    const m = manual.value.trim();
    if (!m) return;
    rows.set(m, { ...(rows.get(m) || { caps: {} }), on: true });
    manual.value = '';
    paintList();
  };
  manual.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } });
  filter.addEventListener('input', paintList);
  type.addEventListener('change', () => { rows.clear(); paintType(); });

  const dlg = h('dialog', { class: 'dlg ai-dlg' }, h('form', { method: 'dialog' },
    h('h2', {}, old ? t('Editar servidor') : t('Adicionar servidor')),
    h('label', {}, t('Tipo'), type, note),
    h('label', {}, t('Nome'), name),
    baseRow,
    keyRow,
    h('h3', {}, t('Modelos')),
    h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'btn', onclick: load }, t('Carregar modelos')), filter),
    list,
    h('div', { class: 'toolbar' }, manual, h('button', { type: 'button', class: 'btn', onclick: addManual }, t('Adicionar'))),
    h('small', { class: 'muted' }, t('👁 lê imagens · 🔎 gera embeddings (busca por significado). Quando o servidor informa, já vem marcado; corrija se precisar.')),
    msg,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', value: 'cancel', formnovalidate: true }, t('Cancelar')),
      h('button', { class: 'btn primary', value: 'ok' }, t('Salvar')))));
  dlg.querySelector('form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    const s = draft();
    if (!s.base) return say('Informe o endereço da API.', 'err');
    if (!PROVIDERS[s.type].noKey && !key.value.trim()) return say('Cole a chave de API.', 'err');
    // pedido de acesso direto no clique, sem await antes (Firefox)
    requestPermission(s).then(async (ok) => {
      if (!ok) return say('Permissão negada pelo navegador.', 'err');
      const a = aiOf(D().settings);
      const i = a.servers.findIndex((x) => x.id === s.id);
      if (i < 0) a.servers.push(s); else a.servers[i] = s;
      if (!PROVIDERS[s.type].noKey) a.keys[s.id] = key.value.trim();
      if (!a.primary.server || !serverById(a, a.primary.server)) a.primary = { server: s.id, model: (s.models.some((m) => m.id === PROVIDERS[s.type].defaultModel) && PROVIDERS[s.type].defaultModel) || s.models.find((m) => modelCaps(s, m.id).text !== false)?.id || PROVIDERS[s.type].defaultModel };
      dlg.close('ok');
      dlg.remove();
      await commit(a);
      toast(old ? 'Servidor salvo' : 'Servidor adicionado');
      test(s.id);
    }, (err) => say(err.message, 'err'));
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  paintType();
  dlg.showModal();
}

// ---------- Modelo por tarefa ----------
function taskOptions(task) {
  const ai = aiOf(D().settings);
  const def = TASKS[task];
  const opts = modelOptions(D().settings, task);
  // Embeddings e imagens: o modelo padrão de cada servidor também entra (nomic-embed-text, "modelo com visão" do Ollama…)
  for (const s of ai.servers) {
    if (!s.on) continue;
    if (def.needs === 'embed') {
      const m = defaultModelFor(s, 'embed');
      const r = m && check(ai, { server: s.id, model: m, source: 'task' }, def);
      if (r?.pick && !opts.some((o) => o.server === s.id && o.model === m)) opts.push({ server: s.id, model: m, label: pickLabel(r.pick), where: r.pick.where });
    }
    if (def.needs === 'vision' && s.type === 'ollama') {
      const r = check(ai, { server: s.id, model: '', source: 'task' }, def);
      if (r?.pick) opts.unshift({ server: s.id, model: '', label: `${s.name} · ${t('modelo com visão (automático)')}`, where: r.pick.where });
    }
  }
  return opts;
}

function paintTasks() {
  const ai = aiOf(D().settings);
  const rows = Object.entries(TASKS).map(([id, def]) => {
    const rule = ai.tasks[id];
    const inherited = resolve({ ...ai, tasks: { ...ai.tasks, [id]: undefined } }, id).use;
    const { use, problems } = resolve(ai, id);
    const sel = h('select', { class: 'ai-pick' });
    sel.add(new Option(`${t('Igual ao Padrão')}${inherited ? ` — ${pickLabel(inherited)}` : ''}`, ''));
    const opts = taskOptions(id);
    if (rule && !opts.some((o) => o.server === rule.server && o.model === rule.model)) {
      const s = serverById(ai, rule.server);
      opts.unshift({ server: rule.server, model: rule.model, label: `${s?.name || rule.server} · ${rule.model || t('automático')}`, where: s ? whereOf(s.type, s.base) : 'cloud' });
    }
    for (const o of opts) sel.add(new Option(`${WHERE[o.where].icon} ${o.label}`, enc(o)));
    sel.value = rule ? enc(rule) : '';
    sel.addEventListener('change', async () => {
      const a = aiOf(D().settings);
      const v = dec(sel.value);
      if (v) a.tasks[id] = v; else delete a.tasks[id];
      await commit(a);
    });
    const ruleProblem = rule && problems.find((p) => p.source === 'task');
    const info = !use ? h('small', { class: 'err' }, '⚠️ ', problems[0] ? `${t(PROBLEMS[problems[0].why] || '')}` : t('Nenhum servidor configurado.'))
      : ruleProblem ? h('small', { class: 'warn' }, '⚠️ ', `${t(PROBLEMS[ruleProblem.why])} — ${t('usando')} ${pickLabel(use)}`)
      : h('small', { class: 'muted' }, WHERE[use.where].icon, ' ', use.source === 'task' ? t('próprio') : t('herdado do Padrão'), def.reserve === false ? ` · ${t('sem Reserva (os vetores de modelos diferentes não se misturam)')}` : '');
    return h('div', { class: 'ai-task' },
      h('div', {}, h('b', {}, def.icon, ' ', t(def.label)), h('small', { class: 'muted' }, t(def.where))),
      h('div', { class: 'ai-task-pick' }, sel, info));
  });
  const ext = Object.values(EXTERNAL_TASKS).map((def) => h('div', { class: 'ai-task' },
    h('div', {}, h('b', {}, def.icon, ' ', t(def.label)), h('small', { class: 'muted' }, t('Configurada à parte'))),
    h('div', { class: 'ai-task-pick' }, h('a', { class: 'btn', href: '#voz' }, t(def.where)))));
  $('#aiTasks').replaceChildren(...rows, ...ext);
}

function paintAll() {
  paintRoles();
  paintServers();
  paintTasks();
  const imgs = resolve(aiOf(D().settings), 'images').use;
  if ($('#imagesAiNote')) $('#imagesAiNote').textContent = imgs ? `${t('Agora')}: ${WHERE[imgs.where].icon} ${pickLabel(imgs)}` : t('Nenhuma IA com imagens configurada.');
}

export function setupAiCentral(a) {
  api = a;
  const role = (sel, key) => sel.addEventListener('change', async () => {
    const ai = aiOf(D().settings);
    ai[key] = dec(sel.value) || (key === 'reserve' ? null : ai.primary);
    await commit(ai);
    toast('Salvo ✓');
  });
  role($('#aiPrimary'), 'primary');
  role($('#aiReserve'), 'reserve');
  $('#aiAdd').onclick = () => editServer();
  $('#aiTasksReset').onclick = async () => {
    const ai = aiOf(D().settings);
    ai.tasks = {};
    await commit(ai);
    toast('Todas as tarefas usam o Padrão');
  };
  $('#aiExport').onclick = () => {
    const blob = new Blob([JSON.stringify(exportAi(aiOf(D().settings)), null, 2)], { type: 'application/json' });
    const link = h('a', { href: URL.createObjectURL(blob), download: 'neurotab-ia.json' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  };
  $('#aiImport').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const ai = importAi(aiOf(D().settings), JSON.parse(await f.text()), D().settings.media);
      await commit(ai);
      const missing = ai.servers.filter((s) => !PROVIDERS[s.type].noKey && !ai.keys[s.id]).map((s) => s.name);
      toast(missing.length ? `${t('Configuração importada. Falta a chave de:')} ${missing.join(', ')}` : t('Configuração importada'));
    } catch (err) {
      toast(err.message);
    }
  });
  paintAll();
}

export const repaintAi = () => api && paintAll();
export { EMBED_DEFAULTS };
