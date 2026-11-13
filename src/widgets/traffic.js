// Widget: trânsito — mapa ao vivo do Waze, locais e rotas favoritas.
import { requestFeature } from '../lib/permissions.js';
import { h, showCtx } from '../lib/ui.js';
import { uid } from '../lib/store.js';
import { gmapsRoute, wazeTo, placesContext } from '../lib/places.js';

const ICONS = ['🏠', '💼', '🏫', '🏋️', '🏥', '🛒', '🍽️', '⛪', '✈️', '⭐', '👪', '🅿️'];
const MODES = { driving: '🚗 Carro', transit: '🚌 Transporte', walking: '🚶 A pé', bicycling: '🚲 Bicicleta' };

export { gmapsRoute, wazeTo }; // continuam disponíveis por aqui (compatibilidade)

async function searchAddress(q) {
  // Pedido direto no clique de "Buscar" (se já houver acesso, não aparece nada).
  if (!(await requestFeature('traffic'))) throw new Error('Para buscar endereços, permita o acesso ao OpenStreetMap.');
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=0&accept-language=pt-BR&q=${encodeURIComponent(q)}`;
  const r = await (await fetch(u, { headers: { Accept: 'application/json' } })).json();
  return r.map((x) => ({ address: x.display_name, lat: +x.lat, lon: +x.lon }));
}

export default {
  id: 'traffic',
  title: 'Trânsito',
  icon: '🚦',
  description: 'Mapa com trânsito ao vivo (Waze), seus locais favoritos (casa, trabalho…) e rotas com um clique.',
  /** O cérebro conhece os locais e rotas salvos quando a pergunta é sobre lugares (#43). */
  brainContext: (settings, question) => placesContext(settings, question),
  defaultW: 6,
  mount(el, ctx) {
    let view = 'map';
    let center = null;
    let zoom = ctx.widget.zoom || 13;
    const places = () => ctx.settings.mapPlaces || [];
    const routes = () => ctx.settings.mapRoutes || [];
    const body = h('div', { class: 'traffic' });
    const cfgBtn = h('button', { title: 'Locais e rotas', onclick: () => { view = view === 'map' ? 'manage' : 'map'; render(); } }, '⚙');
    ctx.actions.append(
      h('button', { title: 'Aproximar', onclick: () => { zoom = Math.min(17, zoom + 1); ctx.saveWidget({ zoom }); render(); } }, '＋'),
      h('button', { title: 'Afastar', onclick: () => { zoom = Math.max(4, zoom - 1); ctx.saveWidget({ zoom }); render(); } }, '－'),
      cfgBtn);
    el.append(body);

    const byId = (id) => places().find((p) => p.id === id);
    const savePlaces = (arr) => ctx.saveSettings({ mapPlaces: arr });
    const saveRoutes = (arr) => ctx.saveSettings({ mapRoutes: arr });

    function mapView() {
      const ps = places();
      const fallback = ctx.settings.places?.[0];
      const c = center || ps[0] || fallback;
      const out = [];
      if (ps.length) {
        out.push(h('div', { class: 'toolbar' }, ...ps.map((p) => {
          const chip = h('button', { class: 'chip' + (c === p ? ' sel' : ''), title: p.address, onclick: () => { center = p; render(); } }, `${p.icon} ${p.name}`);
          chip.oncontextmenu = (e) => showCtx(e, [
            ['🗺 Rota até aqui (Google Maps)', () => window.open(gmapsRoute(null, p), '_blank')],
            ['🚙 Navegar no Waze', () => window.open(wazeTo(p), '_blank')],
            '-',
            ['🗑 Remover local', () => savePlaces(ps.filter((x) => x !== p)).then(render), 'danger'],
          ]);
          return chip;
        })));
      }
      const rs = routes().filter((r) => byId(r.to));
      if (rs.length) {
        out.push(h('div', { class: 'routes' }, ...rs.map((r) => {
          const from = r.from === 'here' ? null : byId(r.from);
          const to = byId(r.to);
          return h('div', { class: 'route' },
            h('span', { class: 'rt-name' }, `${MODES[r.mode]?.split(' ')[0] || '🚗'} ${r.name || `${from ? from.name : 'Aqui'} → ${to.name}`}`),
            h('a', { class: 'chip', href: gmapsRoute(from, to, r.mode), target: '_blank', title: 'Rota com trânsito no Google Maps' }, 'Google Maps'),
            h('a', { class: 'chip', href: wazeTo(to), target: '_blank', title: 'Navegar no Waze (sai da sua localização atual)' }, 'Waze'));
        })));
      }
      if (c) {
        const src = `https://embed.waze.com/pt-BR/iframe?zoom=${zoom}&lat=${c.lat}&lon=${c.lon}&pin=1`;
        out.push(h('iframe', { class: 'map', src, title: 'Mapa de trânsito do Waze', loading: 'lazy', referrerpolicy: 'no-referrer-when-downgrade' }));
      } else {
        out.push(h('p', { class: 'muted' }, 'Adicione seus locais favoritos (casa, trabalho…) para ver o trânsito.'), h('button', { class: 'btn primary', onclick: () => { view = 'manage'; render(); } }, '＋ Adicionar local'));
      }
      if (!ps.length && c) out.push(h('p', { class: 'muted small' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); view = 'manage'; render(); } }, '＋ Cadastre casa, trabalho e rotas favoritas')));
      return out;
    }

    function manageView() {
      // ---- locais
      let icon = '🏠';
      const name = h('input', { type: 'text', placeholder: 'Nome (ex.: Casa, Trabalho, Academia)' });
      const q = h('input', { type: 'text', placeholder: 'Endereço (rua, número, cidade)' });
      const results = h('div', { class: 'items' });
      const icons = h('div', { class: 'toolbar' }, ...ICONS.map((ic) => h('button', { class: 'chip' + (ic === icon ? ' sel' : ''), type: 'button', onclick: (e) => { icon = ic; [...icons.children].forEach((b) => b.classList.toggle('sel', b === e.target)); } }, ic)));
      const find = async () => {
        if (!q.value.trim()) return q.focus();
        results.replaceChildren(h('p', { class: 'muted' }, 'Buscando endereço…'));
        try {
          const res = await searchAddress(q.value.trim());
          results.replaceChildren(...res.map((r) => h('div', { class: 'item', onclick: async () => {
            const p = { id: uid(), name: name.value.trim() || r.address.split(',')[0], icon, address: r.address, lat: r.lat, lon: r.lon };
            await savePlaces([...places(), p]);
            ctx.toast(`${p.icon} ${p.name} salvo`);
            render();
          } }, h('span', { class: 'ic' }, '📍'), h('div', { class: 'body' }, h('div', { class: 'tt' }, r.address.split(',').slice(0, 2).join(',')), h('div', { class: 'tx' }, r.address)))));
          if (!res.length) results.replaceChildren(h('p', { class: 'muted' }, 'Endereço não encontrado. Tente incluir a cidade.'));
        } catch (e) {
          results.replaceChildren(h('p', { class: 'muted' }, /permita/.test(e?.message) ? e.message : 'Sem conexão com o serviço de endereços.'));
        }
      };
      q.addEventListener('keydown', (e) => e.key === 'Enter' && find());
      const list = h('div', { class: 'items' }, ...places().map((p) => h('div', { class: 'item' },
        h('span', { class: 'ic' }, p.icon),
        h('div', { class: 'body' }, h('div', { class: 'tt' }, p.name), h('div', { class: 'tx' }, p.address)),
        h('button', { class: 'chip danger', onclick: async () => { await savePlaces(places().filter((x) => x.id !== p.id)); await saveRoutes(routes().filter((r) => r.to !== p.id && r.from !== p.id)); render(); } }, '✕'))));

      // ---- rotas
      const opts = () => [new Option('📍 Minha localização', 'here'), ...places().map((p) => new Option(`${p.icon} ${p.name}`, p.id))];
      const from = h('select', {}, ...opts());
      const to = h('select', {}, ...places().map((p) => new Option(`${p.icon} ${p.name}`, p.id)));
      const mode = h('select', {}, ...Object.entries(MODES).map(([k, v]) => new Option(v, k)));
      const rname = h('input', { type: 'text', placeholder: 'Nome da rota (opcional)' });
      if (places()[1]) to.value = places()[1].id;
      if (places()[0]) from.value = places()[0].id;
      const rlist = h('div', { class: 'items' }, ...routes().map((r) => h('div', { class: 'item' },
        h('span', { class: 'ic' }, MODES[r.mode]?.split(' ')[0] || '🚗'),
        h('div', { class: 'body' }, h('div', { class: 'tt' }, r.name || `${r.from === 'here' ? 'Aqui' : byId(r.from)?.name} → ${byId(r.to)?.name}`)),
        h('button', { class: 'chip danger', onclick: async () => { await saveRoutes(routes().filter((x) => x.id !== r.id)); render(); } }, '✕'))));

      return [
        h('div', { class: 'toolbar' }, h('b', {}, '📍 Meus locais'), h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => { view = 'map'; render(); } }, '← Voltar ao mapa')),
        list,
        h('div', { class: 'al-form' }, name, icons, h('div', { class: 'row-input' }, q, h('button', { class: 'btn', onclick: find }, 'Buscar')), results),
        h('div', { class: 'toolbar', style: { marginTop: '14px' } }, h('b', {}, '🧭 Rotas favoritas')),
        rlist,
        places().length
          ? h('div', { class: 'al-form' },
            h('div', { class: 'row-input' }, from, h('span', {}, '→'), to),
            h('div', { class: 'row-input' }, mode, rname),
            h('button', { class: 'btn primary', onclick: async () => {
              if (from.value === to.value) return ctx.toast('Origem e destino iguais');
              await saveRoutes([...routes(), { id: uid(), from: from.value, to: to.value, mode: mode.value, name: rname.value.trim() }]);
              ctx.toast('Rota salva');
              render();
            } }, '＋ Salvar rota'))
          : h('p', { class: 'muted' }, 'Cadastre pelo menos um local para criar rotas.'),
        h('p', { class: 'muted small' }, 'Endereços: OpenStreetMap. Mapa e trânsito: Waze. O tempo estimado de viagem aparece ao abrir a rota no Google Maps ou no Waze.'),
      ];
    }

    function render() {
      cfgBtn.classList.toggle('sel', view !== 'map');
      body.replaceChildren(...(view === 'map' ? mapView() : manageView()));
    }
    render();
    const off = ctx.on('data', () => { if (view === 'map') render(); });
    return { destroy: off };
  },
};
