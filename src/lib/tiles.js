// NeuroTab — aparência dos atalhos (#59): formato, tamanho, cor e ícone dos blocos.
// As funções puras (validação, presets) ficam no topo; linkIconEl e paintTiles mexem no DOM.
import { readableOn, HEX } from './look.js';

export const SHAPES = { classic: 'Bloco', square: 'Quadrado', circle: 'Círculo', pill: 'Pílula' };
export const SIZES = { s: 'Pequeno', m: 'Médio', l: 'Grande' };
export const FILLS = { site: 'Cor de cada site', single: 'Uma cor só', none: 'Transparente' };
export const ICON_KINDS = { auto: 'Ícone do site', image: 'Imagem enviada', emoji: 'Emoji', letter: 'Letra' };
const SCALE = { s: 0.85, m: 1, l: 1.2 };

export const DEFAULT_TILES = { shape: 'classic', size: 'm', gap: 6, fill: 'site', fillColor: '#3fa0a8', opacity: 100, border: true, shadow: true };

/** Estilos prontos: aplicam formato, cores e cantos de uma vez. */
export const TILE_PRESETS = {
  classico: { label: 'Clássico', tileRadius: 4, tiles: { ...DEFAULT_TILES } },
  suave: { label: 'Suave', tileRadius: 16, tiles: { ...DEFAULT_TILES, gap: 10 } },
  minimal: { label: 'Minimal', tileRadius: 12, tiles: { ...DEFAULT_TILES, shape: 'circle', fill: 'none', shadow: false, gap: 10 } },
  vidro: { label: 'Vidro', tileRadius: 14, tiles: { ...DEFAULT_TILES, shape: 'square', opacity: 40, shadow: false, gap: 8 } },
  bolha: { label: 'Bolha', tileRadius: 12, tiles: { ...DEFAULT_TILES, shape: 'circle', gap: 10 } },
  capsula: { label: 'Cápsula', tileRadius: 12, tiles: { ...DEFAULT_TILES, shape: 'pill', gap: 8 } },
};

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const pick = (v, allowed, dflt) => (Object.hasOwn(allowed, v) ? v : dflt);

export function sanitizeTiles(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const num = (v, a, b, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? clamp(Math.round(Number(v)), a, b) : d);
  return {
    shape: pick(r.shape, SHAPES, DEFAULT_TILES.shape),
    size: pick(r.size, SIZES, DEFAULT_TILES.size),
    gap: num(r.gap, 0, 24, DEFAULT_TILES.gap),
    fill: pick(r.fill, FILLS, DEFAULT_TILES.fill),
    fillColor: typeof r.fillColor === 'string' && HEX.test(r.fillColor) ? r.fillColor.toLowerCase() : DEFAULT_TILES.fillColor,
    opacity: num(r.opacity, 15, 100, DEFAULT_TILES.opacity),
    border: r.border === undefined ? DEFAULT_TILES.border : !!r.border,
    shadow: r.shadow === undefined ? DEFAULT_TILES.shadow : !!r.shadow,
  };
}

/** Qual preset bate com o estilo atual (ou '' se é um estilo próprio). */
export function presetOf(tiles, tileRadius) {
  const t = JSON.stringify(sanitizeTiles(tiles));
  return Object.keys(TILE_PRESETS).find((k) => JSON.stringify(sanitizeTiles(TILE_PRESETS[k].tiles)) === t && TILE_PRESETS[k].tileRadius === tileRadius) || '';
}

export const tileScale = (size) => SCALE[size] || 1;

/** Ícone próprio de um atalho, validado. Sem ícone próprio: { kind: 'auto' }. */
export function iconOf(link) {
  const i = link?.icon;
  if (!i || typeof i !== 'object') return { kind: 'auto' };
  if (i.kind === 'image' && typeof i.src === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(i.src) && i.src.length < 200000) return { kind: 'image', src: i.src };
  if (i.kind === 'emoji' && typeof i.value === 'string' && i.value.trim() && [...i.value.trim()].length <= 4) return { kind: 'emoji', value: i.value.trim() };
  if (i.kind === 'letter' && typeof i.value === 'string' && i.value.trim()) return { kind: 'letter', value: [...i.value.trim()].slice(0, 2).join('').toUpperCase() };
  return { kind: 'auto' };
}

/** Limpa o ícone para guardar no atalho (undefined = automático). */
export function cleanIcon(icon) {
  const i = iconOf({ icon });
  return i.kind === 'auto' ? undefined : i;
}

