// Widget: atalhos em blocos coloridos (o visual clássico do Speed Dial).
import { h, showCtx } from '../lib/ui.js';

export default {
  id: 'shortcuts',
  title: 'Atalhos',
  icon: '🔲',
  description: 'Os blocos coloridos de um grupo de atalhos, no centro da tela.',
  defaultW: 12,
  mount(el, ctx) {
    const sel = h('select', { style: { width: 'auto', height: '26px', padding: '0 6px', fontSize: '12px' } });
    const grid = h('div', { class: 'grid' });
    ctx.actions.append(sel);
    sel.addEventListener('change', () => { ctx.saveWidget({ groupId: sel.value }); render(); });

    function render() {
      const data = ctx.data;
      sel.replaceChildren(...data.groups.map((g) => new Option(`${g.icon} ${g.name}`, g.id)));
      const gid = data.groups.some((g) => g.id === ctx.widget.groupId) ? ctx.widget.groupId : data.groups[0].id;
      sel.value = gid;
      fit();
      const target = data.settings.openInNewTab ? '_blank' : '_self';
      grid.replaceChildren(...data.links.filter((l) => l.groupId === gid).map((l) => {
        const img = h('img', { alt: '', src: ctx.faviconFor(l) });
        img.onerror = () => { img.style.display = 'none'; };
        const a = h('a', { class: 'tile', href: l.url, target, title: l.url, style: { '--c': l.color } }, h('span', { class: 'pill' }, img, h('span', {}, l.title)));
        a.addEventListener('contextmenu', (e) => showCtx(e, [['↗ Abrir em nova aba', () => window.open(l.url, '_blank')], ['✎ Editar', () => ctx.openLinkDialog(l)]]));
        return a;
      }));
      if (!grid.children.length) grid.append(h('p', { class: 'muted' }, 'Grupo vazio.'));
    }
    function fit() {
      const cols = Math.max(2, Math.min(ctx.data.settings.columns, Math.floor((grid.clientWidth || 600) / 140)));
      grid.style.setProperty('--gcols', cols);
    }
    el.append(grid);
    render();
    const ro = new ResizeObserver(fit);
    ro.observe(grid);
    const off = ctx.on('data', render);
    return { destroy: () => { off(); ro.disconnect(); } };
  },
};
