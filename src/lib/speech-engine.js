// NeuroTab — Motores de reconhecimento de voz (#49).
// Todos devolvem um objeto no formato do SpeechRecognition do navegador (lang, continuous, interimResults,
// onresult, onerror, onend, onstart, start, stop, abort), então o ditado, o comando de voz e a palavra de
// ativação funcionam igual com qualquer um:
//   • device — reconhecimento do navegador no próprio computador (processLocally, Chrome/Edge 139+): o
//     áudio não sai do computador; o navegador baixa o pacote do idioma uma vez.
//   • whisper — servidor Whisper rodando no computador (whisper.cpp, Speaches, LocalAI…): a NeuroTab grava,
//     separa as falas pelo silêncio e manda só para esse endereço local.
//   • cloud — reconhecimento padrão do navegador (no Chrome/Edge, o áudio vai para o serviço do navegador).
// "Somente local" nunca usa o cloud.

export const ENGINES = ['auto', 'device', 'whisper', 'cloud'];
export const WHISPER_PRESETS = [
  { id: 'whispercpp', label: 'whisper.cpp (whisper-server)', url: 'http://127.0.0.1:8080/inference' },
  { id: 'speaches', label: 'Speaches / faster-whisper', url: 'http://127.0.0.1:8000/v1/audio/transcriptions' },
  { id: 'localai', label: 'LocalAI', url: 'http://127.0.0.1:8080/v1/audio/transcriptions' },
];

const SRClass = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
export const hasBrowserSR = () => !!SRClass();
export const deviceSupported = () => { const SR = SRClass(); return !!SR && typeof SR.available === 'function' && 'processLocally' in (SR.prototype || {}); };
export const canRecordAudio = () => !!globalThis.navigator?.mediaDevices?.getUserMedia && !!(globalThis.AudioContext || globalThis.webkitAudioContext);

let cfg = { voiceEngine: 'auto', voiceLocalOnly: false, whisperUrl: '', whisperModel: '' };
const deviceCache = new Map(); // idioma → { status, use } (use = idioma do pacote local usado no lugar)

/**
 * Idiomas parecidos para o reconhecimento no computador. O Edge, por exemplo, só tem português de
 * Portugal (pt-PT) no computador; ele entende bem a fala brasileira, então serve para pt-BR.
 */
const NEAR = { pt: ['pt-BR', 'pt-PT'], es: ['es-ES', 'es-MX', 'es-US'], en: ['en-US', 'en-GB'], de: ['de-DE'], it: ['it-IT'], fr: ['fr-FR'], ko: ['ko-KR'], ja: ['ja-JP'] };
export const deviceLangCandidates = (lang) => {
  const near = NEAR[String(lang).split('-')[0].toLowerCase()] || [];
  return [lang, ...near.filter((l) => l.toLowerCase() !== String(lang).toLowerCase())];
};
const RANK = { available: 3, downloading: 2, downloadable: 1 };
const failedInstall = new Set();

/** Lê as escolhas das configurações (chamado ao abrir e quando os dados mudam). */
export function configureSpeech(settings = {}, lang) {
  cfg = {
    voiceEngine: ENGINES.includes(settings.voiceEngine) ? settings.voiceEngine : 'auto',
    voiceLocalOnly: !!settings.voiceLocalOnly,
    whisperUrl: String(settings.whisperUrl || '').trim(),
    whisperModel: String(settings.whisperModel || '').trim(),
  };
  // Devolve uma promessa que termina quando já se sabe se o idioma roda no computador.
  return lang ? deviceStatus(lang).catch(() => 'unavailable') : Promise.resolve('unknown');
}
export const speechConfig = () => cfg;

/**
 * Situação do reconhecimento no próprio computador para o idioma: o melhor entre o idioma pedido e os
 * parecidos (o próprio idioma ganha empate). deviceLangFor(lang) diz qual pacote vai ser usado.
 */
export async function deviceStatus(lang, { fresh = false } = {}) {
  if (!deviceSupported()) return 'unsupported';
  const hit = deviceCache.get(lang);
  if (!fresh && hit?.status === 'available') return 'available';
  let best = { status: 'unavailable', use: lang };
  for (const cand of deviceLangCandidates(lang)) {
    let st = 'unavailable';
    try { st = await SRClass().available({ langs: [cand], processLocally: true }); } catch { /* não suportado */ }
    if ((RANK[st] || 0) > (RANK[best.status] || 0)) best = { status: st, use: cand };
    if (st === 'available') break;
  }
  deviceCache.set(lang, best);
  return best.status;
}
export const cachedDeviceStatus = (lang) => (deviceSupported() ? deviceCache.get(lang)?.status || 'unknown' : 'unsupported');
/** Idioma do pacote local usado para `lang` (ex.: pt-PT no lugar de pt-BR no Edge). */
export const deviceLangFor = (lang) => deviceCache.get(lang)?.use || lang;

