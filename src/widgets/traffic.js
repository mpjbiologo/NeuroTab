// Widget: trânsito — mapa ao vivo do Waze, locais e rotas favoritas e trajetos traçados aqui mesmo
// (mapa próprio + OpenStreetMap), sem abrir site externo. O cérebro e a voz mandam rotas para cá.
import { requestFeature, requestAccess, hasFeature, FEATURES } from '../lib/permissions.js';
import { h, showCtx } from '../lib/ui.js';
import { uid } from '../lib/store.js';
import { gmapsRoute, wazeTo, placesContext, streetRoute, geocode, stepText, formatKm, formatMin, hasCoordsOf } from '../lib/places.js';
import { createRouteMap } from '../lib/route-map.js';

const ICONS = ['🏠', '💼', '🏫', '🏋️', '🏥', '🛒', '🍽️', '⛪', '✈️', '⭐', '👪', '🅿️'];
const MODES = { driving: '🚗 Carro', transit: '🚌 Transporte', walking: '🚶 A pé', bicycling: '🚲 Bicicleta' };
const ROUTE_MODES = { driving: '🚗 Carro', walking: '🚶 A pé', bicycling: '🚲 Bicicleta' }; // o OpenStreetMap não tem ônibus

export { gmapsRoute, wazeTo }; // continuam disponíveis por aqui (compatibilidade)

async function searchAddress(q, near) {
  // Pedido direto no clique de "Buscar" (se já houver acesso, não aparece nada).
  if (!(await requestFeature('traffic'))) throw new Error('Para buscar endereços, permita o acesso ao OpenStreetMap.');
  return geocode(q, { near, limit: 6 });
}

/** Sites que o trajeto usa: endereços (Nominatim) e ruas (OSRM). Um só pedido, direto no clique. */
const ROUTE_ACCESS = { origins: [...FEATURES.traffic.origins, ...FEATURES.routing.origins], data: ['locationInfo'] };
const hasRouteAccess = async () => (await hasFeature('traffic')) && (await hasFeature('routing'));

