// Ajudantes dos testes de ponta a ponta: abre um Chromium com a extensão carregada da pasta do projeto,
// simula a rede (nenhum teste depende de internet) e, se pedido, simula microfone e voz.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const EXT = fileURLToPath(new URL('../../', import.meta.url));
export const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
export const fixtureJSON = (name) => JSON.parse(readFileSync(fixture(name), 'utf8'));

// PNG mínimo e válido (cor sólida), para testar imagens sem arquivos binários no repositório.
export function png(w = 4, h = 4) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let x = 0xffffffff; for (const v of b) x = table[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([124, 92, 255], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const CORS = { 'access-control-allow-origin': '*' };

const weather = (lat) => ({
  timezone: lat > 30 ? 'Europe/Lisbon' : 'America/Sao_Paulo',
  current: { temperature_2m: 24, apparent_temperature: 25, weather_code: 1, relative_humidity_2m: 55, wind_speed_10m: 8, is_day: 1 },
  daily: { time: ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'], weather_code: [1, 61, 80, 3, 0], temperature_2m_max: [29, 26, 25, 28, 31], temperature_2m_min: [18, 17, 17, 18, 19], precipitation_probability_max: [10, 80, 70, 30, 5] },
});

// Embeddings falsos mas com "significado": palavras do mesmo grupo caem na mesma dimensão.
const CONCEPTS = [['sono', 'dormi', 'dormir', 'sleep', 'insonia', 'cansado'], ['dinheiro', 'conta', 'pagar', 'boleto', 'banco'], ['receita', 'bolo', 'cozinhar']];
export function fakeVector(text) {
  const v = new Array(768).fill(0);
  for (const w of text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(Boolean)) {
    const c = CONCEPTS.findIndex((g) => g.some((x) => w.startsWith(x)));
    if (c >= 0) v[c] += 3;
    else { let h = 7; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 700; v[50 + h] += 1; }
  }
  return v;
}

/**
 * Respostas padrão da "internet". `ai(systemPrompt, body)` decide o texto devolvido pelo Gemini.
 * Registra as chamadas em `calls` para os testes conferirem.
 */
async function mockNetwork(ctx, { ai } = {}) {
  const calls = { embed: 0, ai: [] };
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: weather(+new URL(r.request().url()).searchParams.get('latitude')), headers: CORS }));
  await ctx.route('https://generativelanguage.googleapis.com/**', (r) => {
    const url = r.request().url();
    const body = JSON.parse(r.request().postData() || '{}');
    if (url.includes(':batchEmbedContents')) {
      calls.embed++;
      return r.fulfill({ json: { embeddings: body.requests.map((q) => ({ values: fakeVector(q.content.parts[0].text) })) }, headers: CORS });
    }
    const sys = body.systemInstruction?.parts?.[0]?.text || '';
    calls.ai.push(sys);
    const text = ai?.(sys, body) ?? (sys.includes('Formato:') ? JSON.stringify({ titulo: '', tags: [], tipo: 'nota', lembrete: null }) : 'OK');
    return r.fulfill({ json: { candidates: [{ content: { parts: [{ text }] } }] }, headers: CORS });
  });
  // Qualquer outro endereço externo responde vazio (sem internet nos testes).
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
    const u = r.request().url();
    if (/generativelanguage|open-meteo/.test(u)) return r.fallback();
    return r.fulfill({ json: {}, headers: CORS });
  });
  return calls;
}

// Microfone e voz simulados: window.__lastSR.say("frase") entrega um resultado final.
const FAKE_VOICE = () => {
  class FakeSR {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; window.__lastSR = this; }
    start() { this.started = true; setTimeout(() => this.onstart?.(), 0); }
    stop() { this.started = false; setTimeout(() => this.onend?.(), 0); }
    abort() { this.stop(); }
    say(text) { const r = [{ transcript: text }]; r.isFinal = true; this.onresult?.({ resultIndex: 0, results: [r] }); }
  }
  window.webkitSpeechRecognition = FakeSR;
  window.SpeechRecognition = FakeSR;
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(u) { window.__spoken = (window.__spoken || []).concat(u.text); setTimeout(() => u.onend?.(), 0); }, getVoices: () => [] } });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: class { constructor(t) { this.text = t; } } });
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [] });
};

export async function launch({ locale = 'pt-BR', viewport = { width: 1366, height: 850 }, voice = false, ai } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'neurotab-e2e-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    channel: 'chromium',
    locale,
    viewport,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${locale}`],
  });
  if (voice) await ctx.addInitScript(FAKE_VOICE);
  const calls = await mockNetwork(ctx, { ai });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  const errors = [];

  /** Abre uma página da extensão (ex.: 'src/newtab.html'). Erros de JavaScript vão para `errors`. */
  async function open(path, { wait = 800 } = {}) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`));
    page.on('dialog', (d) => d.accept());
    await page.goto(`chrome-extension://${id}/${path}`);
    if (wait) await page.waitForTimeout(wait);
    return page;
  }

  /** Grava no chrome.storage.local (pela página dada) e opcionalmente recarrega. */
  async function seed(page, values, { reload = true, clear = false } = {}) {
    await page.evaluate(async ([v, c]) => { if (c) await chrome.storage.local.clear(); await chrome.storage.local.set(v); }, [values, clear]);
    if (reload) { await page.reload(); await page.waitForTimeout(900); }
  }

  /** Ajusta configurações (nt_data.settings) e recarrega. */
  async function settings(page, patch, opts) {
    const data = await page.evaluate(async () => (await chrome.storage.local.get('nt_data')).nt_data);
    data.settings = { ...data.settings, ...patch, ai: { ...data.settings.ai, ...(patch.ai || {}) } };
    await seed(page, { nt_data: data }, opts);
  }

  const storage = (page, key) => page.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);

  async function close() {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return { ctx, id, open, seed, settings, storage, errors, calls, close };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