/**
 * Baixa o pacote do idioma (precisa de um clique: chame direto no clique, sem esperar nada antes).
 * Tenta o idioma pedido e, se o navegador não tiver, os parecidos. Desiste depois de `timeout`
 * (alguns navegadores nunca respondem). Devolve { ok, lang, error }.
 */
export async function installDevice(lang, timeout = 180000) {
  if (!deviceSupported()) return { ok: false, lang, error: 'unsupported' };
  const SR = SRClass();
  const first = deviceLangFor(lang);
  // Idiomas que já falharam vão para o fim: o próximo clique tenta outro primeiro.
  const order = [first, ...deviceLangCandidates(lang).filter((l) => l !== first)].sort((a, b) => failedInstall.has(a) - failedInstall.has(b));
  let error = '';
  for (const cand of order) {
    // A primeira chamada sai no mesmo instante do clique (o navegador exige).
    let timer;
    const ok = await Promise.race([
      Promise.resolve().then(() => SR.install({ langs: [cand], processLocally: true })).catch((e) => { error = `${e?.name || 'Erro'}: ${e?.message || e}`; return false; }),
      new Promise((r) => { timer = setTimeout(() => r('timeout'), timeout); }),
    ]);
    clearTimeout(timer);
    if (ok === 'timeout') { error = 'timeout'; break; }
    if (!ok && !/NotAllowed/.test(error)) failedInstall.add(cand);
    if (ok) { failedInstall.delete(cand); deviceCache.set(lang, { status: 'available', use: cand }); await deviceStatus(lang, { fresh: true }); return { ok: true, lang: cand, error: '' }; }
    if (/NotAllowed/.test(error)) break; // perdeu o clique: não adianta tentar os outros
  }
  await deviceStatus(lang, { fresh: true });
  return { ok: false, lang: first, error };
}

/**
 * Qual motor usar. Puro (testável). env = { hasSR, device: situação do idioma, canRecord }.
 * Devolve { engine: 'device'|'whisper'|'cloud'|null, local: boolean, reason? }.
 */
export function pickEngine({ voiceEngine = 'auto', voiceLocalOnly = false, whisperUrl = '' } = {}, { hasSR = false, device = 'unsupported', canRecord = false } = {}) {
  const deviceOk = device === 'available';
  const whisperOk = !!whisperUrl && canRecord;
  const want = voiceEngine;
  if (want === 'device') return deviceOk || (device !== 'unsupported' && device !== 'unavailable')
    ? { engine: 'device', local: true, reason: deviceOk ? undefined : 'device-not-installed' }
    : { engine: null, local: true, reason: 'device-unsupported' };
  if (want === 'whisper') return whisperOk ? { engine: 'whisper', local: true } : { engine: null, local: true, reason: whisperUrl ? 'no-mic' : 'whisper-not-configured' };
  if (want === 'cloud') return voiceLocalOnly ? { engine: null, local: true, reason: 'local-only' } : hasSR ? { engine: 'cloud', local: false } : { engine: null, local: false, reason: 'no-sr' };
  // auto: no computador quando der; senão o padrão do navegador (se permitido)
  if (deviceOk) return { engine: 'device', local: true };
  if (voiceLocalOnly) {
    if (whisperOk) return { engine: 'whisper', local: true };
    return { engine: null, local: true, reason: 'local-only' };
  }
  if (hasSR) return { engine: 'cloud', local: false };
  if (whisperOk) return { engine: 'whisper', local: true };
  return { engine: null, local: false, reason: 'no-sr' };
}

/** Motor escolhido agora para o idioma (com o que já se sabe do reconhecimento local). */
export function currentEngine(lang) {
  return pickEngine(cfg, { hasSR: hasBrowserSR(), device: cachedDeviceStatus(lang), canRecord: canRecordAudio() });
}

/** Há algum jeito de ouvir? (mostra ou esconde os botões de microfone) */
export const speechAvailable = () => hasBrowserSR() || (!!cfg.whisperUrl && canRecordAudio());

