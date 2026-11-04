// Widget: pergunte ao seu cérebro (chat com as notas) + assistente de voz.
import { h, micButton, miniMarkdown, speak } from '../lib/ui.js';
import { ask, aiConfig } from '../lib/ai.js';
import { displayTitle, searchItems } from '../lib/brain.js';

export default {
  id: 'ask',
  title: 'Pergunte ao seu cérebro',
  icon: '🤖',
  description: 'Converse com a IA sobre as suas notas. Também funciona por voz.',
  defaultSize: 'm',
  mount(el, ctx) {
    const history = [];
    const chat = h('div', { class: 'chat' });
    const input = h('input', { type: 'text', placeholder: 'Ex.: "o que eu salvei sobre microbioma?"' });
    const send = h('button', { class: 'btn primary', type: 'button', onclick: () => go(input.value) }, 'Enviar');
    const mic = micButton(input, { lang: ctx.settings.voiceLang, title: 'Perguntar por voz', onFinal: (t) => go(t, true) });
    const spk = h('button', { title: 'Ler respostas em voz alta', onclick: async () => { await ctx.saveSettings({ speakAnswers: !ctx.settings.speakAnswers }); paintSpk(); } });
    const clear = h('button', { title: 'Limpar conversa', onclick: () => { history.length = 0; chat.replaceChildren(); intro(); } }, '🧹');
    const paintSpk = () => { spk.textContent = ctx.settings.speakAnswers ? '🔊' : '🔈'; };
    paintSpk();
    ctx.actions.append(spk, clear);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(input.value); });

    function intro() {
      if (!ctx.aiReady()) {
        chat.append(h('div', { class: 'msg bot' },
          h('p', {}, 'Para conversar com as suas notas, conecte uma IA. O Gemini tem camada gratuita.'),
          h('p', {}, h('button', { class: 'btn primary', onclick: () => ctx.openSettings('#ia') }, 'Configurar IA'))));
      } else {
        chat.append(h('div', { class: 'msg bot' }, h('p', {}, `Pergunte qualquer coisa sobre o que você salvou. Usando ${aiConfig(ctx.settings).p.name}.`)));
      }
    }

    function sourcesBar(sources, answer) {
      const cited = [...new Set([...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => +m[1]))].filter((n) => sources[n - 1]);
      if (!cited.length) return null;
      return h('div', { class: 'srcs' }, ...cited.map((n) => h('button', { onclick: () => ctx.openItem(sources[n - 1]) }, `[${n}] ${displayTitle(sources[n - 1]).slice(0, 40)}`)));
    }

    async function go(text, byVoice) {
      const q = (text || '').trim();
      if (!q) return;
      input.value = '';
      chat.append(h('div', { class: 'msg user' }, q));
      if (!ctx.aiReady()) {
        const found = searchItems(ctx.items, q, 5);
        chat.append(h('div', { class: 'msg bot' },
          h('p', {}, found.length ? 'Sem IA configurada — encontrei estes itens:' : 'Sem IA configurada e nada encontrado nas notas.'),
          ...found.map((it) => h('p', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.openItem(it); } }, displayTitle(it))))));
        chat.scrollTop = chat.scrollHeight;
        return;
      }
      const wait = h('div', { class: 'msg bot typing' }, 'Pensando');
      chat.append(wait);
      chat.scrollTop = chat.scrollHeight;
      try {
        const { answer, sources } = await ask(ctx.settings, ctx.items, q, history);
        history.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
        const msg = h('div', { class: 'msg bot', html: miniMarkdown(answer) });
        msg.addEventListener('click', (e) => {
          const c = e.target.closest('.cite');
          if (c) { e.preventDefault(); const it = sources[+c.dataset.n - 1]; if (it) ctx.openItem(it); }
        });
        const bar = sourcesBar(sources, answer);
        if (bar) msg.append(bar);
        wait.replaceWith(msg);
        if (ctx.settings.speakAnswers || byVoice) speak(answer, ctx.settings.voiceLang);
      } catch (e) {
        wait.replaceWith(h('div', { class: 'msg bot err' }, e.message));
      }
      chat.scrollTop = chat.scrollHeight;
    }

    el.append(chat, h('div', { class: 'row-input' }, input, mic, send));
    intro();
    const off = ctx.on('ask', (q) => { el.closest('.widget')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); go(q); });
    return { destroy: off };
  },
};
