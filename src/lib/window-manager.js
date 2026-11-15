// NeuroTab — camadas dos widgets livres e tecla Esc (#35).
//
// Regras (ver lib/layers.js e docs/dev/ARQUITETURA.md):
// - Elementos globais (barra, 🎙, avisos, menus, tela de voz, diálogos) ficam SEMPRE na camada do token
//   --z-* deles; este módulo não mexe neles (antes, qualquer clique dava a eles um número novo e a
//   ordem mudava com o uso).
// - Só os widgets do modo livre (.free-item, dentro da área central isolada) trocam de ordem ao clicar,
//   numa faixa própria (CONTENT.freeMin–freeMax), renumerada quando passa do limite.
// - Esc fecha só a superfície de cima (pilha única); diálogos nativos (<dialog>) tratam o Esc sozinhos.
import { CONTENT, normalizeStack, createEscapeStack } from './layers.js';

let topZ = CONTENT.freeMin;
let initialized = false;
const escStack = createEscapeStack();

const zOf = (el) => {
  const v = Number.parseInt(el?.style?.zIndex, 10);
  return Number.isFinite(v) ? v : CONTENT.freeMin;
};

/** Traz um widget livre para a frente (dentro da faixa dos widgets livres). */
export function bringToFront(element) {
  if (!element || !element.isConnected) return 0;
  if (topZ >= CONTENT.freeMax) {
    // Renumera todos mantendo a ordem, para nunca passar das guias nem do maximizado.
    const frames = [...document.querySelectorAll('.free-item')];
    const order = normalizeStack(frames.map((f, i) => [i, zOf(f)]));
    for (const [i, z] of order) frames[i].style.zIndex = String(z);
    topZ = CONTENT.freeMin + frames.length - 1;
  }
  topZ = Math.max(topZ, zOf(element)) + 1;
  element.style.zIndex = String(topZ);
  element.dataset.ntLayerOrder = String(topZ);
  return topZ;
}

/**
 * Registra uma superfície na pilha do Esc.
 * entry: { layer: 'overlay' | 'popover' | 'dock' | 'maximized' | …, isOpen: () => bool, close: () => void }
 * Devolve a função que tira o registro.
 */
export const onEscape = (entry) => escStack.register(entry);

/** Para testes: qual superfície o Esc fecharia agora. */
export const escapeTarget = () => escStack.top();

export function initWindowManager() {
  if (initialized) return;
  initialized = true;
  for (const f of document.querySelectorAll('.free-item')) topZ = Math.max(topZ, zOf(f));
  // Fase de "bolha": campos que tratam o Esc sozinhos (ex.: limpar a calculadora) chamam preventDefault.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return; // o navegador fecha o diálogo de cima
    if (escStack.escape()) { e.preventDefault(); e.stopPropagation(); }
  });
}
