// NeuroTab — locais e rotas salvos no widget de mapas (🚦 Trânsito), sem depender da tela (#43).
// Usado pelo widget, pelo cérebro (contexto da IA), pelo widget "Pergunte ao seu cérebro" e pela voz.
import { fold } from './brain.js';

// ---------- Links para os apps de mapa ----------
export function gmapsRoute(from, to, mode = 'driving') {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  if (from) u.searchParams.set('origin', `${from.lat},${from.lon}`);
  u.searchParams.set('destination', `${to.lat},${to.lon}`);
  u.searchParams.set('travelmode', mode);
  return u.toString();
}
export const wazeTo = (to) => `https://waze.com/ul?ll=${to.lat},${to.lon}&navigate=yes`;

// ---------- Distância ----------
/** Distância em linha reta (km) entre dois pontos { lat, lon } (fórmula de haversine). */
export function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatKm(km, lang = 'pt') {
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10} m`;
  const n = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${lang === 'en' ? String(n) : String(n).replace('.', ',')} km`;
}

export function formatMin(min, lang = 'pt') {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

// ---------- Entender a pergunta ----------
const KEYWORDS = /\b(rota|rotas|caminho|chegar|chego|distancia|longe|perto|tempo|demora|demoro|transito|endereco|onde fica|trajeto|trajetos|locais|lugares|route|routes|directions|distance|far|near|how long|traffic|address|where is|commute|places|locations|ruta|rutas|lejos|cerca|cuanto tarda|cuanto tiempo|trafico|direccion|donde queda|donde esta|lugares|llego|llegar)\b/;
const HOME = /^(casa|home|hogar|minha casa|mi casa)$/;

/** Lugares salvos citados no texto (pelo nome), do mais longo para o mais curto. */
export function placesIn(text, places = []) {
  const t = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
  return [...places]
    .filter((p) => p?.name)
    .map((p) => ({ p, n: fold(p.name).replace(/[^a-z0-9]+/g, ' ').trim() }))
    .filter(({ n }) => n && t.includes(` ${n} `))
    .sort((a, b) => b.n.length - a.n.length || t.indexOf(` ${a.n} `) - t.indexOf(` ${b.n} `))
    .map(({ p }) => p)
    .filter((p, i, arr) => arr.indexOf(p) === i);
}

/** A pergunta é sobre lugares/trajetos (e há locais salvos)? */
export function isPlacesQuestion(text, places = []) {
  if (!places.length) return false;
  return KEYWORDS.test(fold(text)) || placesIn(text, places).length > 0;
}

const homeOf = (places) => places.find((p) => HOME.test(fold(p.name).trim())) || null;

/** Origem e destino de uma pergunta: dois lugares citados, ou casa/rota salva → lugar citado. */
export function resolveTrip(text, places = [], routes = []) {
  const found = placesIn(text, places);
  if (!found.length) return null;
  if (found.length >= 2) {
    // "de A até B": a ordem no texto decide
    const t = fold(text);
    const [a, b] = found.slice(0, 2).sort((x, y) => t.indexOf(fold(x.name)) - t.indexOf(fold(y.name)));
    return { from: a, to: b, mode: 'driving' };
  }
  const to = found[0];
  const saved = routes.find((r) => r.to === to.id && places.some((p) => p.id === r.from));
  if (saved) return { from: places.find((p) => p.id === saved.from), to, mode: saved.mode || 'driving' };
  const home = homeOf(places);
  return { from: home && home !== to ? home : null, to, mode: 'driving' };
}

// ---------- Textos (pt / en / es) ----------
const TXT = {
  pt: {
    noPlaces: 'Você ainda não salvou locais no widget de mapas (🚦).',
    list: (ns) => `Seus locais salvos: ${ns}.`,
    routes: (rs) => `Suas rotas salvas: ${rs}.`,
    noRoutes: 'Você ainda não salvou rotas no widget de mapas.',
    address: (n, a) => `O endereço de ${n} é ${a}.`,
    noAddress: (n) => `Não tenho o endereço de ${n}, só a posição no mapa.`,
    distance: (a, b, d) => `Em linha reta, de ${a} até ${b} são ${d}.`,
    needFrom: (b) => `Salvo ${b}, mas não sei de onde você sai. Salve um local chamado "Casa" ou uma rota até ${b}.`,
    traffic: 'O tempo com trânsito agora você vê no Waze ou no Google Maps:',
    open: 'Abrir a rota:',
    street: (d, t) => `Pela rua: ${d}, cerca de ${t} (sem considerar o trânsito).`,
    modes: { driving: 'carro', walking: 'a pé', bicycling: 'bicicleta', transit: 'transporte' },
  },
  en: {
    noPlaces: 'You have not saved any places in the map widget (🚦) yet.',
    list: (ns) => `Your saved places: ${ns}.`,
    routes: (rs) => `Your saved routes: ${rs}.`,
    noRoutes: 'You have not saved any routes in the map widget yet.',
    address: (n, a) => `The address of ${n} is ${a}.`,
    noAddress: (n) => `I only have the map position of ${n}, not the address.`,
    distance: (a, b, d) => `In a straight line, from ${a} to ${b} it is ${d}.`,
    needFrom: (b) => `I have ${b} saved, but I don't know where you start. Save a place called "Home" or a route to ${b}.`,
    traffic: 'For the time with traffic right now, check Waze or Google Maps:',
    open: 'Open the route:',
    street: (d, t) => `By road: ${d}, about ${t} (not counting traffic).`,
    modes: { driving: 'car', walking: 'walking', bicycling: 'bike', transit: 'transit' },
  },
  es: {
    noPlaces: 'Todavía no guardaste lugares en el widget de mapas (🚦).',
    list: (ns) => `Tus lugares guardados: ${ns}.`,
    routes: (rs) => `Tus rutas guardadas: ${rs}.`,
    noRoutes: 'Todavía no guardaste rutas en el widget de mapas.',
    address: (n, a) => `La dirección de ${n} es ${a}.`,
    noAddress: (n) => `Solo tengo la ubicación de ${n} en el mapa, no la dirección.`,
    distance: (a, b, d) => `En línea recta, de ${a} a ${b} hay ${d}.`,
    needFrom: (b) => `Tengo ${b} guardado, pero no sé desde dónde sales. Guarda un lugar llamado "Casa" o una ruta hasta ${b}.`,
    traffic: 'El tiempo con tráfico ahora lo ves en Waze o Google Maps:',
    open: 'Abrir la ruta:',
    street: (d, t) => `Por la calle: ${d}, unos ${t} (sin contar el tráfico).`,
    modes: { driving: 'auto', walking: 'a pie', bicycling: 'bici', transit: 'transporte' },
  },
};
export const placesText = (lang) => TXT[lang] || TXT.pt;

const ASK_LIST = /\b(quais|meus|lista|listar|mostrar|what are|list|show|my|cuales|mis)\b.*\b(locais|lugares|places|locations)\b|\b(locais|lugares|places|locations)\b.*\b(salvos|saved|guardados)\b/;
const ASK_ROUTES = /\b(quais|minhas|lista|listar|mostrar|what are|list|show|my|cuales|mis)\b.*\b(rotas|routes|rutas)\b|\b(rotas|routes|rutas)\b.*\b(salvas|saved|guardadas)\b/;
const ASK_ADDRESS = /\b(endereco|address|direccion|onde fica|where is|donde queda|donde esta)\b/;
const ASK_DISTANCE = /\b(distancia|distance|longe|far|lejos|perto|near|cerca|km|quilometros|kilometers|kilometros)\b/;
const ASK_TIME = /\b(tempo|demora|demoro|quanto tempo|how long|time|cuanto tarda|cuanto tiempo|tarda|minutos|minutes)\b/;
const ASK_HOW = /\b(como chego|como chegar|caminho|rota|how do i get|how to get|directions|route|como llego|como llegar|ruta|trajeto|trajeto)\b/;

/**
 * Resposta sem IA para perguntas sobre locais e rotas (funciona sem chave).
 * Devolve { text, trip?, kind } ou null se não for uma pergunta que dá para responder assim.
 * `trip` = { from, to, mode } para mostrar os botões do Google Maps e do Waze.
 */
export function localAnswer(question, { mapPlaces: places = [], mapRoutes: routes = [] } = {}, lang = 'pt') {
  const T = placesText(lang);
  const q = fold(question);
  if (!KEYWORDS.test(q) && !placesIn(question, places).length) return null;
  if (ASK_ROUTES.test(q)) {
    const byId = (id) => places.find((p) => p.id === id);
    const rs = routes.filter((r) => byId(r.from) && byId(r.to)).map((r) => `${r.name || `${byId(r.from).name} → ${byId(r.to).name}`} (${T.modes[r.mode] || r.mode})`);
    return { kind: 'routes', text: rs.length ? T.routes(rs.join('; ')) : T.noRoutes };
  }
  if (ASK_LIST.test(q)) {
    if (!places.length) return { kind: 'list', text: T.noPlaces };
    return { kind: 'list', text: T.list(places.map((p) => `${p.icon || '📍'} ${p.name}`).join(', ')) };
  }
  if (!places.length) return null;
  const trip = resolveTrip(question, places, routes);
  if (!trip) return null;
  if (ASK_ADDRESS.test(q)) {
    return { kind: 'address', trip: { from: null, to: trip.to, mode: 'driving' }, text: trip.to.address ? T.address(trip.to.name, trip.to.address) : T.noAddress(trip.to.name) };
  }
  if (ASK_DISTANCE.test(q) || ASK_TIME.test(q) || ASK_HOW.test(q)) {
    if (!trip.from) return { kind: 'trip', trip, text: `${T.needFrom(trip.to.name)} ${T.open}` };
    const d = formatKm(haversineKm(trip.from, trip.to), lang);
    const lines = [T.distance(trip.from.name, trip.to.name, d)];
    lines.push(ASK_TIME.test(q) ? T.traffic : T.open);
    return { kind: ASK_TIME.test(q) ? 'time' : 'trip', trip, text: lines.join(' ') };
  }
  return null;
}

/**
 * Trecho para o contexto da IA, só quando a pergunta é sobre lugares (e a pessoa permite
 * enviar os endereços à IA: settings.ai.sharePlaces !== false).
 */
export function placesContext(settings, question) {
  const places = settings?.mapPlaces || [];
  const routes = settings?.mapRoutes || [];
  if (settings?.ai?.sharePlaces === false || !isPlacesQuestion(question, places)) return null;
  const byId = (id) => places.find((p) => p.id === id);
  const lines = places.map((p) => `- ${p.icon || '📍'} ${p.name}${p.address ? ` — ${p.address}` : ''} (lat ${(+p.lat).toFixed(5)}, lon ${(+p.lon).toFixed(5)})`);
  const rs = routes.filter((r) => byId(r.from) && byId(r.to)).map((r) => {
    const a = byId(r.from); const b = byId(r.to);
    return `- ${r.name || `${a.name} → ${b.name}`}: de ${a.name} para ${b.name}, modo ${r.mode || 'driving'}, ${formatKm(haversineKm(a, b))} em linha reta`;
  });
  return {
    title: 'LOCAIS E ROTAS SALVOS NO WIDGET DE MAPAS',
    note: 'Distâncias aqui são em linha reta; você não sabe o trânsito agora. Para trânsito ao vivo, sugira abrir no Waze ou no Google Maps. Diga que usou os locais salvos.',
    text: [`Locais:\n${lines.join('\n')}`, rs.length ? `Rotas favoritas:\n${rs.join('\n')}` : ''].filter(Boolean).join('\n\n'),
  };
}

// ---------- Distância e tempo pela rua (OpenStreetMap / OSRM, sem trânsito) ----------
export const ROUTER_ORIGIN = 'https://routing.openstreetmap.de';
const PROFILES = { driving: ['routed-car', 'driving'], walking: ['routed-foot', 'foot'], bicycling: ['routed-bike', 'bike'] };

/** Distância e tempo pela rua (sem trânsito). Precisa de acesso a ROUTER_ORIGIN. Devolve { km, min } ou null. */
export async function streetEstimate(from, to, mode = 'driving', fetchFn = fetch) {
  const p = PROFILES[mode] || PROFILES.driving;
  const url = `${ROUTER_ORIGIN}/${p[0]}/route/v1/${p[1]}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const r = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const j = await r.json();
  const route = j?.routes?.[0];
  if (j?.code !== 'Ok' || !route) return null;
  return { km: route.distance / 1000, min: route.duration / 60 };
}
