// NeuroTab — lê, sem pressa, o texto das imagens novas da biblioteca (#17), só no computador.
// Uma por vez, quando a página está à toa. A descrição pela IA é sempre pedida pela pessoa (analyze.html).
import { S } from './state.js';
import { pendingCaptures, analyzeCapture, pruneOrphans, purgeTemp } from '../lib/image-index.js';
import { closeReader } from '../lib/vision.js';

let busy = false;
let timer = null;
const idle = (fn) => (globalThis.requestIdleCallback ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 500));

// Com várias abas abertas, só uma lê por vez (Web Locks).
const withLock = (fn) => (navigator.locks ? navigator.locks.request('nt-image-read', { ifAvailable: true }, (lock) => (lock ? fn() : null)) : fn());

function work() {
  if (busy || S.data.settings.imageOcr === false || document.hidden) return;
  return withLock(readPending);
}

async function readPending() {
  busy = true;
  try {
    const list = await pendingCaptures();
    for (const rec of list.slice(0, 20)) {
      if (S.data.settings.imageOcr === false || document.hidden) break;
      try {
        await analyzeCapture(S.data.settings, rec.id, { ocr: true });
      } catch (e) {
        console.info('NeuroTab: não deu para ler a imagem', rec.id, e?.message);
        if (/baixar o pacote|não abriu/.test(e?.message || '')) break; // sem internet ou sem suporte: tenta outra hora
      }
    }
    if (list.length) closeReader(); // libera a memória do leitor
  } catch (e) {
    console.info('NeuroTab: leitura das imagens adiada', e?.message);
  } finally {
    busy = false;
  }
}

/** Agenda uma rodada de leitura (ao abrir a aba, ao salvar imagem nova, ao voltar para a aba). */
export function scheduleImageRead(ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => idle(work), ms);
}

export function setupImageReader() {
  scheduleImageRead(6000);
  pruneOrphans().catch(() => {});
  purgeTemp().catch(() => {}); // temporárias de análises esquecidas
  window.addEventListener('nt-image-captured', () => scheduleImageRead(800));
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'imageCaptured') scheduleImageRead(1500); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleImageRead(3000); });
}