export const ENGINE_ERRORS = {
  'local-only': 'Voz só local: baixe o reconhecimento do idioma ou configure um Whisper local em Opções → IA e voz.',
  'whisper-not-configured': 'Configure o endereço do Whisper local em Opções → IA e voz.',
  'device-unsupported': 'Este navegador não faz reconhecimento de voz no próprio computador. Use o Whisper local.',
  'device-not-installed': 'Baixe o reconhecimento do idioma em Opções → IA e voz.',
  'no-mic': 'Nenhum microfone disponível.',
  'no-sr': 'Seu navegador não oferece reconhecimento de voz. Configure um Whisper local em Opções → IA e voz.',
};

/** Cria o reconhecedor. Devolve { rec, engine, local } ou { rec: null, error }. */
export function createRecognizer(lang) {
  const pick = currentEngine(lang);
  if (!pick.engine) return { rec: null, error: ENGINE_ERRORS[pick.reason] || 'Reconhecimento de voz indisponível.', ...pick };
  let rec;
  if (pick.engine === 'whisper') rec = new WhisperRecognizer({ url: cfg.whisperUrl, model: cfg.whisperModel });
  else {
    const SR = SRClass();
    rec = new SR();
    if (pick.engine === 'device') rec.processLocally = true;
  }
  rec.lang = pick.engine === 'device' ? deviceLangFor(lang) : lang;
  return { rec, ...pick };
}

// =====================================================================
// Whisper local
// =====================================================================

/** Volume (RMS) de um trecho de áudio. */
export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / (buf.length || 1));
}

