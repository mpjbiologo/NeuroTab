// Widget: captura rápida — nota, tarefa ou ideia, por texto ou voz.
import { h, micButton, toLocalInput, fromLocalInput } from '../lib/ui.js';
import { parseReminder, fmtDateTime } from '../lib/brain.js';

export default {
  id: 'capture',
  title: 'Captura rápida',
  icon: '⚡',
  description: 'Anote uma ideia, tarefa ou lembrete em segundos — digitando ou falando.',
  defaultSize: 'm',
  mount(el, ctx) {
    let type = 'note';
    let usedVoice = false;
    const ta = h('textarea', { rows: 3, placeholder: 'O que está na sua cabeça? Ex.: "me lembre amanhã às 9h de ligar para o banco"  (Ctrl+Enter salva)' });
    const when = h('input', { type: 'datetime-local', hidden: true, style: { width: 'auto' } });
    const hint = h('div', { class: 'muted', style: { marginTop: '6px', minHeight: '18px' } });
    const chips = [['note', '📝 Nota'], ['task', '☑️ Tarefa'], ['idea', '💡 Ideia']].map(([k, label]) =>
      h('button', { class: 'chip' + (k === type ? ' sel' : ''), type: 'button', onclick: () => { type = k; chips.forEach((c, i) => c.classList.toggle('sel', ['note', 'task', 'idea'][i] === k)); } }, label));
    const clockBtn = h('button', { class: 'chip', type: 'button', title: 'Definir lembrete', onclick: () => { when.hidden = !when.hidden; if (!when.hidden && !when.value) when.value = toLocalInput(Date.now() + 3600e3); updateHint(); } }, '⏰');
    const mic = micButton(ta, { lang: ctx.settings.voiceLang, onFinal: () => { usedVoice = true; } });
    const save = h('button', { class: 'btn primary', type: 'button', onclick: () => submit() }, 'Salvar');

    const detected = () => (when.hidden ? parseReminder(ta.value) : fromLocalInput(when.value));
    const updateHint = () => {
      const ts = detected();
      hint.textContent = ts ? `⏰ Lembrete: ${fmtDateTime(ts)}` : ctx.aiReady() ? '✨ A IA vai dar título, tags e detectar lembretes.' : '';
    };
    ta.addEventListener('input', updateHint);
    when.addEventListener('input', updateHint);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });

    async function submit() {
      const text = ta.value.trim();
      if (!text) return ta.focus();
      const remindAt = detected();
      await ctx.capture({ type: remindAt && type === 'note' ? 'task' : type, text, remindAt, source: usedVoice ? 'voice' : 'manual' });
      ta.value = '';
      when.hidden = true;
      when.value = '';
      usedVoice = false;
      updateHint();
      ctx.toast(remindAt ? `Salvo com lembrete para ${fmtDateTime(remindAt)} ⏰` : 'Salvo no cérebro 🧠');
    }

    el.append(ta, h('div', { class: 'toolbar' }, ...chips, clockBtn, when, h('span', { class: 'grow' }), mic, save), hint);
    updateHint();
  },
};
