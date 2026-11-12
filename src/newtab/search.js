// NeuroTab — Busca universal (Ctrl+K): atalhos, notas, web, calculadora e perguntas ao cérebro.
import { SEARCH_ENGINES, saveData, hostOf, normalizeUrl } from '../lib/store.js';
import * as Brain from '../lib/brain.js';
import { $, $$, h, toast, micButton } from '../lib/ui.js';
import { looksLikeMath, smartCalc } from '../lib/calc.js';
import { S, listeners } from './state.js';
import { ctx } from './context.js';
import { openItemDialog } from './editor.js';
import { renderWidgets } from './widgets.js';

// =====================================================================
// BUSCA UNIVERSAL (Ctrl+K)
// =====================================================================
export function setupOmni() {
  const input = $('#omni');
  const box = $('#omniResults');
  $('#omniMicSlot').append(micButton(input, { lang: S.data.settings.voiceLang, title: 'Falar' }));
  let results = [];
  let sel = 0;

  const run = (r) => {
    box.hidden = true;
    input.blur();
    r.action();
  };

  const render = () => {
    const q = input.value.trim();
    if (!q) { box.hidden = true; return; }
    const fq = Brain.fold(q);
    const links = S.data.links.filter((l) => Brain.fold(l.title + ' ' + l.url).includes(fq)).slice(0, 6);
    const notes = omniSem?.q === q ? omniSem.list : Brain.searchItems(S.items, q, 5);
    const eng = SEARCH_ENGINES[S.data.settings.searchEngine] || SEARCH_ENGINES.google;
    results = [];
    const sections = [];
    if (links.length) sections.push(['Atalhos', links.map((l) => ({ icon: h('img', { src: ctx.faviconFor(l), alt: '' }), label: l.title, sub: hostOf(l.url), action: () => { location.href = l.url; } }))]);
    if (notes.length) sections.push(['Cérebro', notes.map((it) => ({ icon: Brain.TYPES[it.type]?.icon, label: Brain.displayTitle(it), sub: Brain.relTime(it.createdAt), action: () => openItemDialog(it) }))]);
    const acts = [];
    if (looksLikeMath(q) || /^-?[\d.,]+\s*\S+(\s\S+)?\s+(em|para)\s+\S+$/i.test(q) || /^dias?\s(ate|até|desde)\s/i.test(q)) {
      const calcItem = { icon: '🧮', label: `${q} = …`, sub: 'Enter copia', action: async () => { if (calcItem.value != null) { await navigator.clipboard.writeText(String(calcItem.value)); toast('Resultado copiado'); } } };
      acts.push(calcItem);
      smartCalc(q).then((r) => {
        calcItem.value = Number.isFinite(r.value) ? String(r.value).replace('.', ',') : r.text;
        calcItem.label = r.text.includes('=') || /faltam|dias/i.test(r.text) ? r.text : `${q} = ${r.text}`;
        const el = box.querySelector(`[data-i="${results.indexOf(calcItem)}"] span:nth-child(2)`);
        if (el && input.value.trim() === q) el.textContent = calcItem.label;
      }).catch(() => { calcItem.label = `${q} = ?`; });
    }
    if (/^(https?:\/\/|www\.)|^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(q) && !/\s/.test(q)) acts.push({ icon: '↗', label: `Abrir ${q}`, action: () => { location.href = normalizeUrl(q); } });
    acts.push({ icon: '🔎', label: `Pesquisar "${q}" no ${eng.name}`, action: () => { location.href = eng.url + encodeURIComponent(q); } });
    acts.push({ icon: '🤖', label: `Perguntar ao cérebro: "${q}"`, action: () => askBrain(q) });
    acts.push({ icon: '📝', label: `Salvar como nota`, sub: 'Shift+Enter', action: async () => { await ctx.capture({ text: q, source: 'manual' }); input.value = ''; toast('Salvo no cérebro 🧠'); } });
    sections.push(['Ações', acts]);
    box.replaceChildren();
    for (const [title, list] of sections) {
      box.append(h('div', { class: 'sec' }, title));
      for (const r of list) {
        const i = results.length;
        results.push(r);
        box.append(h('div', { class: 'omni-item', 'data-i': i, onmousedown: (e) => { e.preventDefault(); run(r); } },
          typeof r.icon === 'string' ? h('span', {}, r.icon) : r.icon,
          h('span', {}, r.label),
          r.sub && h('span', { class: 'sub' }, r.sub)));
      }
    }
    // Sem atalhos/notas, a ação padrão é pesquisar na web.
    sel = links.length || notes.length ? 0 : results.findIndex((r) => ['🧮', '↗', '🔎'].includes(r.icon));
    if (results.some((r) => r.icon === '🧮') && !links.length) sel = results.findIndex((r) => r.icon === '🧮');
    highlight();
    box.hidden = false;
  };
  const highlight = () => $$('.omni-item', box).forEach((el, i) => el.classList.toggle('sel', i === sel));

  let omniSem = null;
  let omniTimer;
  const askSemantic = () => {
    clearTimeout(omniTimer);
    const q = input.value.trim();
    if (q.length < 3 || !ctx.semanticOn() || omniSem?.q === q) return;
    omniTimer = setTimeout(async () => {
      try {
        const res = await ctx.smartSearch(q, 5);
        if (input.value.trim() !== q) return;
        omniSem = { q, list: res.map((x) => x.it) };
        if (!box.hidden) render();
      } catch (e) { console.warn(e); }
    }, 450);
  };
  input.addEventListener('input', () => { render(); askSemantic(); });
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, results.length - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const q = input.value.trim();
      if (q) { await ctx.capture({ text: q }); input.value = ''; box.hidden = true; toast('Salvo no cérebro 🧠'); }
    } else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); run(results[sel]); }
    else if (e.key === 'Escape') { input.value = ''; box.hidden = true; input.blur(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
    else if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) { e.preventDefault(); input.focus(); }
  });
}

function askBrain(q) {
  if (!S.data.settings.widgets.some((w) => w.id === 'ask')) {
    S.data.settings.widgets.unshift({ id: 'ask', size: 'l' });
    saveData(S.data).then(() => { renderWidgets(); setTimeout(() => listeners.ask.forEach((fn) => fn(q)), 50); });
    return;
  }
  listeners.ask.forEach((fn) => fn(q));
}
