// Motores de voz (#49): escolha do motor, áudio para o Whisper local e separação das falas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEngine, encodeWav, downsample, rms, createSegmenter, transcribeRequest, parseTranscript, WhisperRecognizer } from '../../src/lib/speech-engine.js';

test('escolha do motor: no computador quando der, nuvem só se permitido', () => {
  const env = (o) => ({ hasSR: true, device: 'unsupported', canRecord: true, ...o });
  const e = (s, o) => { const r = pickEngine(s, env(o)); return r.engine ? `${r.engine}${r.local ? '🔒' : '☁'}` : `x:${r.reason}`; };
  // automático
  assert.equal(e({}, {}), 'cloud☁', 'sem nada local: como antes');
  assert.equal(e({}, { device: 'available' }), 'device🔒', 'pacote baixado: no computador');
  assert.equal(e({}, { device: 'downloadable' }), 'cloud☁', 'ainda não baixado');
  assert.equal(e({ whisperUrl: 'http://127.0.0.1:8080/inference' }, {}), 'cloud☁', 'Whisper só se escolhido ou em "somente local"');
  assert.equal(e({}, { hasSR: false }), 'x:no-sr');
  assert.equal(e({ whisperUrl: 'http://127.0.0.1:8080/inference' }, { hasSR: false }), 'whisper🔒', 'Firefox sem reconhecimento: usa o Whisper');
  // somente local
  assert.equal(e({ voiceLocalOnly: true }, {}), 'x:local-only', 'nunca cai para a nuvem');
  assert.equal(e({ voiceLocalOnly: true }, { device: 'available' }), 'device🔒');
  assert.equal(e({ voiceLocalOnly: true, whisperUrl: 'http://127.0.0.1:8000/v1/audio/transcriptions' }, {}), 'whisper🔒');
  assert.equal(e({ voiceEngine: 'cloud', voiceLocalOnly: true }, {}), 'x:local-only');
  // escolhas explícitas
  assert.equal(e({ voiceEngine: 'whisper' }, {}), 'x:whisper-not-configured');
  assert.equal(e({ voiceEngine: 'whisper', whisperUrl: 'http://x/inference' }, { canRecord: false }), 'x:no-mic');
  assert.equal(e({ voiceEngine: 'device' }, {}), 'x:device-unsupported');
  assert.equal(e({ voiceEngine: 'device' }, { device: 'downloadable' }), 'device🔒', 'tenta; o navegador avisa se faltar o pacote');
  assert.equal(e({ voiceEngine: 'cloud' }, { device: 'available' }), 'cloud☁');
});

test('áudio: WAV 16 kHz mono, redução de taxa e volume', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  const v = new DataView(wav.buffer);
  const str = (o, n) => String.fromCharCode(...wav.slice(o, o + n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint16(22, true), 1, 'mono');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(40, true), 8, '4 amostras × 2 bytes');
  assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)], [0, 32767, -32768]);
  const d = downsample(new Float32Array(48000).fill(0.5), 48000, 16000);
  assert.equal(d.length, 16000);
  assert.ok(Math.abs(d[100] - 0.5) < 1e-6);
  assert.ok(Math.abs(rms(new Float32Array([0.5, -0.5])) - 0.5) < 1e-9);
});

test('separação das falas pelo silêncio', () => {
  const seg = createSegmenter({ threshold: 0.02, startMs: 100, endSilenceMs: 300, maxMs: 2000, noSpeechMs: 1000 });
  const run = (level, ms, n) => Array.from({ length: n }, () => seg.feed(level, ms));
  assert.deepEqual(run(0.001, 50, 3), ['silence', 'silence', 'silence']);
  assert.deepEqual(run(0.1, 50, 2), ['silence', 'start'], 'precisa de 100 ms de som para começar');
  assert.ok(seg.speaking);
  assert.deepEqual(run(0.1, 50, 2), ['speech', 'speech']);
  // respirações curtas não cortam a fala
  assert.deepEqual(run(0.001, 50, 4), ['speech', 'speech', 'speech', 'speech']);
  assert.deepEqual(run(0.1, 50, 1), ['speech']);
  assert.deepEqual(run(0.001, 50, 6), ['speech', 'speech', 'speech', 'speech', 'speech', 'end']);
  assert.equal(seg.speaking, false);
  // fala longa demais é cortada
  run(0.1, 100, 2);
  const out = run(0.1, 100, 20);
  assert.ok(out.includes('too-long'));
  // ninguém fala
  seg.reset();
  assert.equal(run(0.001, 250, 4).at(-1), 'no-speech');
});

