// NeuroTab — ícones desenhados no lugar dos emojis da interface (#51).
// O código continua escrevendo emojis nos botões ("🗑", "⭐ Salvar local"): o "iconizador" troca o emoji
// do começo de botões, chips, títulos e itens de menu por um ícone SVG do mesmo conjunto (traço único),
// e dá nome acessível aos botões que ficam só com o ícone. Conteúdo da pessoa (atalhos, grupos, notas,
// chat) não é tocado.
import { ICONS, EMOJI_ICON } from './icon-data.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const KEYS = Object.keys(EMOJI_ICON).sort((a, b) => b.length - a.length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Emoji no começo (com ou sem o seletor de variação U+FE0F), seguido de espaço ou fim.
const LEAD = new RegExp(`^\\s*(${KEYS.map(esc).join('|')})\\uFE0F?(?:\\s+|$)`, 'u');

const cache = new Map();
/** Desenho do ícone (do arquivo gerado, nunca de dado externo), lido uma vez como SVG. */
function parsed(name, inner) {
  if (!cache.has(name)) {
    const doc = new DOMParser().parseFromString(`<svg xmlns="${SVGNS}">${inner}</svg>`, 'image/svg+xml');
    cache.set(name, [...doc.documentElement.childNodes]);
  }
  return cache.get(name);
}

/** Elemento SVG do ícone `name` (null se não existir). */
export function icon(name, { label = '', cls = '' } = {}) {
  const inner = ICONS[name];
  if (!inner) return null;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ico${cls ? ` ${cls}` : ''}`);
  svg.setAttribute('data-icon', name);
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); }
  else svg.setAttribute('aria-hidden', 'true');
  svg.append(...parsed(name, inner).map((n) => n.cloneNode(true)));
  return svg;
}

/** Nome do ícone para um texto que começa com emoji conhecido: { name, rest } ou null. Puro. */
export function leadingIcon(text) {
  const m = LEAD.exec(String(text || ''));
  if (!m) return null;
  return { name: EMOJI_ICON[m[1]] || EMOJI_ICON[m[1].replace(/️$/, '')], rest: String(text).slice(m[0].length) };
}

/** Onde trocar: controles e rótulos da interface. */
export const ICON_TARGETS = [
  'button', 'a.chip', 'a.btn', '.chip', '.rail-btn', '.wt', '.item .ic', '.ic', '.wi', '.ni', '[role="tab"]', '.ctx button',
  '.panel-head span', '.dlg h2', '.wx-ic', '.wx-pill .wi', '.voice-where', 'summary', '.opt b', 'h2', 'h3', '.tabs button',
  '.cr-ic', '.rmap-pin', '.pill-ic', '.sec', '.group-label', 'label.inline', '.hint-ic', '.voice-orb', '.empty', '.pillar > span', '.game-ic', '.gi', '.feat .ic',
].join(',');
/** Nunca trocar dentro destes (conteúdo escolhido pela pessoa ou que precisa do emoji). */
export const ICON_SKIP = '.rail-groups, .emoji-pick, .tile, .plink, .msg, .reply, .heard, textarea, input, select, option, [data-emoji], .no-icon, .pill, .item .tt, .item .tx';

/** Troca o emoji do começo de um elemento por ícone. Devolve true se trocou. */
export function iconizeEl(el) {
  if (!el || el.dataset?.iconized === '1' || el.closest?.(ICON_SKIP)) return false;
  // Primeiro nó de texto não vazio, procurando só nos filhos diretos (e no primeiro <span>/<b>).
  let node = null;
  for (const c of el.childNodes) {
    if (c.nodeType === 3) { if (c.nodeValue.trim()) { node = c; break; } continue; }
    if (c.nodeType === 1) {
      if (c.matches?.('svg.ico')) return false; // já tem ícone
      if (/^(SPAN|B|STRONG)$/.test(c.tagName) && !c.children.length && c.textContent.trim()) { node = c.firstChild; break; }
      break;
    }
  }
  if (!node) return false;
  const hit = leadingIcon(node.nodeValue);
  if (!hit) return false;
  const svg = icon(hit.name);
  if (!svg) return false;
  node.nodeValue = hit.rest ? ` ${hit.rest.replace(/^\s+/, '')}` : '';
  node.parentNode.insertBefore(svg, node);
  if (!hit.rest) node.remove();
  el.dataset.iconized = '1';
  // Botão que ficou só com o ícone: o nome vem do title (o leitor de tela não lê o emoji).
  if (/^(BUTTON|A)$/.test(el.tagName) && !el.textContent.trim() && !el.getAttribute('aria-label')) {
    const name = el.getAttribute('title');
    if (name) el.setAttribute('aria-label', name.replace(/\s*\(.*\)\s*$/, ''));
  }
  if (el.classList?.contains('icon-only') === false && !el.textContent.trim()) el.classList.add('icon-only');
  return true;
}

/** Troca em tudo dentro de `root` (inclusive o próprio). */
export function iconize(root = document.body) {
  if (!root) return 0;
  let n = 0;
  if (root.nodeType === 1 && root.matches?.(ICON_TARGETS)) n += iconizeEl(root) ? 1 : 0;
  for (const el of root.querySelectorAll?.(ICON_TARGETS) || []) n += iconizeEl(el) ? 1 : 0;
  return n;
}

let observer = null;
/** Liga a troca automática para tudo que aparecer na página (widgets, menus, avisos). */
export function startIconizer(root = document.body) {
  if (observer || !root || globalThis.__ntNoIcons) return;
  iconize(root);
  let queue = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const items = [...queue];
    queue = new Set();
    for (const el of items) if (el.isConnected) iconize(el);
  };
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) queue.add(n);
          else if (n.nodeType === 3 && m.target.nodeType === 1) queue.add(m.target); // el.textContent = '☁'
        }
        // Texto trocado num botão já pronto ("▶" → "⏸"): refaz aquele botão.
        if (m.target.nodeType === 1 && m.target.dataset?.iconized === '1' && !m.target.querySelector(':scope > svg.ico')) {
          delete m.target.dataset.iconized;
          queue.add(m.target);
        }
      } else if (m.type === 'characterData') {
        const el = m.target.parentElement;
        if (el && !el.querySelector(':scope > svg.ico')) { delete el.dataset.iconized; queue.add(el); }
      }
    }
    if (queue.size && !scheduled) { scheduled = true; queueMicrotask(flush); }
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
}
