// NeuroTab — Configurações → Nova aba → Fontes de dados (0.9.2, #71).
// Uma fonte por cartão: ligar, chave (com "Testar" e o passo a passo para conseguir), consumo e o que o grátis cobre.
// Também: ordem das fontes por dado, clima pela HG Brasil e alertas.
import { h } from './lib/ui.js';
import { LOCALE } from './lib/i18n.js';
import { saveData } from './lib/store.js';
import { SOURCES } from './lib/datahub/sources.js';
import { KINDS, KIND_LABEL, sanitizeDatahub, itemKey } from './lib/datahub/prefs.js';
import { getKeys, setKey, migrateBrapiToken } from './lib/datahub/keys.js';
import { loadUsage, usageOf, limitsFor, bucketOf } from './lib/datahub/quota.js';
import { testKey } from './lib/datahub/hub.js';
import { ALERT_LABEL, isWeatherAlert } from './lib/datahub/alerts.js';
import { itemTitle } from './lib/datahub/format.js';
import { hasFeature, requestAccess, FEATURES } from './lib/permissions.js';

const $ = (s) => document.querySelector(s);
let api;
const lastMsg = {}; // fonte → última mensagem (continua visível depois de redesenhar)
const clean = new WeakSet();
// Sempre o MESMO objeto (as telas guardam referência); confere só uma vez.
const dh = () => {
  const s = api.data().settings;
  if (!clean.has(s.datahub || {})) { s.datahub = sanitizeDatahub(s.datahub); clean.add(s.datahub); }
  return s.datahub;
};
async function save(msg = 'Salvo ✓') { await saveData(api.data()); api.toast(msg); }

const fmt = (n) => Number(n || 0).toLocaleString(LOCALE);

function usageLine(usage, src, keys) {
  const buckets = src === 'hg' ? [['hg', 'Finance'], ['hgWeather', 'Clima'], ['hgGeo', 'Cidade pelo IP']] : [[bucketOf(src, '', !!keys[src] || src !== 'brapi'), '']];
  return buckets.map(([b, label]) => {
    const lim = limitsFor(b, dh().limits);
    const u = usageOf(usage, b);
    const which = lim.month ? 'month' : lim.day ? 'day' : lim.minute ? 'minute' : '';
    if (!which || which === 'minute') return h('div', { class: 'dh-use' }, label ? label + ': ' : '', `${fmt(u.day)} consulta(s) hoje`);
    const used = u[which], max = lim[which];
    const pct = Math.min(100, Math.round((used / max) * 100));
    return h('div', { class: 'dh-use' },
      h('span', {}, label ? label + ': ' : '', `${fmt(used)} de ${fmt(max)} ${which === 'month' ? 'no mês' : 'hoje'}`),
      h('div', { class: 'dh-bar ' + (pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '') }, h('i', { style: { width: pct + '%' } })));
  });
}

