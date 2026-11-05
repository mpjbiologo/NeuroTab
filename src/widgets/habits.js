// Widget: hábitos — água, leitura, exercício… com metas diárias e sequência.
import { h } from '../lib/ui.js';
import { uid } from '../lib/store.js';

const KEY = 'nt_habits';
const DEFAULT = { habits: [
  { id: 'agua', name: 'Água', icon: '💧', target: 8 },
  { id: 'leitura', name: 'Leitura', icon: '📖', target: 1 },
  { id: 'exercicio', name: 'Exercício', icon: '🏃', target: 1 },
], log: {} };
const ICONS = ['💧', '📖', '🏃', '🧘', '💊', '🥗', '😴', '🚭', '✍️', '🎸', '🧠', '🦷', '☀️', '📵'];

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default {
  id: 'habits',
  title: 'Hábitos',
  icon: '✅',
  description: 'Acompanhe hábitos diários (água, leitura, exercício…) com metas e sequência de dias.',
  defaultW: 4,
  mount(el, ctx) {
    let st = DEFAULT;
    let editing = false;
    const body = h('div');
    const edit = h('button', { title: 'Editar hábitos', onclick: () => { editing = !editing; edit.classList.toggle('sel', editing); render(); } }, '✎');
    ctx.actions.append(edit);
    el.append(body);

    const save = () => chrome.storage.local.set({ [KEY]: st });
    const count = (id, day = dayKey()) => st.log[day]?.[id] || 0;
    const bump = async (hb, d) => {
      const k = dayKey();
      st.log[k] = st.log[k] || {};
      st.log[k][hb.id] = Math.max(0, count(hb.id) + d);
      if (d > 0 && st.log[k][hb.id] === hb.target) ctx.toast(`${hb.icon} Meta de ${hb.name.toLowerCase()} cumprida! 🎉`);
      await save();
    };
    const streak = (hb) => {
      let n = 0;
      const d = new Date();
      if (count(hb.id) < hb.target) d.setDate(d.getDate() - 1); // hoje ainda pode completar
      while (count(hb.id, dayKey(d)) >= hb.target) { n++; d.setDate(d.getDate() - 1); }
      return n;
    };

    function row(hb) {
      const c = count(hb.id);
      const done = c >= hb.target;
      const week = [];
      for (let k = 6; k >= 0; k--) {
        const d = new Date(); d.setDate(d.getDate() - k);
        const v = count(hb.id, dayKey(d));
        week.push(h('i', { class: 'hb-day' + (v >= hb.target ? ' full' : v ? ' part' : ''), title: `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' })}: ${v}/${hb.target}` }));
      }
      const s = streak(hb);
      return h('div', { class: 'hb-row' + (done ? ' done' : '') },
        h('button', { class: 'hb-ic', title: 'Marcar +1', onclick: () => bump(hb, 1), oncontextmenu: (e) => { e.preventDefault(); bump(hb, -1); } }, hb.icon),
        h('div', { class: 'body' },
          h('div', { class: 'tt' }, hb.name, s > 1 ? h('span', { class: 'hb-streak', title: 'Dias seguidos' }, ` 🔥${s}`) : null),
          h('div', { class: 'hb-week' }, ...week)),
        h('div', { class: 'hb-count' },
          h('button', { class: 'hb-btn', onclick: () => bump(hb, -1), title: 'Desfazer' }, '−'),
          h('b', {}, `${c}/${hb.target}`),
          h('button', { class: 'hb-btn', onclick: () => bump(hb, 1), title: 'Marcar +1' }, '+')),
        editing ? h('button', { class: 'chip danger', onclick: async () => { st.habits = st.habits.filter((x) => x.id !== hb.id); await save(); } }, '✕') : null);
    }

    function addForm() {
      let icon = '🧘';
      const name = h('input', { type: 'text', placeholder: 'Novo hábito (ex.: Meditar)' });
      const target = h('input', { type: 'number', min: 1, max: 50, value: 1, style: { width: '70px' }, title: 'Meta por dia' });
      const icons = h('div', { class: 'toolbar' }, ...ICONS.map((ic) => h('button', { class: 'chip' + (ic === icon ? ' sel' : ''), onclick: (e) => { icon = ic; [...icons.children].forEach((b) => b.classList.toggle('sel', b === e.target)); } }, ic)));
      return h('div', { class: 'al-form' }, icons,
        h('div', { class: 'row-input' }, name, target, h('button', { class: 'btn primary', onclick: async () => {
          if (!name.value.trim()) return name.focus();
          st.habits.push({ id: uid(), name: name.value.trim(), icon, target: Math.max(1, +target.value || 1) });
          await save();
        } }, 'Adicionar')),
        h('p', { class: 'muted small' }, 'Dica: clique no ícone para marcar; botão direito desfaz.'));
    }

    function render() {
      body.replaceChildren(...st.habits.map(row), ...(editing || !st.habits.length ? [addForm()] : []));
      const total = st.habits.length;
      const full = st.habits.filter((x) => count(x.id) >= x.target).length;
      if (total && !editing) body.append(h('p', { class: 'muted small center' }, full === total ? '🏆 Todos os hábitos de hoje cumpridos!' : `${full} de ${total} hábitos cumpridos hoje`));
    }

    async function load() {
      st = (await chrome.storage.local.get(KEY))[KEY] || structuredClone(DEFAULT);
      render();
    }
    const onChange = (c, area) => { if (area === 'local' && c[KEY]) load(); };
    chrome.storage.onChanged.addListener(onChange);
    load();
    const t = setInterval(() => { if (render.day !== dayKey()) { render.day = dayKey(); render(); } }, 60_000);
    return { destroy: () => { chrome.storage.onChanged.removeListener(onChange); clearInterval(t); } };
  },
};