export const shapeOf = (link, tiles) => (Object.hasOwn(SHAPES, link?.shape) ? link.shape : sanitizeTiles(tiles).shape);

/** Letra para o ícone de reserva: a inicial do título ou do domínio. */
export function letterOf(link) {
  const src = String(link?.title || '').trim() || (() => { try { return new URL(link.url).hostname.replace(/^www\./, ''); } catch { return '?'; } })();
  const ch = [...src].find((c) => /[\p{L}\p{N}]/u.test(c));
  return (ch || '?').toUpperCase();
}

export const ICON_MAX_BYTES = 2 * 1024 * 1024;
const ICON_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/bmp'];
/** Confere o arquivo antes de ler: devolve a mensagem de erro, ou '' se está bom. */
export function checkIconFile(file) {
  if (!file) return 'Nenhum arquivo escolhido.';
  if (!ICON_TYPES.includes(file.type)) return 'Formato não aceito. Use PNG, JPG, WebP, GIF, SVG ou ICO.';
  if (file.size > ICON_MAX_BYTES) return 'Imagem grande demais (máx. 2 MB).';
  if (!file.size) return 'Arquivo vazio.';
  return '';
}

/** Cor do texto sobre o bloco. */
export function tileInk(link, tiles) {
  const t = sanitizeTiles(tiles);
  if (t.fill === 'none' || t.opacity < 55) return 'var(--text)';
  const c = t.fill === 'single' ? t.fillColor : link.color;
  return HEX.test(c || '') ? readableOn(c, '#1d1d1d', '#ffffff') : '#1d1d1d';
}
export const tileColor = (link, tiles) => (sanitizeTiles(tiles).fill === 'single' ? sanitizeTiles(tiles).fillColor : link.color || '#555555');

// ---------- DOM ----------

/** Lê uma imagem enviada e reduz para 64×64 (PNG). */
export async function iconFromFile(file) {
  const err = checkIconFile(file);
  if (err) throw new Error(err);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode().catch(() => { throw new Error('Não foi possível abrir esta imagem.'); });
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const w = img.naturalWidth || S;
    const hgt = img.naturalHeight || S;
    const k = Math.min(S / w, S / hgt);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (S - w * k) / 2, (S - hgt * k) / 2, w * k, hgt * k);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Elemento do ícone de um atalho: imagem própria, emoji, letra ou favicon (com a letra de reserva). */
export function linkIconEl(link, faviconFor) {
  const i = iconOf(link);
  const box = document.createElement('span');
  box.className = 'tic';
  const letter = (txt) => {
    box.classList.add('tic-letter');
    box.textContent = txt;
  };
  if (i.kind === 'emoji') { box.classList.add('tic-emoji'); box.textContent = i.value; return box; }
  if (i.kind === 'letter') { letter(i.value); return box; }
  const src = i.kind === 'image' ? i.src : faviconFor(link);
  if (!src) { letter(letterOf(link)); return box; }
  const img = document.createElement('img');
  img.alt = '';
  img.src = src;
  img.onerror = () => { img.remove(); letter(letterOf(link)); };
  box.append(img);
  return box;
}

/** Variáveis e atributos do estilo dos blocos num elemento raiz (a página ou uma prévia). */
export function paintTiles(root, settings) {
  const t = sanitizeTiles(settings.tiles);
  const st = root.style;
  st.setProperty('--tile-gap', t.gap + 'px');
  st.setProperty('--tile-op', t.opacity + '%');
  st.setProperty('--tile-scale', String(tileScale(t.size)));
  st.setProperty('--radius', (Number(settings.tileRadius) || 0) + 'px');
  root.dataset.tfill = t.fill;
  root.dataset.tborder = t.border ? '1' : '0';
  root.dataset.tshadow = t.shadow ? '1' : '0';
}

/** Monta um bloco de atalho (usado pelo widget Atalhos e pelas prévias das configurações). */
export function tileEl(link, settings, { faviconFor, href = true, target = '_self' } = {}) {
  const a = document.createElement(href ? 'a' : 'div');
  a.className = 'tile';
  if (href) { a.href = link.url; a.target = target; a.title = link.url; }
  a.dataset.shape = shapeOf(link, settings.tiles);
  a.style.setProperty('--c', tileColor(link, settings.tiles));
  a.style.setProperty('--ct', tileInk(link, settings.tiles));
  const pill = document.createElement('span');
  pill.className = 'pill';
  const title = document.createElement('span');
  title.className = 'tt';
  title.textContent = link.title || '';
  pill.append(linkIconEl(link, faviconFor), title);
  a.append(pill);
  return a;
}
