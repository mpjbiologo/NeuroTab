// Widget: slide de fotos (do computador ou galerias online).
import { h } from '../lib/ui.js';
import { photoList, photoUrl, preload, addFiles, SOURCES } from '../lib/photos.js';

export default {
  id: 'photos',
  title: 'Fotos',
  icon: '🖼',
  description: 'Slide de fotos do seu computador, foto do dia do Bing ou astronomia da NASA.',
  defaultW: 4,
  mount(el, ctx) {
    let list = [];
    let i = 0;
    let paused = false;
    let timer;
    const src = h('select', { style: { width: 'auto', height: '26px', padding: '0 6px', fontSize: '12px' } }, ...Object.entries(SOURCES).map(([k, v]) => new Option(v, k)));
    src.value = ctx.widget.source || 'local';
    src.onchange = async () => { await ctx.saveWidget({ source: src.value }); load(); };
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    const addBtn = h('button', { title: 'Adicionar fotos do computador', onclick: () => file.click() }, '＋');
    ctx.actions.append(src, addBtn);

    const frame = h('div', { class: 'ph-frame' });
    const imgA = h('div', { class: 'ph-img' });
    const imgB = h('div', { class: 'ph-img' });
    const cap = h('div', { class: 'ph-cap' });
    const nav = h('div', { class: 'ph-nav' },
      h('button', { title: 'Anterior', onclick: () => step(-1) }, '‹'),
      h('button', { title: 'Pausar/continuar', onclick: (e) => { paused = !paused; e.target.textContent = paused ? '▶' : '⏸'; schedule(); } }, '⏸'),
      h('button', { title: 'Próxima', onclick: () => step(1) }, '›'),
      h('button', { title: 'Usar estas fotos como plano de fundo', onclick: async () => { await ctx.saveSettings({ bgMode: 'slides', slideSource: src.value, bgEnabled: true }); ctx.toast('Slides definidos como plano de fundo'); } }, '🖥'));
    frame.append(imgA, imgB, cap, nav);
    el.append(frame, file);
    let front = imgA;

    file.onchange = async () => {
      const n = file.files.length;
      ctx.toast(`Adicionando ${n} foto(s)…`);
      const done = await addFiles(file.files);
      file.value = '';
      ctx.toast(`${done} foto(s) adicionada(s)`);
      if (src.value !== 'local' && src.value !== 'all') { src.value = 'local'; await ctx.saveWidget({ source: 'local' }); }
      load();
    };

    async function show(k) {
      if (!list.length) return;
      i = (k + list.length) % list.length;
      const p = list[i];
      const url = await photoUrl(p);
      if (!url) return;
      await preload(url);
      const back = front === imgA ? imgB : imgA;
      back.style.backgroundImage = `url("${url}")`;
      back.classList.add('on');
      front.classList.remove('on');
      front = back;
      cap.replaceChildren(p.link ? h('a', { href: p.link, target: '_blank' }, p.title || p.credit) : h('span', {}, p.title || ''), h('small', {}, ` ${p.credit || ''} · ${i + 1}/${list.length}`));
    }
    const step = (d) => { show(i + d); schedule(); };
    function schedule() {
      clearTimeout(timer);
      if (!paused && list.length > 1) timer = setTimeout(() => step(1), (ctx.widget.interval || 12) * 1000);
    }
    async function load() {
      list = await photoList(src.value);
      if (!list.length) {
        imgA.classList.remove('on'); imgB.classList.remove('on');
        cap.replaceChildren(h('span', {}, src.value === 'local' ? 'Nenhuma foto ainda — clique em ＋ para adicionar do seu computador.' : 'Galeria indisponível no momento.'));
        return;
      }
      for (let k = list.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [list[k], list[j]] = [list[j], list[k]]; }
      await show(0);
      schedule();
    }
    load();
    return { destroy: () => clearTimeout(timer) };
  },
};