async function paint() {
  const box = $('#dhSources');
  if (!box) return;
  const keys = await getKeys();
  const usage = await loadUsage();
  const cards = [];
  for (const s of Object.values(SOURCES)) {
    const granted = await hasFeature(s.feature).catch(() => false);
    const on = h('input', { type: 'checkbox', checked: dh().enabled[s.id], 'data-src': s.id });
    on.addEventListener('change', async () => {
      if (on.checked && !granted) {
        const f = FEATURES[s.feature];
        if (!(await requestAccess({ origins: f.origins, data: f.data || [] }))) { on.checked = false; api.toast('Sem permissão para acessar ' + s.name + '.'); return; }
      }
      dh().enabled[s.id] = on.checked;
      await save(on.checked ? `${s.name} ligada.` : `${s.name} desligada.`);
      paint();
    });
    const keyBox = [];
    if (s.keyUrl) {
      const inp = h('input', { type: 'password', class: 'txt dh-key', 'data-key': s.id, value: keys[s.id] || '', placeholder: s.needsKey ? 'Cole a sua chave' : 'Cole o seu token (opcional)', autocomplete: 'off', spellcheck: 'false' });
      const msg = h('span', { class: 'small', role: 'status' }, lastMsg[s.id] || '');
      const show = h('button', { class: 'btn sm', type: 'button', title: 'Mostrar', onclick: () => { inp.type = inp.type === 'password' ? 'text' : 'password'; } }, '👁');
      const saveK = async () => { await setKey(s.id, inp.value); msg.textContent = inp.value.trim() ? 'Chave guardada neste computador.' : 'Chave removida.'; };
      inp.addEventListener('change', saveK);
      const test = h('button', { class: 'btn sm', type: 'button', 'data-test': s.id, onclick: async () => {
        if (!inp.value.trim()) { msg.textContent = 'Cole a chave primeiro.'; return; }
        if (!(await hasFeature(s.feature))) {
          const f = FEATURES[s.feature];
          if (!(await requestAccess({ origins: f.origins, data: f.data || [] }))) { msg.textContent = 'Sem permissão para acessar o site da fonte.'; return; }
        }
        await saveK();
        msg.textContent = 'Testando…';
        const r = await testKey(s.id, inp.value.trim());
        msg.textContent = lastMsg[s.id] = (r.ok ? '✅ ' : '❌ ') + r.message;
        if (r.ok && !dh().enabled[s.id]) { dh().enabled[s.id] = true; await save(`${s.name} ligada.`); paint(); }
      } }, 'Testar');
      keyBox.push(h('div', { class: 'row dh-keyrow' }, inp, show, test), msg,
        h('details', { class: 'small dh-how' }, h('summary', {}, s.needsKey ? 'Como conseguir a chave grátis' : 'Como conseguir o token grátis'),
          h('ol', {}, ...(s.how || []).map((x) => h('li', {}, x))),
          h('p', {}, h('a', { href: s.keyUrl, target: '_blank', rel: 'noopener' }, `Abrir ${s.keyUrl.replace('https://', '')} ↗`))));
    }
    const lim = s.id === 'brapi' || s.id === 'hg' ? limitsBox(s.id) : null;
    cards.push(h('div', { class: 'dh-card', 'data-source': s.id },
      h('div', { class: 'opt' }, h('div', {}, h('b', {}, s.name), h('small', {}, s.free)), h('label', { class: 'sw' }, on, h('span'))),
      ...keyBox,
      dh().enabled[s.id] && granted ? h('div', { class: 'dh-uses' }, ...usageLine(usage, s.id, keys)) : null,
      dh().enabled[s.id] && !granted ? h('p', { class: 'small warn' }, 'Falta a permissão do site: desligue e ligue de novo para pedir.') : null,
      s.needsKey && dh().enabled[s.id] && !keys[s.id] ? h('p', { class: 'small warn' }, 'Ligada, mas sem chave: cole a sua acima.') : null,
      lim));
  }
  box.replaceChildren(...cards);
  paintOrder();
  paintAlerts();
}

function limitsBox(src) {
  const cur = dh().limits[src] || {};
  const field = src === 'brapi' ? 'month' : 'day';
  const def = limitsFor(src === 'brapi' ? 'brapi' : 'hg', {})[field];
  const inp = h('input', { type: 'number', class: 'txt', min: 1, placeholder: String(def), value: cur[field] || '', style: { minWidth: '0', width: '110px' }, 'data-limit': src });
  const batch = src === 'brapi' ? h('input', { type: 'number', class: 'txt', min: 1, max: 20, placeholder: '1', value: cur.batch || '', style: { minWidth: '0', width: '70px' } }) : null;
  const apply = async () => {
    const o = {};
    if (+inp.value > 0) o[field] = Math.round(+inp.value);
    if (batch && +batch.value > 0) o.batch = Math.round(+batch.value);
    if (Object.keys(o).length) dh().limits[src] = o; else delete dh().limits[src];
    await save();
  };
  inp.addEventListener('change', apply);
  batch?.addEventListener('change', apply);
  return h('details', { class: 'small dh-how' }, h('summary', {}, 'Tenho um plano pago (ajustar limites)'),
    h('p', { class: 'row' }, `Consultas por ${field === 'month' ? 'mês' : 'dia'}: `, inp, batch ? [' · ativos por consulta: ', batch] : null),
    h('p', { class: 'muted' }, 'Deixe vazio para usar o limite do plano grátis.'));
}

