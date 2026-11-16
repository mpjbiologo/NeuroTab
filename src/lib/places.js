// NeuroTab — locais e rotas salvos no widget de mapas (🚦 Trânsito), sem depender da tela (#43).
// Usado pelo widget, pelo cérebro (contexto da IA), pelo widget "Pergunte ao seu cérebro" e pela voz.
import { fold } from './brain.js';

// ---------- Links para os apps de mapa ----------
export function gmapsRoute(from, to, mode = 'driving') {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  if (from) u.searchParams.set('origin', where(from));
  u.searchParams.set('destination', where(to));
  u.searchParams.set('travelmode', mode);
  return u.toString();
}
export const wazeTo = (to) => (hasCoords(to)
  ? `https://waze.com/ul?ll=${to.lat},${to.lon}&navigate=yes`
  : `https://waze.com/ul?q=${encodeURIComponent(to.query || to.name)}&navigate=yes`);

/** Lugar salvo tem coordenadas; destino falado/escrito ("Praça da Liberdade") vai como texto. */
const hasCoords = (p) => p && p.lat !== undefined && p.lat !== null && Number.isFinite(+p.lat) && Number.isFinite(+p.lon);
const where = (p) => (hasCoords(p) ? `${p.lat},${p.lon}` : (p.query || p.name));

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
// Tira acentos letra a letra, mantendo as posições, para recortar o destino do texto original ("Praça", não "Praca").
const deaccent = (s) => [...String(s || '').normalize('NFC')].map((c) => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '') || ' ').join('');
// Pedido explícito de trajeto, no começo da frase: "traçar rota para X", "rota até X", "como chego no X",
// "me leva para X", "route to X", "trazar ruta a X". Ancorado no início para não pegar "a melhor rota para emagrecer".
const ROUTE_ASK = new RegExp(
  '^(?:(?:por favor|pode|voce pode|consegue|can you|please|puedes|podes)\\s+)?(?:me\\s+)?'
  + '(?:(?:qual(?: e)?|what is|whats|cual es|tracar|traca|trace|tracca|fazer|faca|faz|abrir|abra|abre|mostrar|mostra|mostre|criar|cria|crie|gerar|gere|da|de|dar|quero|calcular|calcule|calcula|plot|draw|make|show|open|get|give me|find|trazar|traza|traceme|hacer|haz|abrir|muestra|muestrame|dame|calcula)\\s+)?'
  + '(?:(?:a|uma|um|o|the|a|la|una|el|me a)\\s+)?(?:(?:melhor|best|mejor)\\s+)?'
  + '(?:rota|caminho|mapa|map|trajeto|percurso|route|directions|ruta|camino|recorrido|como (?:eu )?(?:chego|chegar|faco para chegar|vou)|how (?:do i|to|can i) get|como (?:llego|llegar|voy)|(?:me )?(?:leva|leve|levar)|take me|navegar|navega|navigate|llevame|ir)'
  + '(?:\\s+(?:de|from|desde)\\s+(.+?))?'
  + '\\s+(?:para|pra|pro|ate|ao|a|aos|na|no|em|to|hasta|hacia|al|para el|para la)\\s+(?:o |a |os |as |the |el |la |los |las )?(.+?)[\\s?.!]*$',
  'i',
);

/** Pedido de rota com destino em texto livre: { from?, target } ou null. */
export function routeTarget(text) {
  const full = [...String(text || '').normalize('NFC')].join('').trim();
  // "Verônica, traça a rota…": o chamado antes da vírgula não faz parte do pedido.
  const voc = /^[^,]{1,30},\s*(.+)$/.exec(full);
  return matchRoute(full) || (voc ? matchRoute(voc[1]) : null);
}

/** Pedido de rota sem destino ("traçar rota", "me leva"): pergunte para onde. */
const ROUTE_BARE = /^(?:(?:por favor|pode|voce pode|consegue|can you|please|puedes)\s+)?(?:me\s+)?(?:(?:tracar|traca|trace|fazer|faca|faz|abrir|abra|abre|mostrar|mostra|mostre|criar|cria|crie|make|show|open|trazar|traza|hacer|haz|muestra)\s+)?(?:(?:a|uma|um|o|the|una|la|el)\s+)?(?:rota|trajeto|percurso|route|directions|ruta|recorrido)[\s?.!]*$/;
export const isBareRouteAsk = (text) => {
  const t = fold(text).trim();
  const voc = /^[^,]{1,30},\s*(.+)$/.exec(t);
  return ROUTE_BARE.test(t) || (!!voc && ROUTE_BARE.test(voc[1]));
};

