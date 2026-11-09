// Widget: clima detalhado da cidade principal (a mesma do relógio).
import { h } from '../lib/ui.js';
import { requestFeature } from '../lib/permissions.js';
import { getWeather, renderForecast, searchCities } from '../lib/weather.js';
import { uid } from '../lib/store.js';

export default {
  id: 'weather',
  title: 'Clima',
  icon: '🌤️',
  description: 'Previsão detalhada da sua cidade principal (o relógio já mostra o clima resumido).',
  defaultW: 4,
  mount(el, ctx) {
    const body = h('div');
    ctx.actions.append(h('button', { title: 'Trocar cidade', onclick: () => askCity() }, '📍'));
    el.append(body);

    function askCity(msg) {
      const input = h('input', { type: 'text', placeholder: 'Sua cidade (ex.: Itaúna)', value: ctx.settings.places?.[0]?.name || '' });
      const list = h('div', { class: 'items' });
      const go = async () => {
        const q = input.value.trim();
    // Firefox: pede o consentimento de localização aqui, no clique (no Chrome/Edge não aparece nada).
    const allowed = q ? await requestFeature('weather') : false;
        if (!q) return;
    if (!allowed) { list.replaceChildren(h('p', { class: 'muted' }, 'Sem permissão para enviar a localização ao serviço de clima.')); return; }
        list.replaceChildren(h('p', { class: 'muted' }, 'Buscando…'));
        try {
          const res = await searchCities(q);
          list.replaceChildren(...res.map((c) => h('div', { class: 'item', onclick: async () => {
            const places = [...(ctx.settings.places || [])];
            places[0] = { ...c, id: places[0]?.id || uid() };
            await ctx.saveSettings({ places });
            load();
          } }, h('span', { class: 'ic' }, '📍'), h('div', { class: 'body' }, h('div', { class: 'tt' }, c.name), h('div', { class: 'tx' }, [c.region, c.country].filter(Boolean).join(' · '))))));
          if (!res.length) list.replaceChildren(h('p', { class: 'muted' }, 'Cidade não encontrada.'));
        } catch {
          list.replaceChildren(h('p', { class: 'muted' }, 'Sem conexão.'));
        }
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      body.replaceChildren(h('p', { class: 'muted' }, msg || 'Escolha a cidade:'), h('div', { class: 'row-input' }, input, h('button', { class: 'btn', onclick: go }, 'Buscar')), list);
      input.focus();
    }

    async function load() {
      const place = ctx.settings.places?.[0];
      if (!place) return askCity('Defina sua cidade para ver o clima.');
      const d = await getWeather(place);
      if (!d) { body.replaceChildren(h('p', { class: 'muted' }, 'Não foi possível carregar o clima.')); return; }
      renderForecast(body, d, place);
    }
    load();
    const off = ctx.on('data', () => load());
    const t = setInterval(load, 30 * 60e3);
    return { destroy: () => { clearInterval(t); off(); } };
  },
};
