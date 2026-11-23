// NeuroTab — Visual do assistente de voz (0.8.2, #39): canvas 2D, sem bibliotecas.
// O volume vem do microfone (AnalyserNode) só enquanto a tela de voz está aberta; nada é gravado nem enviado.

export const VIZ_STYLES = ['orb', 'bars', 'line', 'particles', 'classic'];
export const VIZ_LABELS = { orb: 'Orbe com ondas', bars: 'Barras de equalizador', line: 'Linha de onda', particles: 'Partículas', classic: 'Clássico' };
export const vizStyle = (s) => (VIZ_STYLES.includes(s) ? s : 'orb');

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Volume 0..1 a partir das amostras do analisador (getByteTimeDomainData: 128 = silêncio). */
export function levelFrom(samples, { floor = 0.015, span = 0.22 } = {}) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; sum += v * v; }
  const rms = Math.sqrt(sum / samples.length);
  return clamp01((rms - floor) / span);
}

/** Suaviza: sobe rápido, desce devagar (as ondas não piscam). */
export const smooth = (prev, next, attack = 0.55, release = 0.12) => prev + (next - prev) * (next > prev ? attack : release);

/** n faixas 0..1 a partir de getByteFrequencyData, agrupadas em escala logarítmica (graves ocupam menos). */
export function bandsFrom(freq, n = 24) {
  const out = new Array(n).fill(0);
  if (!freq?.length) return out;
  const max = freq.length;
  for (let b = 0; b < n; b++) {
    const a = Math.floor(Math.pow(max, b / n));
    const z = Math.max(a + 1, Math.floor(Math.pow(max, (b + 1) / n)));
    let s = 0;
    for (let i = a; i < z && i < max; i++) s += freq[i];
    out[b] = clamp01(s / (z - a) / 255);
  }
  return out;
}

/** Onda "simulada" (sem microfone, ou falando): 0..1 a partir do tempo e dos pulsos de palavra. */
export function simLevel(t, pulseAge = Infinity) {
  const base = 0.18 + 0.12 * Math.sin(t / 260) * Math.sin(t / 410);
  const kick = pulseAge < 400 ? 0.55 * (1 - pulseAge / 400) : 0;
  return clamp01(base + kick);
}

/** Microfone para o visual. Devolve { level(), bands(n), close() } ou null (negado ou indisponível). */
export async function openMeter({ getUserMedia = (c) => navigator.mediaDevices.getUserMedia(c) } = {}) {
  let stream;
  let ac;
  try {
    stream = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    ac = new AC();
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.6;
    src.connect(an);
    const td = new Uint8Array(an.fftSize);
    const fq = new Uint8Array(an.frequencyBinCount);
    return {
      level() { an.getByteTimeDomainData(td); return levelFrom(td); },
      bands(n) { an.getByteFrequencyData(fq); return bandsFrom(fq, n); },
      close() { stream.getTracks?.().forEach((tr) => tr.stop()); ac.close?.().catch?.(() => {}); },
    };
  } catch {
    stream?.getTracks?.().forEach((tr) => tr.stop());
    ac?.close?.().catch?.(() => {});
    return null;
  }
}