function matchRoute(orig) {
  const flat = deaccent(orig);
  const m = new RegExp(ROUTE_ASK.source, 'id').exec(flat);
  if (!m) return null;
  const cut = (i) => (m[i] ? orig.slice(m.indices[i][0], m.indices[i][1]).trim() : null);
  const target = cut(2);
  if (!target || /^(salvas|saved|guardadas|favoritas)$/i.test(m[2].trim())) return null;
  // "a melhor rota para emagrecer": destino que começa com verbo no infinitivo não é lugar.
  if (/^[a-z]{4,}(ar|er|ir)$/i.test(m[2].trim().split(/\s+/)[0]) && !/^[A-Z]/.test(target)) return null;
  return { from: cut(1), target };
}

const KEYWORDS = /\b(rota|rotas|caminho|chegar|chego|distancia|longe|perto|tempo|demora|demoro|transito|endereco|onde fica|trajeto|trajetos|percurso|leva|navegar|navigate|take me|locais|lugares|route|routes|directions|distance|far|near|how long|traffic|address|where is|commute|places|locations|ruta|rutas|lejos|cerca|cuanto tarda|cuanto tiempo|trafico|direccion|donde queda|donde esta|lugares|llego|llegar)\b/;
const ROUTE_WORDS = /\b(rota|rotas|trajeto|percurso|caminho|mapa|maps|navegar|route|directions|navigate|map|ruta|mapa|recorrido)\b/;
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

