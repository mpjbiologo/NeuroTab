// NeuroTab — Relógio, saudação, clima e outras cidades junto do relógio.
import { saveData, uid } from '../lib/store.js';
import { $, $$, h, toast, showCtx } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { requestFeature } from '../lib/permissions.js';
import { getWeather, searchCities, wxIcon, wxDesc, timeIn, tzOffsetLabel, dayIn, renderForecast } from '../lib/weather.js';
import { S } from './state.js';
import { ctx } from './context.js';

export function setupClock() {
  const tick = () => {
    const d = new Date();
    $('#clock').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const hr = d.getHours();
    const hello = t(hr < 5 ? 'Boa madrugada' : hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite');
    const name = S.data.settings.userName ? `, ${S.data.settings.userName}` : '';
    $('#greet').textContent = `${hello}${name} · ${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
    $$('#places .pl-time').forEach((el) => { el.textContent = timeIn(el.dataset.tz); });
  };
  tick();
  setInterval(tick, 10_000);
  renderHeroWeather();
  setInterval(renderHeroWeather, 30 * 60e3);
  ctx.on('data', () => renderHeroWeather());
  document.addEventListener('click', (e) => { if (!e.target.closest('#wxPop, .wx-pill, .pl-chip, #placeAdd')) $('#wxPop').hidden = true; });
}

// ---------- Clima e outras cidades junto do relógio ----------
let heroSig = '';
async function renderHeroWeather() {
  const s = S.data.settings;
  const places = s.places || [];
  const sig = JSON.stringify([places, s.heroWeather, s.heroPlaces]);
  const pill = $('#heroWx');
  const box = $('#places');
  if (sig === heroSig && renderHeroWeather.at && Date.now() - renderHeroWeather.at < 25 * 60e3) return;
  heroSig = sig;
  renderHeroWeather.at = Date.now();

  // Cidade principal
  const main = places[0];
  pill.hidden = !s.heroWeather;
  if (s.heroWeather) {
    if (!main) {
      pill.replaceChildren(h('span', {}, '📍'), h('span', {}, 'Definir cidade'));
      pill.onclick = (e) => { e.stopPropagation(); openPlacePicker(pill, true); };
    } else {
      pill.replaceChildren(h('span', {}, '…'), h('span', {}, main.name));
      pill.onclick = (e) => { e.stopPropagation(); toggleForecast(pill, main); };
      getWeather(main).then((d) => {
        if (!d) return;
        if (!main.tz && d.timezone) savePlaceTz(0, d.timezone);
        pill.replaceChildren(h('span', { class: 'wi' }, wxIcon(d.current.weather_code, d.current.is_day)), h('b', {}, `${Math.round(d.current.temperature_2m)}°`), h('span', {}, main.name));
        pill.title = `${wxDesc(d.current.weather_code)} · máx ${Math.round(d.daily.temperature_2m_max[0])}° / mín ${Math.round(d.daily.temperature_2m_min[0])}° — clique para a previsão`;
      });
    }
  }

  // Outras cidades / fusos
  box.replaceChildren();
  box.hidden = !s.heroPlaces;
  if (!s.heroPlaces) return;
  places.slice(1).forEach((p, i) => {
    const idx = i + 1;
    const chip = h('button', { class: 'pl-chip', title: `${p.name}${p.region ? ' · ' + p.region : ''} — clique para a previsão` },
      h('span', { class: 'pl-name' }, p.name),
      h('span', { class: 'pl-time', 'data-tz': p.tz || '' }, timeIn(p.tz)),
      h('span', { class: 'pl-off' }, [tzOffsetLabel(p.tz), dayIn(p.tz)].filter(Boolean).join(' ')),
      h('span', { class: 'pl-wx' }, ''));
    chip.onclick = (e) => { e.stopPropagation(); toggleForecast(chip, p); };
    chip.oncontextmenu = (e) => showCtx(e, [
      ['⭐ Tornar cidade principal', () => movePlace(idx, 0)],
      ['◀ Mover para a esquerda', () => movePlace(idx, Math.max(1, idx - 1))],
      '-',
      ['🗑 Remover', () => removePlace(idx), 'danger'],
    ]);
    box.append(chip);
    getWeather(p).then((d) => {
      if (!d) return;
      if (!p.tz && d.timezone) savePlaceTz(idx, d.timezone);
      chip.querySelector('.pl-wx').textContent = `${wxIcon(d.current.weather_code, d.current.is_day)} ${Math.round(d.current.temperature_2m)}°`;
    });
  });
  const add = h('button', { id: 'placeAdd', class: 'pl-chip pl-add', title: 'Adicionar cidade / fuso horário' }, '＋ cidade');
  add.onclick = (e) => { e.stopPropagation(); openPlacePicker(add, !main); };
  box.append(add);
}

async function savePlaceTz(idx, tz) {
  const p = S.data.settings.places[idx];
  if (!p || p.tz) return;
  p.tz = tz;
  await saveData(S.data);
}

async function movePlace(from, to) {
  const arr = S.data.settings.places;
  const [p] = arr.splice(from, 1);
  arr.splice(to, 0, p);
  heroSig = '';
  await saveData(S.data);
  renderHeroWeather();
}

async function removePlace(idx) {
  S.data.settings.places.splice(idx, 1);
  heroSig = '';
  await saveData(S.data);
  renderHeroWeather();
}

function popAt(anchor) {
  const pop = $('#wxPop');
  const hero = $('#hero');
  const r = anchor.getBoundingClientRect();
  const hr = hero.getBoundingClientRect();
  pop.style.left = Math.max(0, Math.min(r.left - hr.left + r.width / 2 - 170, hr.width - 340)) + 'px';
  pop.style.top = (r.bottom - hr.top + 8) + 'px';
  pop.hidden = false;
  return pop;
}

async function toggleForecast(anchor, place) {
  const pop = $('#wxPop');
  if (!pop.hidden && pop.dataset.for === place.id) { pop.hidden = true; return; }
  pop.dataset.for = place.id;
  popAt(anchor).replaceChildren(h('p', { class: 'muted' }, 'Carregando…'));
  const d = await getWeather(place);
  if (!d) { pop.replaceChildren(h('p', { class: 'muted' }, 'Clima indisponível.')); return; }
  const body = h('div');
  renderForecast(body, d, place);
  pop.replaceChildren(
    h('div', { class: 'pop-head' }, h('b', {}, place.name), h('span', { class: 'muted' }, [place.region, place.tz && `${timeIn(place.tz)} ${tzOffsetLabel(place.tz)}`].filter(Boolean).join(' · ')),
      h('button', { class: 'icon-btn', title: 'Trocar cidade', onclick: (e) => { e.stopPropagation(); openPlacePicker(anchor, place === S.data.settings.places[0], place.id); } }, '📍')),
    body);
}

function openPlacePicker(anchor, asMain, replaceId) {
  const pop = $('#wxPop');
  pop.dataset.for = '';
  const input = h('input', { type: 'text', placeholder: 'Cidade (ex.: Lisboa, Tóquio, Nova York)' });
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
      list.replaceChildren(...res.map((c) => h('div', { class: 'item', onclick: async (e) => {
        e.stopPropagation();
        const arr = S.data.settings.places || (S.data.settings.places = []);
        const place = { ...c, id: uid() };
        const at = replaceId ? arr.findIndex((p) => p.id === replaceId) : -1;
        if (at >= 0) arr[at] = place;
        else if (asMain) arr.unshift(place);
        else arr.push(place);
        heroSig = '';
        pop.hidden = true;
        await saveData(S.data);
        renderHeroWeather();
        toast(`${c.name} adicionada`);
      } }, h('span', { class: 'ic' }, '📍'), h('div', { class: 'body' }, h('div', { class: 'tt' }, c.name), h('div', { class: 'tx' }, [c.region, c.country, c.tz].filter(Boolean).join(' · '))))));
      if (!res.length) list.replaceChildren(h('p', { class: 'muted' }, 'Nada encontrado.'));
    } catch {
      list.replaceChildren(h('p', { class: 'muted' }, 'Sem conexão.'));
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  popAt(anchor).replaceChildren(
    h('div', { class: 'pop-head' }, h('b', {}, asMain ? 'Sua cidade' : 'Adicionar cidade / fuso')),
    h('div', { class: 'row-input' }, input, h('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); go(); } }, 'Buscar')),
    list);
  pop.onclick = (e) => e.stopPropagation();
  input.focus();
}
