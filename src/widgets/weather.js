// Widget: clima (Open-Meteo, gratuito e sem chave).
import { h } from '../lib/ui.js';

const WMO = {
  0: ['☀️', 'Céu limpo'], 1: ['🌤️', 'Poucas nuvens'], 2: ['⛅', 'Parcialmente nublado'], 3: ['☁️', 'Nublado'],
  45: ['🌫️', 'Neblina'], 48: ['🌫️', 'Neblina'], 51: ['🌦️', 'Garoa fraca'], 53: ['🌦️', 'Garoa'], 55: ['🌧️', 'Garoa forte'],
  56: ['🌧️', 'Garoa congelante'], 57: ['🌧️', 'Garoa congelante'], 61: ['🌦️', 'Chuva fraca'], 63: ['🌧️', 'Chuva'], 65: ['🌧️', 'Chuva forte'],
  66: ['🌧️', 'Chuva congelante'], 67: ['🌧️', 'Chuva congelante'], 71: ['🌨️', 'Neve fraca'], 73: ['🌨️', 'Neve'], 75: ['❄️', 'Neve forte'],
  77: ['🌨️', 'Granizo fino'], 80: ['🌦️', 'Pancadas fracas'], 81: ['🌧️', 'Pancadas de chuva'], 82: ['⛈️', 'Pancadas fortes'],
  85: ['🌨️', 'Neve'], 86: ['❄️', 'Neve forte'], 95: ['⛈️', 'Trovoadas'], 96: ['⛈️', 'Trovoadas com granizo'], 99: ['⛈️', 'Trovoadas com granizo'],
};
const CACHE = 'nt_cache_weather';

export default {
  id: 'weather',
  title: 'Clima',
  icon: '🌤️',
  description: 'Tempo agora e nos próximos dias para a sua cidade.',
  defaultSize: 's',
  mount(el, ctx) {
    const body = h('div');
    ctx.actions.append(h('button', { title: 'Trocar cidade', onclick: () => askCity() }, '📍'));
    el.append(body);

    function askCity(msg) {
      const input = h('input', { type: 'text', placeholder: 'Sua cidade (ex.: Itaúna)', value: ctx.settings.weather?.name || '' });
      const list = h('div', { class: 'items' });
      const go = async () => {
        const q = input.value.trim();
        if (!q) return;
        list.replaceChildren(h('p', { class: 'muted' }, 'Buscando…'));
        try {
          const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=pt&name=${encodeURIComponent(q)}`)).json();
          list.replaceChildren(...(r.results || []).map((c) => h('div', { class: 'item', onclick: async () => {
            await ctx.saveSettings({ weather: { name: c.name, lat: c.latitude, lon: c.longitude, region: [c.admin1, c.country_code].filter(Boolean).join(', ') } });
            await chrome.storage.local.remove(CACHE);
            load();
          } }, h('span', { class: 'ic' }, '📍'), h('div', { class: 'body' }, h('div', { class: 'tt' }, c.name), h('div', { class: 'tx' }, [c.admin1, c.country].filter(Boolean).join(', '))))));
          if (!r.results?.length) list.replaceChildren(h('p', { class: 'muted' }, 'Cidade não encontrada.'));
        } catch {
          list.replaceChildren(h('p', { class: 'muted' }, 'Sem conexão.'));
        }
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      body.replaceChildren(h('p', { class: 'muted' }, msg || 'Escolha a cidade:'), h('div', { class: 'row-input' }, input, h('button', { class: 'btn', onclick: go }, 'Buscar')), list);
      input.focus();
    }

    async function load() {
      const w = ctx.settings.weather;
      if (!w) return askCity('Defina sua cidade para ver o clima.');
      const key = `${w.lat},${w.lon}`;
      let c = (await chrome.storage.local.get(CACHE))[CACHE];
      if (!c || c.key !== key || Date.now() - c.at > 30 * 60e3) {
        try {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5`;
          c = { key, at: Date.now(), d: await (await fetch(url)).json() };
          await chrome.storage.local.set({ [CACHE]: c });
        } catch {
          if (!c) { body.replaceChildren(h('p', { class: 'muted' }, 'Não foi possível carregar o clima.')); return; }
        }
      }
      const d = c.d;
      const [ic, desc] = WMO[d.current.weather_code] || ['🌡️', ''];
      const icon = d.current.is_day === 0 && d.current.weather_code <= 1 ? '🌙' : ic;
      const days = d.daily.time.slice(1, 5).map((t, i) => {
        const k = i + 1;
        const wd = new Date(t + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        return h('div', {}, wd, h('b', {}, (WMO[d.daily.weather_code[k]] || ['🌡️'])[0]), `${Math.round(d.daily.temperature_2m_max[k])}° / ${Math.round(d.daily.temperature_2m_min[k])}°`);
      });
      body.replaceChildren(
        h('div', { class: 'wx-now' },
          h('div', { class: 'wx-ic' }, icon),
          h('div', {},
            h('div', { class: 'wx-t' }, `${Math.round(d.current.temperature_2m)}°`),
            h('div', { class: 'wx-d' }, `${desc} · ${w.name}`),
            h('div', { class: 'wx-d' }, `Sensação ${Math.round(d.current.apparent_temperature)}° · Umidade ${d.current.relative_humidity_2m}% · Chuva hoje ${d.daily.precipitation_probability_max[0] ?? 0}%`))),
        h('div', { class: 'wx-days' }, ...days),
      );
    }
    load();
    const t = setInterval(load, 30 * 60e3);
    return { destroy: () => clearInterval(t) };
  },
};
