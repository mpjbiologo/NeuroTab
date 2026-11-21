// Documento invisível: toca o som de despertadores e timers e, se a pessoa ligar, acompanha a área de
// transferência (nível 3, Chrome/Edge): lê a cada 1,5 s e avisa o fundo quando muda.
import { createPlayer } from './lib/sounds.js';

const player = createPlayer();
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'play') player.play(msg.kind, msg.opts || {});
  if (msg.type === 'stop') player.stop();
});

// ---------- Área de transferência ----------
import { imageSig, shrinkImage } from './lib/clipboard.js';

let clipTimer = null;
let primed = false; // a primeira leitura só marca o ponto de partida: o que já estava copiado ao ligar não conta
let lastText = '';
let lastSig = '';
const box = document.createElement('div');
box.contentEditable = 'true';
document.body.append(box);

function readOnce() {
  return new Promise((resolve) => {
    const onPaste = (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') || '';
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      resolve({ text, file });
    };
    box.addEventListener('paste', onPaste, { once: true });
    box.focus();
    if (!document.execCommand('paste')) { box.removeEventListener('paste', onPaste); resolve(null); }
    setTimeout(() => { box.removeEventListener('paste', onPaste); resolve(null); }, 1000);
  });
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const r = await readOnce();
    if (!r) return;
    const sig = r.file && !r.text ? await imageSig(r.file) : '';
    if (!primed) { primed = true; lastText = r.text; lastSig = sig; return; }
    if (r.text) {
      if (r.text === lastText) return;
      lastText = r.text;
      lastSig = '';
      chrome.runtime.sendMessage({ type: 'clip:monitor', text: r.text }).catch(() => {});
    } else if (sig && sig !== lastSig) {
      lastSig = sig;
      lastText = '';
      const img = await shrinkImage(r.file).catch(() => null);
      if (img) chrome.runtime.sendMessage({ type: 'clip:monitor', image: img }).catch(() => {});
    }
  } finally {
    busy = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'clip-start' && !clipTimer) {
    primed = false;
    clipTimer = new Worker(new URL('./clip-ticker.js', import.meta.url));
    clipTimer.onmessage = () => tick().catch(() => {});
    clipTimer.postMessage({ every: 1500 });
    tick().catch(() => {});
  }
  if (msg.type === 'clip-stop' && clipTimer) { clipTimer.terminate(); clipTimer = null; }
});
