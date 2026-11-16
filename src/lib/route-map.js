// NeuroTab — mapa próprio para mostrar um trajeto dentro do widget Trânsito, sem abrir site externo.
// Peças puras (projeção, enquadramento, ladrilhos) + um componente pequeno de DOM: ladrilhos em <img>,
// a linha do trajeto em SVG por cima, arrastar para mover, roda/botões para aproximar.
// Mapa base: ladrilhos do OpenStreetMap. Alguns servidores recusam pedidos sem "Referer" (como os de uma
// extensão), então testamos um ladrilho e, se for recusado, passamos ao próximo da lista.
// Imagens não precisam de permissão de site.

export const TILE = 256;
export const MIN_Z = 3;
export const MAX_Z = 18;

/** Servidores de ladrilhos, em ordem de preferência (todos com dados © OpenStreetMap). */
export const PROVIDERS = [
  { id: 'osm', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, attribution: '© OpenStreetMap', maxZ: 19 },
  { id: 'osm-de', url: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`, attribution: '© OpenStreetMap', maxZ: 18 },
  { id: 'osm-fr', url: (z, x, y) => `https://${'abc'[(x + y) % 3]}.tile.openstreetmap.fr/hot/${z}/${x}/${y}.png`, attribution: '© OpenStreetMap · HOT / OSM France', maxZ: 19 },
  { id: 'esri', url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`, attribution: 'Esri, HERE, Garmin, © OpenStreetMap', maxZ: 18 },
];

let chosen = null;
/**
 * Escolhe o primeiro servidor que entrega um ladrilho de verdade (status 200 e imagem). O resultado fica
 * guardado enquanto a aba estiver aberta. Sem resposta de nenhum, fica com o primeiro.
 */
export async function chooseProvider(fetchFn = globalThis.fetch, providers = PROVIDERS) {
  if (chosen) return chosen;
  for (const p of providers) {
    try {
      const r = await fetchFn(p.url(3, 2, 4), { cache: 'force-cache' });
      if (r.ok && /^image\//.test(r.headers.get('content-type') || '')) { chosen = p; return p; }
    } catch { /* tenta o próximo */ }
  }
  return providers[0];
}
export const resetProvider = () => { chosen = null; };

const clampLat = (lat) => Math.max(-85.05112878, Math.min(85.05112878, lat));

/** Longitude/latitude → pixel do "mundo" no zoom z (Web Mercator, ladrilhos de 256 px). */
export function project(lon, lat, z) {
  const n = TILE * 2 ** z;
  const r = (clampLat(lat) * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

/** Pixel do mundo → longitude/latitude. */
export function unproject(x, y, z) {
  const n = TILE * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lon, lat];
}

/** Maior zoom em que todos os pontos [lon, lat] cabem em w×h com margem `pad`. Devolve { z, lon, lat }. */
export function fitView(points, w, h, pad = 32, maxZ = 16) {
  const pts = points.filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (!pts.length) return null;
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const box = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  let z = maxZ;
  for (; z > MIN_Z; z--) {
    const [x0, y1] = project(box[0], box[1], z);
    const [x1, y0] = project(box[2], box[3], z);
    if (x1 - x0 <= Math.max(1, w - 2 * pad) && y1 - y0 <= Math.max(1, h - 2 * pad)) break;
  }
  const [ax, ay] = project(box[0], box[1], z);
  const [bx, by] = project(box[2], box[3], z);
  const [lon, lat] = unproject((ax + bx) / 2, (ay + by) / 2, z);
  return { z, lon, lat };
}

/** Ladrilhos que cobrem a tela w×h centrada em view; left/top já em pixels da tela. */
export function tilesFor(view, w, h) {
  const [cx, cy] = project(view.lon, view.lat, view.z);
  const n = 2 ** view.z;
  const x0 = Math.floor((cx - w / 2) / TILE);
  const x1 = Math.floor((cx + w / 2) / TILE);
  const y0 = Math.max(0, Math.floor((cy - h / 2) / TILE));
  const y1 = Math.min(n - 1, Math.floor((cy + h / 2) / TILE));
  const out = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      out.push({ z: view.z, x: ((x % n) + n) % n, y, left: Math.round(x * TILE - cx + w / 2), top: Math.round(y * TILE - cy + h / 2) });
    }
  }
  return out;
}

/** Ponto [lon, lat] → [x, y] na tela. */
export function toScreen(lon, lat, view, w, h) {
  const [cx, cy] = project(view.lon, view.lat, view.z);
  const [x, y] = project(lon, lat, view.z);
  return [x - cx + w / 2, y - cy + h / 2];
}

/** Tira pontos que caem no mesmo pixel (a linha de uma rota longa tem milhares). */
export function simplifyScreen(pts, minDist = 1.5) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= minDist) out.push(p);
  }
  if (pts.length && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

const SVGNS = 'http://www.w3.org/2000/svg';

/**
 * Cria o mapa dentro de `host`. set({ line: [[lon,lat]…], markers: [{ lon, lat, icon, title }] }) desenha e
 * enquadra; o resto (arrastar, roda, ＋/－, ⟲) é interno. destroy() solta os ouvintes.
 */
export function createRouteMap(host, { provider = null, fetchFn = globalThis.fetch } = {}) {
  let prov = provider || chosen || PROVIDERS[0];
  const root = document.createElement('div');
  root.className = 'rmap';
  const tiles = document.createElement('div');
  tiles.className = 'rmap-tiles';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'rmap-line');
  const pins = document.createElement('div');
  pins.className = 'rmap-pins';
  const ui = document.createElement('div');
  ui.className = 'rmap-ui';
  const btn = (txt, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
  ui.append(btn('＋', 'Aproximar', () => zoomBy(1)), btn('－', 'Afastar', () => zoomBy(-1)), btn('⟲', 'Enquadrar o trajeto', () => fit()));
  const attr = document.createElement('div');
  attr.className = 'rmap-attr';
  attr.textContent = prov.attribution;
  root.append(tiles, svg, pins, ui, attr);
  host.append(root);

  let data = { line: [], markers: [] };
  let view = null;
  const imgs = new Map();
  const size = () => [root.clientWidth || 300, root.clientHeight || 200];

  function draw() {
    if (!view) return;
    const [w, h] = size();
    const want = new Set();
    tilesFor(view, w, h).forEach((t, i) => {
      const key = `${t.z}/${t.x}/${t.y}`;
      want.add(key);
      let img = imgs.get(key);
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.decoding = 'async';
        img.src = prov.url(t.z, t.x, t.y);
        imgs.set(key, img);
        tiles.append(img);
      }
      img.style.transform = `translate(${t.left}px, ${t.top}px)`;
      img.dataset.i = i;
    });
    for (const [key, img] of imgs) if (!want.has(key)) { img.remove(); imgs.delete(key); }

    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.replaceChildren();
    if (data.line.length > 1) {
      const pts = simplifyScreen(data.line.map(([lon, lat]) => toScreen(lon, lat, view, w, h)));
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
      for (const cls of ['rmap-casing', 'rmap-route']) {
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', cls);
        svg.append(path);
      }
    }
    pins.replaceChildren(...data.markers.map((m) => {
      const [x, y] = toScreen(m.lon, m.lat, view, w, h);
      const el = document.createElement('div');
      el.className = 'rmap-pin';
      el.textContent = m.icon || '📍';
      el.title = m.title || '';
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      return el;
    }));
  }

  function fit() {
    const [w, h] = size();
    view = fitView([...data.line, ...data.markers.map((m) => [m.lon, m.lat])], w, h, 36) || view;
    draw();
  }

  function zoomBy(dz, at) {
    if (!view) return;
    const z = Math.max(MIN_Z, Math.min(prov.maxZ || MAX_Z, view.z + dz));
    if (z === view.z) return;
    const [w, h] = size();
    // Mantém parado o ponto sob o cursor (ou o centro).
    const [ax, ay] = at || [w / 2, h / 2];
    const [cx, cy] = project(view.lon, view.lat, view.z);
    const [lon, lat] = unproject(cx + ax - w / 2, cy + ay - h / 2, view.z);
    const [px, py] = project(lon, lat, z);
    const [nlon, nlat] = unproject(px - (ax - w / 2), py - (ay - h / 2), z);
    view = { z, lon: nlon, lat: nlat };
    draw();
  }

  // Arrastar
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (!view || e.button !== 0 || e.target.closest('.rmap-ui')) return;
    drag = { x: e.clientX, y: e.clientY, c: project(view.lon, view.lat, view.z) };
    root.setPointerCapture?.(e.pointerId);
    root.classList.add('dragging');
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [lon, lat] = unproject(drag.c[0] - (e.clientX - drag.x), drag.c[1] - (e.clientY - drag.y), view.z);
    view = { z: view.z, lon, lat };
    draw();
  });
  const end = () => { drag = null; root.classList.remove('dragging'); };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  let wheelAt = 0;
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (Date.now() - wheelAt < 180) return;
    wheelAt = Date.now();
    const r = root.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1 : -1, [e.clientX - r.left, e.clientY - r.top]);
  }, { passive: false });
  root.addEventListener('dblclick', (e) => { const r = root.getBoundingClientRect(); zoomBy(1, [e.clientX - r.left, e.clientY - r.top]); });

  // Maximizar/restaurar o widget muda o tamanho: reenquadra.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  ro?.observe(root);

  if (!provider && !chosen) {
    chooseProvider(fetchFn).then((p) => {
      if (p === prov || !root.isConnected) return;
      prov = p;
      attr.textContent = p.attribution;
      for (const img of imgs.values()) img.remove();
      imgs.clear();
      draw();
    });
  }

  return {
    el: root,
    set(next) { data = { line: next.line || [], markers: next.markers || [] }; fit(); },
    fit,
    get view() { return view; },
    destroy() { ro?.disconnect(); root.remove(); },
  };
}