/** Reduz a taxa de amostragem (média dos blocos), p. ex. 48 kHz → 16 kHz, que é o que o Whisper usa. */
export function downsample(buf, from, to = 16000) {
  if (from === to) return Float32Array.from(buf);
  const ratio = from / to;
  const out = new Float32Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += buf[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

/** WAV PCM 16 bits mono. */
export function encodeWav(samples, rate = 16000) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/**
 * Separa falas pelo silêncio. Recebe o volume de cada bloco e diz quando uma fala começa e termina.
 * Puro: feed(level, ms) → 'start' | 'end' | 'speech' | 'silence' | 'no-speech' | 'too-long'.
 */
export function createSegmenter({ threshold = 0.015, startMs = 120, endSilenceMs = 900, maxMs = 30000, noSpeechMs = 8000 } = {}) {
  let speaking = false, loud = 0, quiet = 0, segMs = 0, idleMs = 0;
  return {
    get speaking() { return speaking; },
    feed(level, ms) {
      if (!speaking) {
        idleMs += ms;
        loud = level >= threshold ? loud + ms : 0;
        if (loud >= startMs) { speaking = true; segMs = loud; quiet = 0; idleMs = 0; return 'start'; }
        if (noSpeechMs && idleMs >= noSpeechMs) { idleMs = 0; return 'no-speech'; }
        return 'silence';
      }
      segMs += ms;
      quiet = level >= threshold * 0.7 ? 0 : quiet + ms;
      if (quiet >= endSilenceMs || segMs >= maxMs) { const why = segMs >= maxMs ? 'too-long' : 'end'; speaking = false; loud = 0; quiet = 0; segMs = 0; return why; }
      return 'speech';
    },
    reset() { speaking = false; loud = 0; quiet = 0; segMs = 0; idleMs = 0; },
  };
}

/** Monta o pedido para o servidor: whisper.cpp (/inference) ou formato OpenAI (/v1/audio/transcriptions). */
export function transcribeRequest(url, wav, { lang = 'pt-BR', model = '' } = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'fala.wav');
  fd.append('response_format', 'json');
  fd.append('language', String(lang).slice(0, 2).toLowerCase());
  if (/\/inference\/?$/.test(new URL(url).pathname)) fd.append('temperature', '0');
  else fd.append('model', model || 'whisper-1');
  return { url, init: { method: 'POST', body: fd } };
}

/** Texto da resposta (JSON {text} ou texto puro); tira marcas como "[BLANK_AUDIO]" e "(música)". */
export function parseTranscript(body) {
  let text = body;
  try { const j = typeof body === 'string' ? JSON.parse(body) : body; text = j?.text ?? (Array.isArray(j?.segments) ? j.segments.map((s) => s.text).join(' ') : ''); } catch { /* texto puro */ }
  return String(text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

const resultEvent = (transcript, isFinal) => {
  const r = [{ transcript, confidence: 1 }];
  r.isFinal = isFinal;
  return { resultIndex: 0, results: [r] };
};

/** Reconhecedor no formato do SpeechRecognition, usando um servidor Whisper local. */
export class WhisperRecognizer {
  constructor({ url, model = '', fetchFn = (...a) => fetch(...a), getUserMedia = (c) => navigator.mediaDevices.getUserMedia(c) } = {}) {
    Object.assign(this, { url, model, fetchFn, getUserMedia });
    this.lang = 'pt-BR';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.processLocally = true;
    this.onresult = this.onerror = this.onend = this.onstart = null;
    this._state = 'idle';
    this._pending = 0;
  }

  async start() {
    if (this._state !== 'idle') throw new Error('InvalidStateError: já iniciado');
    this._state = 'starting';
    try {
      this._stream = await this.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (e) {
      this._fail(/denied|allowed|permission/i.test(e?.name + e?.message) ? 'not-allowed' : 'audio-capture', e?.message);
      return;
    }
    if (this._state !== 'starting') { this._cleanup(); return; } // parado enquanto pedia o microfone
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    this._ac = new AC();
    const src = this._ac.createMediaStreamSource(this._stream);
    const node = this._ac.createScriptProcessor(2048, 1, 1);
    const rate = this._ac.sampleRate;
    const blockMs = (2048 / rate) * 1000;
    const seg = createSegmenter({ noSpeechMs: this.continuous ? 0 : 8000 });
    const preroll = [];
    let chunks = [];
    let lastInterim = 0;
    node.onaudioprocess = (ev) => {
      if (this._state !== 'running') return;
      const data = Float32Array.from(ev.inputBuffer.getChannelData(0));
      const what = seg.feed(rms(data), blockMs);
      if (what === 'silence') { preroll.push(data); if (preroll.length > 4) preroll.shift(); return; }
      if (what === 'no-speech') { this._fail('no-speech'); return; }
      if (what === 'start') { chunks = [...preroll, data]; preroll.length = 0; }
      else chunks.push(data);
      if (this.interimResults && Date.now() - lastInterim > 400) { lastInterim = Date.now(); this._emit(resultEvent('…', false)); }
      if (what === 'end' || what === 'too-long') {
        const audio = chunks;
        chunks = [];
        this._transcribe(audio, rate);
        if (!this.continuous) this._finish();
      }
    };
    this._finishSegment = () => { if (seg.speaking && chunks.length) { const a = chunks; chunks = []; seg.reset(); this._transcribe(a, rate); } };
    src.connect(node);
    node.connect(this._ac.destination);
    this._node = node;
    this._state = 'running';
    this.onstart?.({});
  }

  /** Para de ouvir; o que já foi falado ainda é transcrito antes do fim. */
  stop() {
    if (this._state === 'starting') { this._state = 'stopping'; this._end(); return; }
    if (this._state !== 'running') return;
    this._finishSegment?.();
    this._finish();
  }

  /** Para na hora, sem transcrever. */
  abort() {
    if (this._state === 'idle' || this._state === 'ended') return;
    this._pending = 0;
    this._aborted = true;
    this._state = 'stopping';
    this._end();
  }

  _finish() {
    this._state = 'stopping';
    this._cleanup();
    if (!this._pending) this._end();
  }

  async _transcribe(chunks, rate) {
    const n = chunks.reduce((a, c) => a + c.length, 0);
    if (n < rate * 0.25) return; // menos de 1/4 de segundo: ruído
    const all = new Float32Array(n);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    const wav = encodeWav(downsample(all, rate, 16000), 16000);
    this._pending++;
    try {
      const { url, init } = transcribeRequest(this.url, wav, { lang: this.lang, model: this.model });
      const r = await this.fetchFn(url, init);
      if (!r.ok) throw Object.assign(new Error(`O Whisper local respondeu ${r.status}.`), { code: 'network' });
      const text = parseTranscript(await r.text());
      if (text && !this._aborted) this._emit(resultEvent(text, true));
    } catch (e) {
      if (!this._aborted) this.onerror?.({ error: 'network', message: e?.code ? e.message : `Não consegui falar com o Whisper local (${this.url}). Ele está ligado?` });
    } finally {
      this._pending--;
      if (this._state === 'stopping' && !this._pending) this._end();
    }
  }

  _emit(ev) { this.onresult?.(ev); }

  _fail(error, message) {
    this.onerror?.({ error, message });
    this._state = 'stopping';
    this._cleanup();
    this._end();
  }

  _cleanup() {
    try { this._node?.disconnect(); } catch { /* já solto */ }
    this._node = null;
    this._stream?.getTracks?.().forEach((t) => t.stop());
    this._stream = null;
    this._ac?.close?.().catch?.(() => {});
    this._ac = null;
  }

  _end() {
    if (this._state === 'ended') return;
    this._cleanup();
    this._state = 'ended';
    this.onend?.({});
  }
}
