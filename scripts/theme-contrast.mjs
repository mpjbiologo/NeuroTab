// Confere o contraste dos tokens de cada tema (docs/dev/DESIGN.md). Uso: node scripts/theme-contrast.mjs
import { readFileSync } from 'node:fs';

export function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((x) => { x = Math.min(1, Math.max(0, x)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; });
}
const parse = (v) => {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/.exec(v);
  if (!m) return null;
  return { rgb: oklchToRgb(+m[1], +m[2], +m[3]), a: m[4] === undefined ? 1 : +m[4] };
};
const over = (top, under) => top.rgb.map((c, i) => c * top.a + under[i] * (1 - top.a));
const lum = (rgb) => { const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); const [r, g, b] = rgb.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };

export function themes(css) {
  const out = {};
  const blocks = [...css.matchAll(/(?:^|\n)([^{}\n]*\[data-theme="(\w+)"\][^{]*)\{([^}]*)\}/g)];
  for (const [, , name, body] of blocks) {
    const t = {};
    for (const [, k, v] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) t[k] = v.trim();
    out[name] = t;
  }
  return out;
}

/** Pares que precisam passar: [texto, fundo, mínimo]. Fundos translúcidos são compostos sobre --bg. */
export const PAIRS = [
  ['text', 'surface', 4.5], ['text-2', 'surface', 4.5], ['text-3', 'field', 4.5], ['text-2', 'surface-strong', 4.5],
  ['on-accent', 'accent', 4.5], ['accent-text', 'surface', 4.5], ['accent-text', 'surface-strong', 4.5],
  ['bad', 'surface', 4.5], ['ok', 'surface', 3], ['on-bad', 'bad', 4.5], ['text', 'surface-solid', 4.5],
];

export function check(css) {
  const res = [];
  for (const [name, t] of Object.entries(themes(css))) {
    const bg = parse(t.bg).rgb;
    const solid = (k) => { const p = parse(t[k]); return over(p, bg); };
    for (const [fg, back, min] of PAIRS) {
      const backRgb = back === 'accent' || back === 'bad' ? parse(t[back]).rgb : solid(back);
      const r = ratio(over(parse(t[fg]), backRgb), backRgb);
      res.push({ theme: name, fg, back, ratio: +r.toFixed(2), min, ok: r >= min });
    }
  }
  return res;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = check(readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8'));
  for (const x of r) console.log(`${x.ok ? '✓' : '✗'} ${x.theme.padEnd(9)} ${x.fg.padEnd(12)} sobre ${x.back.padEnd(15)} ${x.ratio} (mín. ${x.min})`);
  process.exit(r.every((x) => x.ok) ? 0 : 1);
}
