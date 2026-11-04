// Widget: lembretes e tarefas.
import { h } from '../lib/ui.js';
import { itemRow } from './brain.js';

export default {
  id: 'reminders',
  title: 'Lembretes e tarefas',
  icon: '⏰',
  description: 'O que está atrasado, para hoje e para os próximos dias.',
  defaultSize: 'm',
  mount(el, ctx) {
    let showDone = false;
    const list = h('div', { class: 'items' });
    const toggle = h('button', { title: 'Mostrar concluídas', onclick: () => { showDone = !showDone; toggle.textContent = showDone ? '🙈' : '✓'; render(); } }, '✓');
    ctx.actions.append(toggle, h('button', { title: 'Nova tarefa', onclick: () => ctx.newItem({ type: 'task' }) }, '＋'));

    function render() {
      const now = Date.now();
      const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
      const relevant = ctx.items.filter((i) => (i.type === 'task' || i.remindAt) && (showDone || !i.done));
      const groups = [
        ['Atrasados', relevant.filter((i) => !i.done && i.remindAt && i.remindAt < now)],
        ['Hoje', relevant.filter((i) => !i.done && i.remindAt && i.remindAt >= now && i.remindAt <= endToday)],
        ['Próximos', relevant.filter((i) => !i.done && i.remindAt && i.remindAt > endToday)],
        ['Sem data', relevant.filter((i) => !i.done && !i.remindAt)],
        ['Concluídas', showDone ? relevant.filter((i) => i.done).slice(0, 20) : []],
      ];
      list.replaceChildren();
      let total = 0;
      for (const [label, arr] of groups) {
        if (!arr.length) continue;
        total += arr.length;
        arr.sort((a, b) => (a.remindAt || a.createdAt) - (b.remindAt || b.createdAt));
        list.append(h('div', { class: 'group-label' }, `${label} · ${arr.length}`));
        arr.slice(0, 30).forEach((it) => list.append(itemRow(it, ctx, { checkbox: true })));
      }
      if (!total) list.append(h('p', { class: 'muted' }, 'Nada pendente 🎉  Escreva "me lembre amanhã às 9h de…" na Captura rápida.'));
    }
    el.append(list);
    render();
    const off = ctx.on('brain', render);
    const t = setInterval(render, 60_000);
    return { destroy: () => { off(); clearInterval(t); } };
  },
};
