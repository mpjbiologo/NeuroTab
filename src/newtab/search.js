// NeuroTab — Busca universal (Ctrl+K): atalhos, notas, web, calculadora e perguntas ao cérebro.
import { openUrl } from './open.js';
import { SEARCH_ENGINES, saveData, hostOf, normalizeUrl } from '../lib/store.js';
import * as Brain from '../lib/brain.js';
import { parseReminder, fmtDateTime } from '../lib/brain.js';
import { $, $$, h, toast, micButton } from '../lib/ui.js';
import { looksLikeMath, smartCalc } from '../lib/calc.js';
import { S, bus } from './state.js';
import { ctx } from './context.js';
import { openItemDialog } from './editor.js';
import { renderWidgets } from './widgets.js';
import { loadClips, searchClips, KINDS as CLIP_KINDS, CLIP_KEY, hostOf as clipHost } from '../lib/clipboard.js';

// =====================================================================
// BUSCA UNIVERSAL (Ctrl+K)
// =====================================================================
export function setupOmni() {
  const input = $('#omni');
  const box = $('#omniResults');
  $('#omniMicSlot').append(micButton(input, { lang: S.data.settings.voiceLang, title: 'Falar' }));
  let results = [];
  let sel = 0;
  // itens da área de transferência (só deste computador) também aparecem na busca
  let clips = [];
  const loadClipCache = () => loadClips().then((x) => { clips = x; }).catch(() => {});
  loadClipCache();
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[CLIP_KEY]) loadClipCache(); });
  let moved = false; // a pessoa escolheu um item com as setas: o Enter abre esse item

  const saveAs = async (type, q) => {
    const remindAt = type === 'task' ? parseReminder(q) : null;
    await ctx.capture({ type, text: q, remindAt, source: 'manual' });
    input.value = '';
    box.hidden = true;
    toast(type === 'task' ? (remindAt ? `Tarefa salva · ⏰ ${fmtDateTime(remindAt)}` : 'Tarefa salva ☑️') : 'Salvo no cérebro 🧠');
  };

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
    if (links.length) sections.push(['Atalhos', links.map((l) => ({ icon: h('img', { src: ctx.faviconFor(l), alt: '' }), label: l.title, sub: hostOf(l.url), action: () => openUrl(l.url) }))]);
    const copied = q.length >= 2 ? searchClips(clips.filter((c) => c.kind !== 'image'), q).slice(0, 4) : [];
    if (copied.length) sections.push(['Área de transferência', copied.map((c) => ({
      icon: CLIP_KINDS[c.kind]?.icon || '📋', label: c.text.replace(/\s+/g, ' ').slice(0, 90), sub: [c.source?.url ? clipHost(c.source.url) : '', Brain.relTime(c.updatedAt)].filter(Boolean).join(' · '),
      action: async () => { await navigator.clipboard.writeText(c.text); toast('Copiado ✓'); },
    }))]);
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
    const web = { kind: 'web', icon: '🔎', label: `Pesquisar "${q}" no ${eng.name}`, action: () => openUrl(eng.url + encodeURIComponent(q), { search: true }) };
    const ask = { kind: 'ask', icon: '🤖', label: `Perguntar ao cérebro: "${q}"`, action: () => askBrain(q) };
    const note = { kind: 'note', icon: '📝', label: 'Salvar como nota', sub: 'Shift+Enter', action: () => saveAs('note', q) };
    const task = { kind: 'task', icon: '☑️', label: 'Salvar como tarefa', action: () => saveAs('task', q) };
    acts.push(web, ask, note, task);
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
    // O Enter faz o que a pessoa escolheu nas configurações (padrão: pesquisar na internet).
    // Um endereço digitado abre direto; uma conta mostra o resultado e o Enter copia.
    const mode = ENTER_MODES.includes(S.data.settings.searchEnter) ? S.data.settings.searchEnter : 'web';
    const special = results.findIndex((r) => r.icon === '↗' || r.icon === '🧮');
    const first = links.length || notes.length ? 0 : -1;
    const target = mode === 'web' ? (special >= 0 ? special : results.indexOf(web))
      : mode === 'first' ? (first >= 0 ? first : special >= 0 ? special : results.indexOf(web))
      : results.findIndex((r) => r.kind === mode);
    if (!moved || sel >= results.length) { sel = Math.max(0, target); moved = false; }
    const def = results[Math.max(0, target)];
    for (const [i, r] of results.entries()) {
      const el = box.querySelector(`[data-i="${i}"]`);
      if (!el) continue;
      if (r !== def || r.sub?.startsWith('Enter')) continue;
      const sub = el.querySelector('.sub');
      if (sub) sub.textContent = r.sub === 'Shift+Enter' ? 'Enter' : `${r.sub} · Enter`;
      else el.append(h('span', { class: 'sub' }, 'Enter'));
    }
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
  input.addEventListener('input', () => { moved = false; render(); askSemantic(); });
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, results.length - 1); moved = true; highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); moved = true; highlight(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const q = input.value.trim();
      if (q) { box.hidden = true; await saveAs('note', q); }
    } else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); run(results[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); input.value = ''; box.hidden = true; input.blur(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
    else if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) { e.preventDefault(); input.focus(); }
  });
}

/** O que o Enter faz na barra de pesquisa (configuração searchEnter). */
export const ENTER_MODES = ['web', 'first', 'ask', 'note', 'task'];

function askBrain(q) {
  if (!S.data.settings.widgets.some((w) => w.id === 'ask')) {
    S.data.settings.widgets.unshift({ id: 'ask', size: 'l' });
    saveData(S.data).then(() => { renderWidgets(); setTimeout(() => bus.emit('ask.requested', q), 50); });
    return;
  }
  bus.emit('ask.requested', q);
}
