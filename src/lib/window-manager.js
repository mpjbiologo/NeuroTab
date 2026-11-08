// NeuroTab — gerenciamento central de camadas e foco de superfícies.
const BASE_Z = 100;
let topZ = BASE_Z;
let initialized = false;

function currentZ(element) {
  const value = Number.parseInt(element?.style?.zIndex || getComputedStyle(element).zIndex, 10);
  return Number.isFinite(value) ? value : BASE_Z;
}

function isVisible(element) {
  return !!element && !element.hidden && element.isConnected
    && getComputedStyle(element).display !== 'none'
    && getComputedStyle(element).visibility !== 'hidden';
}

/** Traz uma superfície para a frente sem depender de valores arbitrários no CSS. */
export function bringToFront(element) {
  if (!element || !element.isConnected) return 0;
  topZ = Math.max(topZ, currentZ(element)) + 1;
  element.style.zIndex = String(topZ);
  element.dataset.ntLayerOrder = String(topZ);
  return topZ;
}

/** Registra uma superfície flutuante para receber prioridade ao interagir. */
export function registerSurface(element, { focus = true } = {}) {
  if (!element || element.dataset.ntWindowManaged === 'true') return () => {};
  element.dataset.ntWindowManaged = 'true';
  topZ = Math.max(topZ, currentZ(element));

  const activate = () => {
    if (isVisible(element)) bringToFront(element);
  };
  element.addEventListener('pointerdown', activate);
  if (focus) element.addEventListener('focusin', activate);

  return () => {
    element.removeEventListener('pointerdown', activate);
    if (focus) element.removeEventListener('focusin', activate);
    delete element.dataset.ntWindowManaged;
  };
}

/** Inicializa o gerenciamento progressivo das superfícies da nova aba. */
export function initWindowManager() {
  if (initialized) return;
  initialized = true;

  const selector = '.free-item, .voice, .wx-pop, .ctx, .toast, .wake-pill, .voice-fab';
  const register = (root) => {
    if (root.nodeType !== 1) return;
    if (root.matches(selector)) registerSurface(root);
    root.querySelectorAll?.(selector).forEach((element) => registerSurface(element));
  };

  register(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(register);
      if (record.type === 'attributes' && record.target.matches?.(selector)) {
        topZ = Math.max(topZ, currentZ(record.target));
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  });

  // Mantém o foco dentro de diálogos nativos; o navegador já os coloca na top layer.
  document.addEventListener('close', (event) => {
    if (event.target instanceof HTMLDialogElement) {
      event.target.style.removeProperty('z-index');
    }
  }, true);
}