const css = (el, name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;

/**
 * Desenha o estado da voz num canvas. opts: { style, reduced, meter }.
 * API: setState(s), pulse() (palavra falada), flash() (palavra de ativação), setMeter(m), setStyle(s), destroy().
 */
export function createViz(canvas, { style = 'orb', reduced = false, meter = null, fps = 30 } = {}) {
  const g = canvas.getContext('2d');
  let st = 'idle';
  let sty = vizStyle(style);
  let m = meter;
  let lvl = 0;
  let lastPulse = -1e9;
  let flashAt = -1e9;
  let raf = 0;
  let last = 0;
  let alive = true;
  const parts = Array.from({ length: 36 }, (_, i) => ({ a: (i / 36) * Math.PI * 2, r: 0.6 + Math.random() * 0.5, s: 0.4 + Math.random() }));

  function size() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, h];
  }

  function frame(t) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden || t - last < 1000 / fps) return;
    last = t;
    const [w, h] = size();
    const accent = css(canvas, '--accent', '#7c5cff');
    const accent2 = css(canvas, '--accent-2', '#2ec5ff');
    const amber = css(canvas, '--warn', 'orange');
    let target;
    if (st === 'listening') target = m ? m.level() : simLevel(t);
    else if (st === 'speaking' || st === 'greeting') target = simLevel(t, t - lastPulse);
    else if (st === 'thinking') target = 0.25;
    else target = 0.05;
    lvl = smooth(lvl, target);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.24;
    g.clearRect(0, 0, w, h);
    const color = st === 'error' ? amber : accent;
    const fl = Math.max(0, 1 - (t - flashAt) / 500);
    // núcleo com brilho
    const glow = reduced ? 0.35 + lvl * 0.4 : 0.25 + lvl * 0.6 + fl * 0.6;
    const grad = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * (1.6 + (reduced ? 0 : lvl * 0.6)));
    grad.addColorStop(0, color);
    grad.addColorStop(0.45, st === 'error' ? amber : accent2);
    grad.addColorStop(1, 'transparent');
    g.globalAlpha = st === 'error' ? 0.35 : Math.min(1, glow);
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, R * (1.6 + (reduced ? 0 : lvl * 0.6)), 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    if (reduced || sty === 'classic' || st === 'error') {
      g.fillStyle = color;
      g.globalAlpha = st === 'error' ? 0.5 : 0.85;
      g.beginPath(); g.arc(cx, cy, R * 0.8, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      return;
    }
    g.strokeStyle = accent2;
    g.lineCap = 'round';
    if (st === 'thinking') {
      // anel girando + partículas em órbita
      g.lineWidth = 3;
      const a0 = t / 300;
      g.beginPath(); g.arc(cx, cy, R * 1.15, a0, a0 + Math.PI * 1.3); g.stroke();
      g.fillStyle = accent2;
      for (const p of parts.slice(0, 12)) {
        const a = p.a + (t / 900) * p.s;
        g.beginPath(); g.arc(cx + Math.cos(a) * R * 1.45, cy + Math.sin(a) * R * 1.45, 2, 0, Math.PI * 2); g.fill();
      }
    } else if (sty === 'orb') {
      g.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const ph = ((t / 1400 + k / 3) % 1);
        g.globalAlpha = (1 - ph) * (0.25 + lvl * 0.75);
        g.beginPath(); g.arc(cx, cy, R * (1 + ph * (0.5 + lvl * 0.9)), 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
    } else if (sty === 'bars') {
      const n = 32;
      const b = m && st === 'listening' ? m.bands(n) : null;
      g.lineWidth = Math.max(2, (Math.PI * 2 * R) / n / 2.2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const v = b ? b[i] * 0.7 + lvl * 0.3 : lvl * (0.5 + 0.5 * Math.abs(Math.sin(t / 180 + i * 0.7)));
        const r1 = R * 1.05;
        const r2 = r1 + R * (0.08 + v * 0.8);
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
      }
    } else if (sty === 'line') {
      g.lineWidth = 2.5;
      g.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const k = x / w;
        const env = Math.sin(k * Math.PI);
        const y = cy + Math.sin(k * 18 + t / 140) * env * (4 + lvl * h * 0.3) * Math.sin(t / 500 + k * 4);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    } else if (sty === 'particles') {
      g.fillStyle = accent2;
      for (const p of parts) {
        const a = p.a + (t / 4000) * p.s;
        const r = R * (0.9 + p.r * (0.3 + lvl * 1.3));
        g.globalAlpha = 0.4 + lvl * 0.6;
        g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5 + lvl * 2.5, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
    // núcleo
    g.fillStyle = color;
    g.globalAlpha = 0.9;
    g.beginPath(); g.arc(cx, cy, R * (0.75 + lvl * 0.12), 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }
  raf = requestAnimationFrame(frame);
  return {
    setState(s) { if (s === 'wake') flashAt = performance.now(); st = s; canvas.dataset.state = s; },
    pulse() { lastPulse = performance.now(); },
    flash() { flashAt = performance.now(); },
    setMeter(x) { m = x; },
    setStyle(s) { sty = vizStyle(s); canvas.dataset.style = sty; },
    get state() { return st; },
    get level() { return lvl; },
    destroy() { alive = false; cancelAnimationFrame(raf); },
  };
}
