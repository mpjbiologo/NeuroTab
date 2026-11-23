// NeuroTab — Mistura de áudio da reunião (0.8.3, #41): microfone + áudio da aba (Meet, Zoom, Teams) numa faixa só,
// que vai para o reconhecimento de voz e para a gravação. Com medidor de volume por fonte.
import { levelFrom } from './voice-viz.js';

/** Ganho de cada fonte: soma até ~1,2 e o compressor segura os picos (duas pessoas falando juntas). */
export function mixGains(n) {
  if (n <= 1) return [1];
  return Array.from({ length: n }, () => Math.round((1.2 / n) * 100) / 100 + 0.1);
}

/**
 * sources: [{ id: 'mic'|'tab', stream }]. Devolve { stream, track, level(id), remove(id), close() }.
 * A faixa misturada continua viva mesmo se uma fonte acabar (ex.: parou de compartilhar a aba).
 */
export function mixStreams(sources, { AC = globalThis.AudioContext || globalThis.webkitAudioContext } = {}) {
  const ac = new AC();
  const dest = ac.createMediaStreamDestination();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 6;
  comp.connect(dest);
  const gains = mixGains(sources.length);
  const nodes = new Map();
  sources.forEach((s, i) => {
    const src = ac.createMediaStreamSource(s.stream);
    const g = ac.createGain();
    g.gain.value = gains[i];
    const an = ac.createAnalyser();
    an.fftSize = 512;
    src.connect(g);
    g.connect(comp);
    src.connect(an);
    nodes.set(s.id, { src, g, an, buf: new Uint8Array(an.fftSize), stream: s.stream });
  });
  return {
    ac,
    stream: dest.stream,
    track: dest.stream.getAudioTracks()[0],
    level(id) { const n = nodes.get(id); if (!n) return 0; n.an.getByteTimeDomainData(n.buf); return levelFrom(n.buf); },
    has: (id) => nodes.has(id),
    remove(id) {
      const n = nodes.get(id);
      if (!n) return;
      try { n.src.disconnect(); n.g.disconnect(); } catch { /* já desligado */ }
      n.stream.getTracks().forEach((t) => t.stop());
      nodes.delete(id);
    },
    close() {
      for (const id of [...nodes.keys()]) this.remove(id);
      dest.stream.getTracks().forEach((t) => t.stop());
      ac.close().catch(() => {});
    },
  };
}

/** Navegador transcreve uma faixa de áudio qualquer? (Chrome/Edge 135+: SpeechRecognition.start(track)) */
export function canRecognizeTrack(ua = globalThis.navigator?.userAgentData, uaStr = globalThis.navigator?.userAgent || '') {
  const b = ua?.brands?.find((x) => /Chromium|Google Chrome|Microsoft Edge/.test(x.brand));
  const v = b ? +b.version : +(uaStr.match(/Chrom(?:e|ium)\/(\d+)/)?.[1] || 0);
  return v >= 135;
}

/** Áudio da aba pela escolha de tela do navegador (sem permissão nova). Firefox não traz áudio. */
export const canCaptureTabAudio = () => !!globalThis.navigator?.mediaDevices?.getDisplayMedia && !/Firefox\//.test(globalThis.navigator?.userAgent || '');