function paintOrder() {
  const box = $('#dhOrder');
  box.replaceChildren(...KINDS.map((k) => {
    const list = dh().order[k];
    return h('div', { class: 'opt' }, h('div', {}, h('b', {}, KIND_LABEL[k]), h('small', {}, list.length > 1 ? 'A primeira que responder vale; as outras são reserva.' : 'Só esta fonte oferece este dado no plano grátis.')),
      h('div', { class: 'row' }, ...list.map((src, i) => h('span', { class: 'dh-chip', 'data-order': `${k}:${src}` }, `${i + 1}. ${SOURCES[src].name}`,
        i > 0 ? h('button', { class: 'dh-up', title: 'Usar primeiro', 'aria-label': 'Usar primeiro', onclick: async () => { const l = dh().order[k]; l.splice(l.indexOf(src), 1); l.unshift(src); await save(); paintOrder(); } }, '↑') : null))));
  }));
  const wx = $('#dhWeather');
  wx.value = dh().weather;
  wx.onchange = async () => {
    if (wx.value === 'hg' && !(await getKeys()).hg) { api.toast('Cadastre a chave da HG Brasil primeiro.'); wx.value = 'openmeteo'; return; }
    dh().weather = wx.value; await save();
  };
}

function paintAlerts() {
  const on = $('#dhAlertsOn');
  on.checked = dh().alertsOn;
  on.onchange = async () => { dh().alertsOn = on.checked; await save(on.checked ? 'Alertas ligados.' : 'Alertas desligados.'); };
  const items = api.data().settings.watch?.items || [];
  const list = $('#dhAlerts');
  list.replaceChildren(...dh().alerts.map((a, i) => h('div', { class: 'row dh-alert', 'data-alert': a.id },
    h('span', {}, isWeatherAlert(a) ? '🌦️' : '📈', ' ', isWeatherAlert(a) ? '' : itemTitle({ kind: a.item.split(':')[0], sym: a.item.split(':')[1] }) + ' · ', ALERT_LABEL[a.type], ' ', h('b', {}, String(a.value))),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn sm', title: 'Remover', 'aria-label': 'Remover', onclick: async () => { dh().alerts.splice(i, 1); await save(); paintAlerts(); } }, '✕'))));
  const type = h('select', { id: 'dhAlType' }, ...Object.entries(ALERT_LABEL).map(([k, v]) => h('option', { value: k }, v)));
  const item = h('select', { id: 'dhAlItem' }, ...items.map((it) => h('option', { value: itemKey(it) }, itemTitle(it))));
  const value = h('input', { type: 'text', class: 'txt', inputmode: 'decimal', id: 'dhAlValue', placeholder: 'valor', style: { minWidth: '0', width: '100px' } });
  const sync = () => { item.hidden = isWeatherAlert({ type: type.value }); };
  type.addEventListener('change', sync);
  sync();
  $('#dhAlertAdd').replaceChildren(type, item, value, h('button', { class: 'btn', id: 'dhAlGo', onclick: async () => {
    const v = Number(String(value.value).replace(',', '.'));
    if (!Number.isFinite(v)) { api.toast('Informe um número.'); return; }
    const w = isWeatherAlert({ type: type.value });
    if (!w && !item.value) { api.toast('Adicione ativos ao widget Cotações primeiro.'); return; }
    dh().alerts.push({ id: Math.random().toString(36).slice(2, 9), type: type.value, item: w ? '' : item.value, value: v, armed: true });
    value.value = '';
    await save('Alerta criado.');
    paintAlerts();
  } }, 'Adicionar'));
}

export function setupDatahub(a) {
  api = a;
  migrateBrapiToken(api.data()).then((changed) => changed && saveData(api.data())).catch(() => {});
  if (location.hash === '#fontes-dados') paint();
  addEventListener('nt-page', (e) => { if (e.detail === 'fontes-dados') paint(); });
}