/** Trajeto de um pedido explícito: destino e origem pelo texto; sem origem, a rota salva ou "Casa". */
function askTrip(ask, places, routes) {
  const pick = (txt) => {
    const f = fold(txt).trim();
    const hit = placesIn(txt, places)[0];
    // Só usa o local salvo se o texto é o nome dele (com ou sem artigo), não "centro perto de casa".
    return hit && fold(hit.name).trim() === f.replace(/^(o|a|os|as|the|el|la|meu|minha|my|mi)\s+/, '') ? hit : { name: txt, query: txt };
  };
  const to = pick(ask.target);
  let from = ask.from ? pick(ask.from) : null;
  let mode = 'driving';
  if (!from && to.id) {
    const saved = routes.find((r) => r.to === to.id && places.some((p) => p.id === r.from));
    if (saved) { from = places.find((p) => p.id === saved.from); mode = saved.mode || 'driving'; }
  }
  if (!from) { const home = homeOf(places); if (home && home !== to) from = home; }
  return { from, to, mode };
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
    routeTo: (b, a) => `Rota até ${b}${a ? ` saindo de ${a}` : ', saindo de onde você estiver'}:`,
    where: 'Para onde? Diga, por exemplo: "rota para o centro" ou "rota de casa até o trabalho".',
    opening: (b) => `Abrindo a rota para ${b}.`,
    showing: (b) => `🧭 Rota até ${b} no widget Trânsito.`,
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
    routeTo: (b, a) => `Route to ${b}${a ? ` from ${a}` : ', from wherever you are'}:`,
    where: 'Where to? Say, for example: "route to downtown" or "route from home to work".',
    opening: (b) => `Opening the route to ${b}.`,
    showing: (b) => `🧭 Route to ${b} in the Traffic widget.`,
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
    routeTo: (b, a) => `Ruta hasta ${b}${a ? ` desde ${a}` : ', desde donde estés'}:`,
    where: '¿A dónde? Di, por ejemplo: "ruta al centro" o "ruta de casa al trabajo".',
    opening: (b) => `Abriendo la ruta a ${b}.`,
    showing: (b) => `🧭 Ruta hasta ${b} en el widget Tráfico.`,
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
  const ask = routeTarget(question);
  if (!ask && isBareRouteAsk(question)) return { kind: 'route-where', text: T.where };
  if (!ask && !KEYWORDS.test(q) && !placesIn(question, places).length) return null;
  if (ASK_ROUTES.test(q)) {
    const byId = (id) => places.find((p) => p.id === id);
    const rs = routes.filter((r) => byId(r.from) && byId(r.to)).map((r) => `${r.name || `${byId(r.from).name} → ${byId(r.to).name}`} (${T.modes[r.mode] || r.mode})`);
    return { kind: 'routes', text: rs.length ? T.routes(rs.join('; ')) : T.noRoutes };
  }
  if (ASK_LIST.test(q)) {
    if (!places.length) return { kind: 'list', text: T.noPlaces };
    return { kind: 'list', text: T.list(places.map((p) => `${p.icon || '📍'} ${p.name}`).join(', ')) };
  }
  // Pedido explícito de rota ("traçar rota para X"): o destino é o que vem depois de "para",
  // seja um local salvo ou um nome livre, que o mapa procura (#43).
  const trip = ask ? askTrip(ask, places, routes) : places.length ? resolveTrip(question, places, routes) : null;
  if (!trip) return null;
  if (ask && !(hasCoords(trip.from) && hasCoords(trip.to) && (ASK_DISTANCE.test(q) || ASK_TIME.test(q)))) {
    return { kind: 'route', trip, text: T.routeTo(trip.to.name, trip.from?.name) };
  }
  if (ASK_ADDRESS.test(q)) {
    return { kind: 'address', trip: { from: null, to: trip.to, mode: 'driving' }, text: trip.to.address ? T.address(trip.to.name, trip.to.address) : T.noAddress(trip.to.name) };
  }
  if (ASK_DISTANCE.test(q) || ASK_TIME.test(q) || ASK_HOW.test(q)) {
    if (!trip.from) return { kind: 'trip', trip, text: `${T.needFrom(trip.to.name)} ${T.open}` };
    const d = formatKm(haversineKm(trip.from, trip.to), lang);
    const lines = [T.distance(trip.from.name, trip.to.name, d)];
    lines.push(ASK_TIME.test(q) ? T.traffic : T.open);
    return { kind: ASK_TIME.test(q) ? 'time' : ask ? 'route' : 'trip', trip, text: lines.join(' ') };
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
  const NEVER = 'A NeuroTab traça rotas no widget Trânsito e abre no Google Maps e no Waze: nunca diga que não consegue traçar rotas ou abrir mapas. Para um trajeto, peça que a pessoa diga "rota para" e o destino.';
  if (!places.length && ROUTE_WORDS.test(fold(question))) return { title: 'ROTAS E MAPAS', note: NEVER, text: 'Nenhum local salvo no widget de mapas.' };
  if (settings?.ai?.sharePlaces === false || !isPlacesQuestion(question, places)) return null;
  const byId = (id) => places.find((p) => p.id === id);
  const lines = places.map((p) => `- ${p.icon || '📍'} ${p.name}${p.address ? ` — ${p.address}` : ''} (lat ${(+p.lat).toFixed(5)}, lon ${(+p.lon).toFixed(5)})`);
  const rs = routes.filter((r) => byId(r.from) && byId(r.to)).map((r) => {
    const a = byId(r.from); const b = byId(r.to);
    return `- ${r.name || `${a.name} → ${b.name}`}: de ${a.name} para ${b.name}, modo ${r.mode || 'driving'}, ${formatKm(haversineKm(a, b))} em linha reta`;
  });
  return {
    title: 'LOCAIS E ROTAS SALVOS NO WIDGET DE MAPAS',
    note: 'Distâncias aqui são em linha reta; você não sabe o trânsito agora. A NeuroTab traça a rota no widget Trânsito (e tem botões para o Google Maps e o Waze): nunca diga que não consegue traçar rotas; diga que a rota está no widget Trânsito e nos botões abaixo. Diga que usou os locais salvos.',
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

/**
 * Trajeto completo pela rua (sem trânsito): distância, tempo, a linha [[lon,lat]…] para desenhar no mapa
 * e o passo a passo. Devolve null se não houver rota.
 */
export async function streetRoute(from, to, mode = 'driving', fetchFn = fetch) {
  const p = PROFILES[mode] || PROFILES.driving;
  const url = `${ROUTER_ORIGIN}/${p[0]}/route/v1/${p[1]}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const r = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const j = await r.json();
  const route = j?.routes?.[0];
  if (j?.code !== 'Ok' || !route) return null;
  const steps = (route.legs || []).flatMap((l) => l.steps || []).map((st) => ({
    type: st.maneuver?.type || '', modifier: st.maneuver?.modifier || '', name: st.name || '', km: (st.distance || 0) / 1000,
  }));
  return { km: route.distance / 1000, min: route.duration / 60, coords: route.geometry?.coordinates || [], steps };
}

// ---------- Endereço → coordenadas (OpenStreetMap Nominatim) ----------
export const GEOCODER_ORIGIN = 'https://nominatim.openstreetmap.org';

/**
 * Procura um lugar pelo nome/endereço, de preferência perto de `near` ({lat, lon}). Devolve a lista
 * [{ name, address, lat, lon }]. Precisa de acesso a GEOCODER_ORIGIN.
 */
export async function geocode(q, { near = null, limit = 1, lang = 'pt-BR', fetchFn = fetch } = {}) {
  const u = new URL(`${GEOCODER_ORIGIN}/search`);
  u.search = new URLSearchParams({ format: 'jsonv2', limit: String(limit), addressdetails: '0', 'accept-language': lang, q: String(q || '').trim() }).toString();
  if (near && Number.isFinite(+near.lat) && Number.isFinite(+near.lon)) {
    const d = 0.6; // ~60 km em volta: "shopping" acha o da cidade da pessoa, sem impedir outra cidade
    u.searchParams.set('viewbox', [+near.lon - d, +near.lat + d, +near.lon + d, +near.lat - d].join(','));
  }
  const r = await fetchFn(u.href, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const list = await r.json();
  return (Array.isArray(list) ? list : []).map((x) => ({
    name: x.name || String(x.display_name || '').split(',')[0], address: x.display_name || '', lat: +x.lat, lon: +x.lon,
  })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

export const hasCoordsOf = (p) => !!p && Number.isFinite(+p.lat) && Number.isFinite(+p.lon) && p.lat !== '' && p.lon !== '';

// ---------- Passo a passo em texto ----------
const STEP_WORDS = {
  pt: {
    depart: 'Saia', arrive: 'Chegada', roundabout: 'Na rotatória, saia', continue: 'Siga', turn: 'Vire', merge: 'Entre', fork: 'Mantenha-se', ramp: 'Pegue a saída', end: 'No fim da via, vire',
    left: 'à esquerda', right: 'à direita', 'slight left': 'levemente à esquerda', 'slight right': 'levemente à direita', 'sharp left': 'acentuadamente à esquerda', 'sharp right': 'acentuadamente à direita', straight: 'em frente', uturn: 'fazendo o retorno',
    on: 'na', to: 'em direção a', dest: 'ao destino',
  },
  en: {
    depart: 'Head out', arrive: 'Arrive', roundabout: 'At the roundabout, exit', continue: 'Continue', turn: 'Turn', merge: 'Merge', fork: 'Keep', ramp: 'Take the ramp', end: 'At the end of the road, turn',
    left: 'left', right: 'right', 'slight left': 'slightly left', 'slight right': 'slightly right', 'sharp left': 'sharp left', 'sharp right': 'sharp right', straight: 'straight', uturn: 'making a U-turn',
    on: 'on', to: 'toward', dest: 'at the destination',
  },
  es: {
    depart: 'Sal', arrive: 'Llegada', roundabout: 'En la rotonda, sal', continue: 'Sigue', turn: 'Gira', merge: 'Incorpórate', fork: 'Mantente', ramp: 'Toma la salida', end: 'Al final de la vía, gira',
    left: 'a la izquierda', right: 'a la derecha', 'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha', 'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha', straight: 'recto', uturn: 'dando la vuelta',
    on: 'por', to: 'hacia', dest: 'al destino',
  },
};

/** "Vire à direita na Rua A" a partir de um passo do OSRM. */
export function stepText(st, lang = 'pt') {
  const W = STEP_WORDS[lang] || STEP_WORDS.pt;
  if (st.type === 'arrive') return `🏁 ${W.arrive}${st.name ? ` — ${st.name}` : ''}`;
  const kind = { 'new name': 'continue', 'end of road': 'end', 'on ramp': 'ramp', 'off ramp': 'ramp', rotary: 'roundabout', 'roundabout turn': 'roundabout', notification: 'continue' }[st.type] || st.type;
  const verb = W[kind] || W.continue;
  const dir = st.modifier && kind !== 'depart' && kind !== 'roundabout' ? ` ${W[st.modifier] || ''}` : '';
  const road = st.name ? ` ${W.on} ${st.name}` : '';
  return `${verb}${dir}${road}`.replace(/\s+/g, ' ').trim();
}
