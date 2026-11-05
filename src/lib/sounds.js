// NeuroTab — sons sintetizados (Web Audio), sem arquivos de áudio.
export const SOUNDS = {
  suave: 'Suave (acordes)',
  sino: 'Sino',
  classico: 'Clássico (bip-bip)',
  digital: 'Digital',
  passaros: 'Pássaros',
};

function tone(ac, out, { freq, start, dur, type = 'sine', vol = 0.5, attack = 0.01, decay }) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + (decay || dur));
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + (decay || dur) + 0.05);
}

// Agenda um "padrão" do som começando em t. Retorna a duração do padrão (s).
export function schedulePattern(ac, out, kind, t) {
  switch (kind) {
    case 'classico':
      for (let i = 0; i < 4; i++) tone(ac, out, { freq: 880, start: t + i * 0.22, dur: 0.12, type: 'square', vol: 0.25, decay: 0.13 });
      return 1.4;
    case 'digital':
      for (let i = 0; i < 3; i++) tone(ac, out, { freq: 1320, start: t + i * 0.1, dur: 0.06, type: 'square', vol: 0.2, decay: 0.07 });
      return 0.9;
    case 'sino':
      [523.25, 1046.5, 1567.98, 2093].forEach((f, i) => tone(ac, out, { freq: f, start: t, dur: 2.2, vol: 0.4 / (i + 1), attack: 0.005, decay: 2.2 - i * 0.3 }));
      return 2.4;
    case 'passaros':
      for (let i = 0; i < 5; i++) {
        const s = t + i * 0.18 + (i > 2 ? 0.4 : 0);
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(2600, s);
        o.frequency.exponentialRampToValueAtTime(4200, s + 0.06);
        o.frequency.exponentialRampToValueAtTime(2900, s + 0.12);
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.25, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.13);
        o.connect(g).connect(out);
        o.start(s);
        o.stop(s + 0.15);
      }
      return 2;
    case 'suave':
    default:
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, out, { freq: f, start: t + i * 0.16, dur: 1.2, vol: 0.35, attack: 0.02, decay: 1.4 }));
      return 2.2;
  }
}

/** Toca um som. loop: repete até stop() ou maxSec. crescendo: volume sobe aos poucos. */
export function createPlayer() {
  let ac = null;
  let timer = null;
  let master = null;
  return {
    async play(kind = 'suave', { loop = false, maxSec = 60, crescendo = false, volume = 1 } = {}) {
      this.stop();
      ac = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      if (ac.state === 'suspended') await ac.resume().catch(() => {});
      master = ac.createGain();
      master.connect(ac.destination);
      const t0 = ac.currentTime + 0.05;
      master.gain.setValueAtTime(crescendo ? 0.12 * volume : volume, t0);
      if (crescendo) master.gain.linearRampToValueAtTime(volume, t0 + 30);
      const end = t0 + maxSec;
      let t = t0;
      const pump = () => {
        if (!ac) return;
        while (t < ac.currentTime + 3 && t < end) {
          t += schedulePattern(ac, master, kind, t) + (loop ? 0.6 : 0);
          if (!loop) { t = end; break; }
        }
        if (loop && t < end) timer = setTimeout(pump, 1000);
        else timer = setTimeout(() => this.stop(), Math.max(0, (Math.min(t, end) - ac.currentTime) * 1000 + 300));
      };
      pump();
    },
    stop() {
      clearTimeout(timer);
      timer = null;
      if (ac) { ac.close().catch(() => {}); ac = null; }
    },
  };
}