test('pedido ao Whisper: whisper.cpp (/inference) e formato OpenAI', async () => {
  const wav = encodeWav(new Float32Array(10));
  const a = transcribeRequest('http://127.0.0.1:8080/inference', wav, { lang: 'pt-BR' });
  assert.equal(a.init.method, 'POST');
  assert.equal(a.init.body.get('language'), 'pt');
  assert.equal(a.init.body.get('response_format'), 'json');
  assert.equal(a.init.body.get('temperature'), '0');
  assert.equal(a.init.body.get('model'), null);
  const f = a.init.body.get('file');
  assert.equal(f.type, 'audio/wav');
  assert.equal(f.size, wav.length);
  const b = transcribeRequest('http://127.0.0.1:8000/v1/audio/transcriptions', wav, { lang: 'en-US', model: 'Systran/faster-whisper-small' });
  assert.equal(b.init.body.get('model'), 'Systran/faster-whisper-small');
  assert.equal(b.init.body.get('language'), 'en');
  assert.equal(transcribeRequest('http://127.0.0.1:8080/v1/audio/transcriptions', wav).init.body.get('model'), 'whisper-1');
});

test('texto da transcrição: JSON, segmentos e marcas de silêncio', () => {
  assert.equal(parseTranscript('{"text":" Anotar comprar café. "}'), 'Anotar comprar café.');
  assert.equal(parseTranscript({ segments: [{ text: 'timer de' }, { text: ' 5 minutos' }] }), 'timer de 5 minutos');
  assert.equal(parseTranscript('{"text":"[BLANK_AUDIO]"}'), '');
  assert.equal(parseTranscript('(música) olá [risos]'), 'olá');
  assert.equal(parseTranscript('texto puro'), 'texto puro');
});

test('WhisperRecognizer: microfone negado vira erro "not-allowed" e termina', async () => {
  const r = new WhisperRecognizer({ url: 'http://127.0.0.1:8080/inference', getUserMedia: async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); } });
  const ev = [];
  r.onerror = (e) => ev.push(`erro:${e.error}`);
  r.onend = () => ev.push('fim');
  await r.start();
  assert.deepEqual(ev, ['erro:not-allowed', 'fim']);
  // parar antes de liberar o microfone também termina, uma vez só
  const r2 = new WhisperRecognizer({ url: 'http://x/inference', getUserMedia: () => new Promise((res) => setTimeout(() => res({ getTracks: () => [{ stop() {} }] }), 20)) });
  let ends = 0;
  r2.onend = () => ends++;
  const p = r2.start();
  r2.stop();
  await p;
  assert.equal(ends, 1);
});

test('no computador: sem pt-BR (como no Edge), usa pt-PT; install conta o motivo da falha', async () => {
  const { deviceStatus, deviceLangFor, installDevice, configureSpeech, createRecognizer, deviceLangCandidates } = await import('../../src/lib/speech-engine.js');
  const installed = new Set();
  const calls = [];
  class FakeSR { constructor() { this.lang = ''; } }
  FakeSR.prototype.processLocally = false;
  FakeSR.available = async ({ langs: [l] }) => (installed.has(l) ? 'available' : ['pt-PT', 'en-US'].includes(l) ? 'downloadable' : 'unavailable');
  FakeSR.install = async ({ langs: [l] }) => { calls.push(l); if (l === 'pt-PT') { installed.add(l); return true; } return false; };
  globalThis.SpeechRecognition = FakeSR;
  try {
    assert.deepEqual(deviceLangCandidates('pt-BR'), ['pt-BR', 'pt-PT']);
    assert.equal(await deviceStatus('pt-BR', { fresh: true }), 'downloadable');
    assert.equal(deviceLangFor('pt-BR'), 'pt-PT');
    const r = await installDevice('pt-BR');
    assert.deepEqual(r, { ok: true, lang: 'pt-PT', error: '' });
    assert.deepEqual(calls, ['pt-PT'], 'baixa direto o que o navegador tem');
    assert.equal(await deviceStatus('pt-BR'), 'available');
    configureSpeech({ voiceEngine: 'device' });
    const made = createRecognizer('pt-BR');
    assert.equal(made.engine, 'device');
    assert.equal(made.rec.lang, 'pt-PT');
    assert.equal(made.rec.processLocally, true);
    // idioma sem pacote nenhum: falha com motivo, e o próximo clique tenta outro
    calls.length = 0;
    FakeSR.available = async () => 'downloadable';
    await deviceStatus('es-MX', { fresh: true });
    const bad = await installDevice('es-MX');
    assert.equal(bad.ok, false);
    assert.deepEqual(calls, ['es-MX', 'es-ES', 'es-US']);
    calls.length = 0;
    FakeSR.install = async () => { throw new DOMException('needs a gesture', 'NotAllowedError'); };
    const na = await installDevice('es-MX');
    assert.match(na.error, /NotAllowedError/);
    assert.equal(calls.length, 0);
  } finally {
    delete globalThis.SpeechRecognition;
    configureSpeech({});
  }
});
