// Documento invisível usado só para tocar o som de despertadores e timers.
import { createPlayer } from './lib/sounds.js';

const player = createPlayer();
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'play') player.play(msg.kind, msg.opts || {});
  if (msg.type === 'stop') player.stop();
});
