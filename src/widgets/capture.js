// Widget: captura rápida — nota, tarefa ou ideia, por texto ou voz.
import { h, micButton, toLocalInput, fromLocalInput } from '../lib/ui.js';
import { parseReminder, fmtDateTime } from '../lib/brain.js';
import { saveCapture, validateImage } from '../lib/captures.js';
import { t } from '../lib/i18n.js';

export default {
  id: 'capture',
  title: 'Captura rápida',
  icon: '⚡',
  description: 'Anote uma ideia, tarefa ou lembrete em segundos — digitando ou falando.',
  defaultW: 6,
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

    // ---------- Colar imagem (Ctrl+V) → Biblioteca de imagens ----------
    // Texto colado continua indo para o campo; se houver imagem junto, ela aparece numa prévia para confirmar.
    const pasteBox = h('div', { class: 'paste-preview', hidden: true });
    let pending = null; // { blob, url }
    let lastPaste = { sig: '', at: 0 };
    const clearPaste = () => {
      if (pending) URL.revokeObjectURL(pending.url);
      pending = null;
      pasteBox.hidden = true;
      pasteBox.replaceChildren();
    };
    ta.addEventListener('paste', (e) => {
      const file = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
      if (!file) return; // só texto: comportamento normal
      const hasText = !!e.clipboardData.getData('text/plain');
      if (!hasText) e.preventDefault();
      const sig = `${file.type}:${file.size}`;
      if (sig === lastPaste.sig && Date.now() - lastPaste.at < 1500) return; // evento repetido
      lastPaste = { sig, at: Date.now() };
      try {
        validateImage(file);
      } catch (err) {
        ctx.toast(t(err.message));
        return;
      }
      clearPaste();
      pending = { blob: file, url: URL.createObjectURL(file) };
      const kb = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1048576).toFixed(1).replace('.', ',')} MB`;
      pasteBox.append(
        h('img', { src: pending.url, alt: '' }),
        h('div', { class: 'grow' }, h('b', {}, 'Imagem colada'), h('small', { class: 'muted' }, ` ${kb}`)),
        h('button', { class: 'chip', type: 'button', onclick: clearPaste }, 'Cancelar'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const blob = pending?.blob;
          if (!blob) return;
          try {
            await saveCapture({ blob, type: blob.type, fileName: blob.name && blob.name !== 'image.png' ? blob.name : `colada-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, source: 'clipboard' });
            clearPaste();
            ctx.toast('Imagem salva na biblioteca 🖼️');
          } catch (err) {
            ctx.toast(t(err.message));
          }
        } }, 'Salvar na biblioteca'));
      pasteBox.hidden = false;
    });

    el.append(ta, pasteBox, h('div', { class: 'toolbar' }, ...chips, clockBtn, when, h('span', { class: 'grow' }), mic, save), hint);
    updateHint();
    return { destroy: clearPaste };
  },
};
