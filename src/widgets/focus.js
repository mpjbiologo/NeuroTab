// Widget: foco do dia — uma prioridade principal por dia.
import { h } from '../lib/ui.js';

const KEY = 'nt_focus';
const today = () => new Date().toDateString();

export default {
  id: 'focus',
  title: 'Foco do dia',
  icon: '🎯',
  description: 'Escolha a principal coisa a fazer hoje e marque quando concluir.',
  defaultW: 4,
  mount(el, ctx) {
    const body = h('div', { class: 'focus' });
    el.append(body);
    let st = {};

    const save = (patch) => chrome.storage.local.set({ [KEY]: { ...st, ...patch } });

    function render() {
      const fresh = st.date === today() && st.text;
      if (!fresh) {
        const input = h('input', { type: 'text', class: 'focus-input', placeholder: 'Qual é o seu foco principal hoje?' });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) save({ date: today(), text: input.value.trim(), done: false, history: [...(st.history || []), ...(st.text && st.date !== today() ? [{ date: st.date, text: st.text, done: st.done }] : [])].slice(-30) }); });
        const prev = st.text && st.date !== today() && !st.done ? h('button', { class: 'chip', onclick: () => save({ date: today(), done: false }) }, `↻ Continuar: ${st.text.slice(0, 40)}`) : null;
        body.replaceChildren(...[h('p', { class: 'muted center' }, 'Uma coisa de cada vez.'), input, prev ? h('div', { class: 'toolbar center' }, prev) : null].filter(Boolean));
        setTimeout(() => input.focus({ preventScroll: true }), 0);
        return;
      }
      body.replaceChildren(...[
        h('p', { class: 'muted center small' }, 'HOJE'),
        h('label', { class: 'focus-main' + (st.done ? ' done' : '') },
          h('input', { type: 'checkbox', checked: !!st.done, onchange: (e) => { save({ done: e.target.checked }); if (e.target.checked) ctx.toast('🎉 Foco do dia concluído!'); } }),
          h('span', {}, st.text)),
        st.done ? h('p', { class: 'center' }, '🎉 Mandou bem!') : null,
        h('div', { class: 'toolbar center' }, h('button', { class: 'chip', onclick: () => save({ text: '', date: '' }) }, '✎ Trocar'))].filter(Boolean));
    }

    const onChange = (c, area) => { if (area === 'local' && c[KEY]) { st = c[KEY].newValue || {}; render(); } };
    chrome.storage.onChanged.addListener(onChange);
    chrome.storage.local.get(KEY).then((r) => { st = r[KEY] || {}; render(); });
    return { destroy: () => chrome.storage.onChanged.removeListener(onChange) };
  },
};
