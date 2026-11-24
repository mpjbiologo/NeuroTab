// Widget: clima detalhado da cidade principal (a mesma do relógio).
import { h } from '../lib/ui.js';
import { requestFeature } from '../lib/permissions.js';
import { getWeather, renderForecast, searchCities } from '../lib/weather.js';
import { uid } from '../lib/store.js';
import { getHgWeather, cityFromIp } from '../lib/datahub/hub.js';
import { MOON } from '../lib/datahub/sources.js';
import { getKeys } from '../lib/datahub/keys.js';
import { hasFeature } from '../lib/permissions.js';

function hgExtra(hg) {
  if (!hg) return null;
  const today = hg.days?.[0] || {};
  const parts = [today.rainProb != null ? `🌧️ Chuva hoje ${today.rainProb}%` : '', hg.sunrise ? `🌅 ${hg.sunrise}` : '', hg.sunset ? `🌇 ${hg.sunset}` : '', MOON[hg.moon] || ''].filter(Boolean);
  parts.push(`HG Brasil${hg.stale ? ' · desatualizado' : ''}`);
  return { parts, title: 'Dados extras da HG Brasil (com a sua chave)' };
}

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
      // 📍 Sugerir pela localização do IP (HG Brasil, com a chave da pessoa): só no clique, gasta 1 das 100 consultas do mês.
      const ipBtn = h('button', { class: 'btn sm', id: 'wxIp', hidden: true, title: 'Usa a sua chave da HG Brasil: 1 das 100 consultas grátis do mês.', onclick: async () => {
        ipBtn.disabled = true;
        list.replaceChildren(h('p', { class: 'muted' }, 'Procurando pela localização da sua internet…'));
        try {
          const c = await cityFromIp(ctx.settings);
          list.replaceChildren(h('p', { class: 'muted small' }, 'Pelo seu IP (pode ser a cidade do provedor):'), h('div', { class: 'item', onclick: async () => {
            const places = [...(ctx.settings.places || [])];
            places[0] = { id: places[0]?.id || uid(), name: c.name, region: [c.region, c.country].filter(Boolean).join(', '), country: c.country, lat: c.lat, lon: c.lon, tz: null };
            await ctx.saveSettings({ places });
            load();
          } }, h('span', { class: 'ic' }, '📍'), h('div', { class: 'body' }, h('div', { class: 'tt' }, c.name), h('div', { class: 'tx' }, [c.region, c.country].filter(Boolean).join(' · ')))));
        } catch (e) { list.replaceChildren(h('p', { class: 'muted' }, e.message || 'Não deu para descobrir a cidade.')); }
        ipBtn.disabled = false;
      } }, '📍 Sugerir pela minha internet');
      (async () => { ipBtn.hidden = !((await getKeys()).hg && (await hasFeature('hgbrasil').catch(() => false))); })();
      body.replaceChildren(h('p', { class: 'muted' }, msg || 'Escolha a cidade:'), h('div', { class: 'row-input' }, input, h('button', { class: 'btn', onclick: go }, 'Buscar')), ipBtn, list);
      input.focus();
    }

    async function load() {
      const place = ctx.settings.places?.[0];
      if (!place) return askCity('Defina sua cidade para ver o clima.');
      const d = await getWeather(place);
      // HG Brasil (opcional, com a chave da pessoa): chance de chuva, sol e lua.
      const hg = ctx.settings.datahub?.weather === 'hg' ? await getHgWeather(place, ctx.settings).catch(() => null) : null;
      if (!d && !hg) { body.replaceChildren(h('p', { class: 'muted' }, 'Não foi possível carregar o clima.')); return; }
      if (!d) {
        body.replaceChildren(h('div', { class: 'wx-now' }, h('div', {}, h('div', { class: 'wx-t' }, `${Math.round(hg.temp)}°`), h('div', { class: 'wx-d' }, `${hg.desc || ''} · ${place.name}`))), hgExtra(hg) && h('div', { class: 'wx-extra' }, ...hgExtra(hg).parts.map((x) => h('span', {}, x))));
        return;
      }
      renderForecast(body, d, place, { extra: hgExtra(hg) });
    }
    load();
    const off = ctx.on('data', () => load());
    const t = setInterval(load, 30 * 60e3);
    return { destroy: () => { clearInterval(t); off(); } };
  },
};
