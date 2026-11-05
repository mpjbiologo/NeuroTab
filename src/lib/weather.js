// NeuroTab — clima (Open-Meteo, gratuito e sem chave) e cidades/fusos.
import { h } from './ui.js';

export const WMO = {
  0: ['☀️', 'Céu limpo'], 1: ['🌤️', 'Poucas nuvens'], 2: ['⛅', 'Parcialmente nublado'], 3: ['☁️', 'Nublado'],
  45: ['🌫️', 'Neblina'], 48: ['🌫️', 'Neblina'], 51: ['🌦️', 'Garoa fraca'], 53: ['🌦️', 'Garoa'], 55: ['🌧️', 'Garoa forte'],
  56: ['🌧️', 'Garoa congelante'], 57: ['🌧️', 'Garoa congelante'], 61: ['🌦️', 'Chuva fraca'], 63: ['🌧️', 'Chuva'], 65: ['🌧️', 'Chuva forte'],
  66: ['🌧️', 'Chuva congelante'], 67: ['🌧️', 'Chuva congelante'], 71: ['🌨️', 'Neve fraca'], 73: ['🌨️', 'Neve'], 75: ['❄️', 'Neve forte'],
  77: ['🌨️', 'Granizo fino'], 80: ['🌦️', 'Pancadas fracas'], 81: ['🌧️', 'Pancadas de chuva'], 82: ['⛈️', 'Pancadas fortes'],
  85: ['🌨️', 'Neve'], 86: ['❄️', 'Neve forte'], 95: ['⛈️', 'Trovoadas'], 96: ['⛈️', 'Trovoadas com granizo'], 99: ['⛈️', 'Trovoadas com granizo'],
};

export function wxIcon(code, isDay = 1) {
  const ic = (WMO[code] || ['🌡️'])[0];
  if (isDay === 0 && code <= 1) return '🌙';
  if (isDay === 0 && code === 2) return '☁️';
  return ic;
}
export const wxDesc = (code) => (WMO[code] || ['', ''])[1];

const CACHE_PREFIX = 'nt_wx_';
const TTL = 30 * 60e3;

export async function getWeather(place, { force = false } = {}) {
  if (!place) return null;
  const key = CACHE_PREFIX + `${(+place.lat).toFixed(2)},${(+place.lon).toFixed(2)}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (!force && cached && Date.now() - cached.at < TTL) return cached.d;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5`;
    const d = await (await fetch(url)).json();
    if (!d.current) throw new Error('sem dados');
    await chrome.storage.local.set({ [key]: { at: Date.now(), d } });
    return d;
  } catch (e) {
    return cached?.d || null;
  }
}

export async function searchCities(q, lang = 'pt') {
  const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=${lang}&name=${encodeURIComponent(q)}`)).json();
  return (r.results || []).map((c) => ({
    id: `${c.id || c.latitude + ',' + c.longitude}`,
    name: c.name,
    region: [c.admin1, c.country_code].filter(Boolean).join(', '),
    country: c.country,
    lat: c.latitude,
    lon: c.longitude,
    tz: c.timezone || null,
  }));
}

/** Hora local de um lugar (fuso IANA). */
export function timeIn(tz, opts = { hour: '2-digit', minute: '2-digit' }) {
  try {
    return new Date().toLocaleTimeString('pt-BR', { ...opts, timeZone: tz || undefined });
  } catch {
    return new Date().toLocaleTimeString('pt-BR', opts);
  }
}

/** Diferença em horas entre o fuso do lugar e o local. Ex.: "+4h", "−3h", "" */
export function tzOffsetLabel(tz) {
  if (!tz) return '';
  try {
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US'));
    const there = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const diff = Math.round((there - local) / 36e5 * 2) / 2;
    if (!diff) return '';
    return (diff > 0 ? '+' : '−') + String(Math.abs(diff)).replace('.5', ',5') + 'h';
  } catch {
    return '';
  }
}

export function dayIn(tz) {
  try {
    const now = new Date();
    const a = new Date(now.toLocaleString('en-US', { timeZone: tz })).getDate();
    const b = now.getDate();
    return a === b ? '' : a > b || (b > 25 && a < 3) ? 'amanhã' : 'ontem';
  } catch {
    return '';
  }
}

/** Monta a previsão (agora + próximos dias) dentro de `el`. */
export function renderForecast(el, d, place, { days = 4 } = {}) {
  const cur = d.current;
  const dayCells = d.daily.time.slice(1, 1 + days).map((t, i) => {
    const k = i + 1;
    const wd = new Date(t + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return h('div', {}, wd, h('b', {}, wxIcon(d.daily.weather_code[k])), `${Math.round(d.daily.temperature_2m_max[k])}° / ${Math.round(d.daily.temperature_2m_min[k])}°`);
  });
  el.replaceChildren(
    h('div', { class: 'wx-now' },
      h('div', { class: 'wx-ic' }, wxIcon(cur.weather_code, cur.is_day)),
      h('div', {},
        h('div', { class: 'wx-t' }, `${Math.round(cur.temperature_2m)}°`),
        h('div', { class: 'wx-d' }, `${wxDesc(cur.weather_code)} · ${place.name}`),
        h('div', { class: 'wx-d' }, `Sensação ${Math.round(cur.apparent_temperature)}° · Umidade ${cur.relative_humidity_2m}% · Chuva hoje ${d.daily.precipitation_probability_max[0] ?? 0}%`))),
    h('div', { class: 'wx-days' }, ...dayCells),
  );
}