export default {
  id: 'traffic',
  title: 'Trânsito',
  icon: '🚦',
  description: 'Mapa com trânsito ao vivo (Waze), seus locais favoritos (casa, trabalho…) e rotas traçadas aqui mesmo.',
  /** O cérebro conhece os locais e rotas salvos quando a pergunta é sobre lugares (#43). */
  brainContext: (settings, question) => placesContext(settings, question),
  defaultW: 6,
  mount(el, ctx) {
    let view = 'map';
    let center = null;
    let zoom = ctx.widget.zoom || 13;
    let trip = null; // { from, to, mode } pedido
    let result = null; // { status, from, to, route, error }
    let rmap = null;
    let mapMsg = null; // aviso no mapa ao vivo: { loading } | { need: lugar } | { error }
    const places = () => ctx.settings.mapPlaces || [];
    const routes = () => ctx.settings.mapRoutes || [];
    const body = h('div', { class: 'traffic' });
    const zoomIn = h('button', { title: 'Aproximar', onclick: () => { zoom = Math.min(17, zoom + 1); ctx.saveWidget({ zoom }); render(); } }, '＋');
    const zoomOut = h('button', { title: 'Afastar', onclick: () => { zoom = Math.max(4, zoom - 1); ctx.saveWidget({ zoom }); render(); } }, '－');
    const routeBtn = h('button', { title: 'Traçar rota', onclick: () => { view = view === 'route' ? 'map' : 'route'; render(); } }, '🧭');
    const cfgBtn = h('button', { title: 'Locais e rotas favoritos', onclick: () => { view = view === 'manage' ? 'map' : 'manage'; render(); } }, '⭐');
    ctx.actions.append(zoomIn, zoomOut, routeBtn, cfgBtn);
    el.append(body);

    const byId = (id) => places().find((p) => p.id === id);
    const savePlaces = (arr) => ctx.saveSettings({ mapPlaces: arr });
    const saveRoutes = (arr) => ctx.saveSettings({ mapRoutes: arr });
    const homeOf = () => places().find((p) => /^(casa|home|lar)$/i.test(p.name.trim())) || places()[0] || null;
    /** Ponto de referência para procurar endereços: casa, primeiro local ou a cidade do clima. */
    const nearRef = () => homeOf() || ctx.settings.places?.find?.(hasCoordsOf) || null;

    function maximize() {
      // Depois do evento atual: se o pedido veio de um Enter, o foco no botão ⤢ receberia esse Enter
      // e restauraria o widget na mesma hora.
      setTimeout(() => {
        const card = el.closest('.widget');
        if (card?.isConnected && !card.classList.contains('maximized')) card.querySelector('.wwin-max')?.click();
      }, 30);
    }

    // ---------- Trajeto ----------
    /** Recebe um pedido (do cérebro, da voz ou do formulário), mostra e calcula. */
    function openRoute(next, { max = true } = {}) {
      trip = { from: next.from || null, to: next.to, mode: ROUTE_MODES[next.mode] ? next.mode : 'driving' };
      view = 'route';
      if (max) maximize();
      compute();
    }

    /** "Como está o trânsito em X?": mapa ao vivo do Waze centrado em X, maximizado. */
    async function liveAt(p) {
      view = 'map';
      maximize();
      if (!p) { center = null; mapMsg = null; render(); return; } // perto de casa
      if (hasCoordsOf(p)) { center = p; zoom = 14; mapMsg = null; render(); return; }
      if (!(await hasFeature('traffic'))) { mapMsg = { need: p }; render(); return; }
      mapMsg = { loading: p.name };
      render();
      const [hit] = await geocode(p.query || p.name, { near: nearRef() }).catch(() => []);
      if (!hit) { mapMsg = { error: `Não encontrei "${p.name}" no mapa. Tente com a cidade (ex.: "centro de Belo Horizonte").` }; render(); return; }
      center = { ...hit, name: p.name || hit.name, address: hit.address };
      zoom = 14;
      mapMsg = null;
      render();
    }

    async function resolvePoint(p) {
      if (!p) return null;
      if (typeof p === 'string') p = { name: p, query: p };
      if (hasCoordsOf(p)) return p;
      const q = p.query || p.address || p.name;
      const [hit] = await geocode(q, { near: nearRef() });
      return hit ? { ...hit, name: p.name || hit.name, found: true } : null;
    }

    async function compute() {
      if (!trip?.to) { render(); return; }
      if (!(await hasRouteAccess())) { result = { status: 'need-access' }; render(); return; }
      result = { status: 'loading' };
      render();
      const t0 = trip;
      try {
        const to = await resolvePoint(t0.to);
        if (!to) throw new Error(`Não encontrei "${t0.to.name || t0.to}" no mapa. Tente com a cidade ou o endereço.`);
        const same = (p) => p && ((p.id && p.id === to.id) || (Math.abs(p.lat - to.lat) < 1e-5 && Math.abs(p.lon - to.lon) < 1e-5));
        // Sem origem: casa, outro local salvo ou a cidade do clima — nunca o próprio destino.
        const from = (await resolvePoint(t0.from)) || [homeOf(), ...places(), ...(ctx.settings.places || [])].find((p) => hasCoordsOf(p) && !same(p)) || null;
        if (!from) throw new Error('De onde você sai? Salve sua casa (⭐) ou escolha a origem acima.');
        const route = await streetRoute(from, to, t0.mode);
        if (trip !== t0) return; // chegou outro pedido no meio
        if (!route) {
          const why = streetRoute.lastErrors.join(' · ');
          const blocked = /HTTP 4\d\d|Failed to fetch|NetworkError/i.test(why);
          throw new Error(blocked
            ? `Os servidores de rotas não responderam (${why}). Verifique a internet ou tente de novo em instantes.`
            : `Não achei um caminho pela rua entre ${from.name} e ${to.name}.${why ? ` (${why})` : ''}`);
        }
        result = { status: 'ok', from, to, route };
      } catch (e) {
        if (trip !== t0) return;
        result = { status: 'error', error: e?.message && !/^(Failed to fetch|NetworkError)/i.test(e.message) ? e.message : 'Sem conexão com o OpenStreetMap agora.' };
      }
      render();
    }

    function routeForm() {
      const opts = [new Option('🏠 Origem: casa / padrão', ''), ...places().map((p) => new Option(`${p.icon} ${p.name}`, p.id))];
      const from = h('select', { 'aria-label': 'Origem' }, ...opts);
      const to = h('input', { type: 'text', placeholder: 'Para onde? (local salvo, endereço ou lugar)', list: 'nt-places-list', 'aria-label': 'Destino' });
      const dl = h('datalist', { id: 'nt-places-list' }, ...places().map((p) => h('option', { value: p.name })));
      const mode = h('select', { 'aria-label': 'Como' }, ...Object.entries(ROUTE_MODES).map(([k, v]) => new Option(v, k)));
      if (trip) {
        from.value = trip.from?.id && byId(trip.from.id) ? trip.from.id : '';
        to.value = trip.to?.name || '';
        mode.value = trip.mode;
      }
      const go = async () => {
        const name = to.value.trim();
        if (!name) return to.focus();
        // Acesso pedido aqui, direto no clique, antes de qualquer espera.
        if (!(await hasRouteAccess()) && !(await requestAccess(ROUTE_ACCESS))) { result = { status: 'need-access' }; render(); return; }
        const saved = places().find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
        openRoute({ from: byId(from.value) || null, to: saved || { name, query: name }, mode: mode.value }, { max: false });
      };
      to.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      return h('div', { class: 'route-form' }, from, h('span', {}, '→'), to, dl, mode, h('button', { class: 'btn primary', onclick: go }, 'Traçar'));
    }

    function savePlaceForm(p, after) {
      let icon = '⭐';
      const name = h('input', { type: 'text', value: p.name || '', placeholder: 'Nome (ex.: Academia)' });
      const icons = h('div', { class: 'toolbar' }, ...ICONS.map((ic) => h('button', { class: 'chip' + (ic === icon ? ' sel' : ''), type: 'button', onclick: (e) => { icon = ic; [...icons.children].forEach((b) => b.classList.toggle('sel', b === e.currentTarget)); } }, ic)));
      return h('div', { class: 'al-form save-place' }, name, icons, h('button', { class: 'btn primary', onclick: async () => {
        const np = { id: uid(), name: name.value.trim() || p.name || 'Local', icon, address: p.address || '', lat: +p.lat, lon: +p.lon };
        await savePlaces([...places(), np]);
        ctx.toast(`${np.icon} ${np.name} salvo nos favoritos`);
        after?.(np);
      } }, '⭐ Salvar nos favoritos'));
    }

    function routeView() {
      const out = [routeForm()];
      if (!trip) {
        out.push(h('p', { class: 'muted' }, 'Escolha o destino e toque em Traçar. Você também pode pedir ao cérebro ou por voz: "traçar rota para o centro".'));
        return out;
      }
      if (result?.status === 'need-access') {
        out.push(h('div', { class: 'route-msg' },
          h('p', {}, 'Para traçar a rota aqui, a NeuroTab consulta o OpenStreetMap (endereços e ruas). Só os pontos do trajeto são enviados.'),
          h('button', { class: 'btn primary', onclick: async () => { if (await requestAccess(ROUTE_ACCESS)) compute(); } }, '🔓 Permitir e traçar')));
        return out;
      }
      if (!result || result.status === 'loading') { out.push(h('p', { class: 'muted route-loading' }, `Traçando a rota até ${trip.to?.name || ''}…`)); return out; }
      if (result.status === 'error') { out.push(h('p', { class: 'muted route-error' }, result.error)); return out; }

      const { from, to, route } = result;
      const modeIc = ROUTE_MODES[trip.mode]?.split(' ')[0] || '🚗';
      out.push(h('div', { class: 'route-sum' },
        h('b', {}, `${modeIc} ${formatKm(route.km)} · ${formatMin(route.min)}`),
        h('span', { class: 'muted' }, ` ${from.icon || '📍'} ${from.name} → ${to.icon || '🏁'} ${to.name}`),
        h('span', { class: 'muted small' }, ' · tempo pela rua, sem o trânsito de agora')));
      const mapBox = h('div', { class: 'route-map' });
      out.push(mapBox);
      queueMicrotask(() => {
        rmap?.destroy();
        rmap = createRouteMap(mapBox);
        rmap.set({ line: route.coords, markers: [{ lon: +from.lon, lat: +from.lat, icon: from.icon || '🟢', title: from.name }, { lon: +to.lon, lat: +to.lat, icon: to.icon || '🏁', title: to.name }] });
      });

      const acts = h('div', { class: 'toolbar route-acts' });
      const savedTo = to.id && byId(to.id);
      const slot = h('div', {});
      if (!savedTo) {
        acts.append(h('button', { class: 'chip', onclick: () => slot.replaceChildren(savePlaceForm(to, (np) => { result.to = np; trip.to = np; render(); })) }, '⭐ Salvar destino'));
      }
      if (from.id && byId(from.id) && savedTo && !routes().some((r) => r.from === from.id && r.to === to.id && (r.mode || 'driving') === trip.mode)) {
        acts.append(h('button', { class: 'chip', onclick: async () => { await saveRoutes([...routes(), { id: uid(), from: from.id, to: to.id, mode: trip.mode, name: '' }]); ctx.toast('Rota salva nos favoritos'); render(); } }, '🧭 Salvar rota'));
      }
      acts.append(
        h('button', { class: 'chip', title: 'Trânsito ao vivo (Waze) no destino', onclick: () => { center = to; view = 'map'; render(); } }, '🚦 Trânsito no destino'),
        h('span', { class: 'grow' }),
        h('a', { class: 'chip ext', href: gmapsRoute(from, to, trip.mode), target: '_blank', rel: 'noopener', title: 'Abrir no Google Maps (nova aba)' }, 'Google Maps ↗'),
        h('a', { class: 'chip ext', href: wazeTo(to), target: '_blank', rel: 'noopener', title: 'Abrir no Waze (nova aba)' }, 'Waze ↗'));
      out.push(acts, slot);
      if (route.steps.length) {
        out.push(h('details', { class: 'route-steps' }, h('summary', {}, `Passo a passo (${route.steps.length})`),
          h('ol', {}, ...route.steps.map((st) => h('li', {}, stepText(st, 'pt'), st.km >= 0.05 ? h('span', { class: 'muted small' }, ` · ${formatKm(st.km)}`) : '')))));
      }
      return out;
    }

    // ---------- Mapa ao vivo (Waze) ----------
    function mapView() {
      const ps = places();
      const fallback = ctx.settings.places?.[0];
      const c = center || ps[0] || fallback;
      const out = [];
      const temp = c && center === c && !ps.includes(c) && hasCoordsOf(c) && c.address ? c : null; // lugar procurado, ainda não salvo
      const slot = h('div', {});
      const addBtn = h('button', { class: 'chip add', title: temp ? `Salvar "${temp.name}" nos favoritos` : 'Salvar um local favorito', onclick: () => {
        if (temp) slot.replaceChildren(savePlaceForm(temp, (np) => { center = np; render(); }));
        else { view = 'manage'; render(); }
      } }, temp ? `⭐ Salvar ${temp.name}` : '⭐ Salvar local');
      if (mapMsg) {
        out.push(h('div', { class: 'route-msg' }, mapMsg.need
          ? [h('p', {}, `Para achar "${mapMsg.need.name}" no mapa, a NeuroTab consulta o OpenStreetMap (só o nome do lugar é enviado).`),
            h('button', { class: 'btn primary', onclick: async () => { const p = mapMsg.need; if (await requestFeature('traffic')) liveAt(p); } }, '🔓 Permitir e mostrar')]
          : h('p', { class: 'muted' }, mapMsg.loading ? `Procurando ${mapMsg.loading}…` : mapMsg.error)));
      }
      out.push(h('div', { class: 'toolbar' }, ...ps.map((p) => {
        const chip = h('button', { class: 'chip' + (c === p ? ' sel' : ''), title: p.address, onclick: () => { center = p; render(); } }, `${p.icon} ${p.name}`);
        chip.oncontextmenu = (e) => showCtx(e, [
          ['🧭 Traçar rota até aqui', () => openRoute({ to: p })],
          ['🗺 Abrir no Google Maps', () => window.open(gmapsRoute(null, p), '_blank')],
          ['🚙 Abrir no Waze', () => window.open(wazeTo(p), '_blank')],
          '-',
          ['🗑 Remover local', () => savePlaces(ps.filter((x) => x !== p)).then(render), 'danger'],
        ]);
        return chip;
      }), temp ? h('span', { class: 'chip sel' }, `🚦 ${temp.name}`) : '', addBtn), slot);
      const rs = routes().filter((r) => byId(r.to));
      if (rs.length) {
        out.push(h('div', { class: 'routes' }, ...rs.map((r) => {
          const from = r.from === 'here' ? null : byId(r.from);
          const to = byId(r.to);
          return h('div', { class: 'route' },
            h('span', { class: 'rt-name' }, `${MODES[r.mode]?.split(' ')[0] || '🚗'} ${r.name || `${from ? from.name : 'Aqui'} → ${to.name}`}`),
            h('button', { class: 'chip', title: 'Traçar aqui, no mapa da NeuroTab', onclick: () => openRoute({ from, to, mode: r.mode }) }, '🧭 Traçar'),
            h('a', { class: 'chip ext', href: gmapsRoute(from, to, r.mode), target: '_blank', title: 'Rota com trânsito no Google Maps (nova aba)' }, 'Google Maps ↗'),
            h('a', { class: 'chip ext', href: wazeTo(to), target: '_blank', title: 'Navegar no Waze (nova aba)' }, 'Waze ↗'));
        })));
      }
      if (c && hasCoordsOf(c)) {
        const src = `https://embed.waze.com/pt-BR/iframe?zoom=${zoom}&lat=${c.lat}&lon=${c.lon}&pin=1`;
        out.push(h('iframe', { class: 'map', src, title: 'Mapa de trânsito do Waze', loading: 'lazy', referrerpolicy: 'no-referrer-when-downgrade' }));
      } else {
        out.push(h('p', { class: 'muted' }, 'Adicione seus locais favoritos (casa, trabalho…) para ver o trânsito.'));
      }
      return out;
    }

    // ---------- Locais e rotas favoritos ----------
    function manageView() {
      let icon = '🏠';
      const name = h('input', { type: 'text', placeholder: 'Nome (ex.: Casa, Trabalho, Academia)' });
      const q = h('input', { type: 'text', placeholder: 'Endereço ou lugar (rua, número, cidade)' });
      const results = h('div', { class: 'items' });
      const icons = h('div', { class: 'toolbar' }, ...ICONS.map((ic) => h('button', { class: 'chip' + (ic === icon ? ' sel' : ''), type: 'button', onclick: (e) => { icon = ic; [...icons.children].forEach((b) => b.classList.toggle('sel', b === e.currentTarget)); } }, ic)));
      const find = async () => {
        if (!q.value.trim()) return q.focus();
        results.replaceChildren(h('p', { class: 'muted' }, 'Buscando endereço…'));
        try {
          const res = await searchAddress(q.value.trim(), nearRef());
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
        h('button', { class: 'chip', title: 'Traçar rota até aqui', onclick: () => openRoute({ to: p }) }, '🧭'),
        h('button', { class: 'chip danger', title: 'Remover', onclick: async () => { await savePlaces(places().filter((x) => x.id !== p.id)); await saveRoutes(routes().filter((r) => r.to !== p.id && r.from !== p.id)); render(); } }, '✕'))));

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
        h('div', { class: 'toolbar' }, h('b', {}, '⭐ Meus locais favoritos'), h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => { view = 'map'; render(); } }, '← Voltar ao mapa')),
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
        h('p', { class: 'muted small' }, 'Endereços e rotas traçadas aqui: OpenStreetMap. Mapa ao vivo e trânsito: Waze.'),
      ];
    }

    function render() {
      if (view !== 'route' && rmap) { rmap.destroy(); rmap = null; }
      if (view !== 'map') mapMsg = null;
      routeBtn.classList.toggle('sel', view === 'route');
      cfgBtn.classList.toggle('sel', view === 'manage');
      zoomIn.hidden = zoomOut.hidden = view !== 'map';
      body.dataset.view = view;
      body.replaceChildren(...(view === 'map' ? mapView() : view === 'route' ? routeView() : manageView()));
    }

    render();
    ctx.on('data', () => { if (view === 'map') render(); });
    const handle = (next) => (next.live ? liveAt(next.to) : openRoute(next));
    ctx.on('route.requested', (next) => { ctx.takeRoute?.(); handle(next); });
    const pending = ctx.takeRoute?.();
    if (pending) setTimeout(() => handle(pending), 0);
    return { destroy: () => { rmap?.destroy(); rmap = null; } };
  },
};
