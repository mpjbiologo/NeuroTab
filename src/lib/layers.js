// NeuroTab — camadas, posição dentro da tela e tecla Esc, sem depender da tela (testáveis) (#35).

/**
 * Camadas globais (iguais aos tokens --z-* em newtab.css). Elementos fora da área central
 * usam SEMPRE uma destas; nada de números soltos.
 */
export const LAYERS = { content: 1, dock: 30, floating: 40, popover: 50, toolbar: 60, overlay: 70, modal: 80, notification: 90 };

/**
 * Camadas DENTRO da área central (#center é um contexto isolado; não competem com as globais).
 * Widgets do modo livre ficam entre FREE_MIN e FREE_MAX e são renumerados quando passam do limite.
 */
export const CONTENT = { widget: 1, widgetActive: 5, freeMin: 100, freeMax: 8000, guides: 9000, maximizedBackdrop: 9998, maximized: 9999 };

/** Ordem para a tecla Esc: fecha primeiro o que está visualmente por cima. */
export const ESC_ORDER = { maximized: 2, dock: LAYERS.dock, floating: LAYERS.floating, popover: LAYERS.popover, toolbar: LAYERS.toolbar, overlay: LAYERS.overlay, modal: LAYERS.modal };

/**
 * Posição de um painel (menu, previsão do tempo…) junto de uma âncora, sempre dentro da tela.
 * anchor: { left, top, right, bottom } (um ponto vale: left = right, top = bottom).
 * Prefere abaixo e alinhado à esquerda; vira para cima se não couber; encosta nas bordas; e,
 * se ainda for alto demais, limita a altura (maxHeight) para rolar por dentro.
 */
export function placeInViewport({ anchor, size, viewport, margin = 8, gap = 6, align = 'start' }) {
  const vw = viewport.width;
  const vh = viewport.height;
  const w = Math.min(size.width, vw - margin * 2);
  let left = align === 'center' ? (anchor.left + anchor.right) / 2 - w / 2 : anchor.left;
  left = Math.max(margin, Math.min(left, vw - margin - w));
  const below = vh - margin - (anchor.bottom + gap);
  const above = anchor.top - gap - margin;
  let side = 'below';
  let top = anchor.bottom + gap;
  let maxHeight = below;
  if (size.height > below && above > below) {
    side = 'above';
    maxHeight = above;
    top = anchor.top - gap - Math.min(size.height, above);
  }
  const h = Math.min(size.height, maxHeight);
  top = Math.max(margin, Math.min(top, vh - margin - h));
  return { left: Math.round(left), top: Math.round(top), width: Math.round(w), maxHeight: Math.max(0, Math.round(maxHeight)), side };
}

/** Renumera camadas (mantendo a ordem) quando o contador passa do limite. Devolve [ [id, z], ... ]. */
export function normalizeStack(entries, min = CONTENT.freeMin) {
  return [...entries].sort((a, b) => a[1] - b[1]).map(([id], i) => [id, min + i]);
}

/**
 * Pilha da tecla Esc: cada superfície diz em que camada está, se está aberta e como fecha.
 * Esc fecha só a de cima (camada mais alta; empate = a registrada por último).
 */
export function createEscapeStack() {
  const entries = [];
  return {
    register(entry) {
      entries.push(entry);
      return () => { const i = entries.indexOf(entry); if (i >= 0) entries.splice(i, 1); };
    },
    /** A superfície que Esc fecharia agora (ou null). */
    top() {
      let best = null;
      entries.forEach((e, i) => {
        if (!e.isOpen()) return;
        const rank = (ESC_ORDER[e.layer] ?? LAYERS[e.layer] ?? 0) * 1000 + i;
        if (!best || rank > best.rank) best = { e, rank };
      });
      return best?.e || null;
    },
    /** Fecha a de cima; devolve true se fechou alguma. */
    escape() {
      const e = this.top();
      if (!e) return false;
      e.close();
      return true;
    },
    get size() { return entries.length; },
  };
}
