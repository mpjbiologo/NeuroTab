// Conversa por voz (#40) e visual da voz (#39).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greetingFor, isGoodbye, silenceClock, silenceMs, step, FAREWELL } from '../../src/lib/voice-session.js';
import { levelFrom, smooth, bandsFrom, simLevel, vizStyle, VIZ_STYLES } from '../../src/lib/voice-viz.js';
import { DEFAULT_SETTINGS } from '../../src/lib/store.js';

test('saudação: com e sem nome, nos 3 idiomas', () => {
  assert.equal(greetingFor({ userName: 'Marcos' }, 'pt-BR'), 'Olá, Marcos, em que posso ajudar?');
  assert.equal(greetingFor({}, 'pt-BR'), 'Olá! Em que posso ajudar?');
  assert.equal(greetingFor({ userName: 'Marcos' }, 'en-US'), 'Hi, Marcos, how can I help?');
  assert.equal(greetingFor({}, 'en'), 'Hi! How can I help?');
  assert.equal(greetingFor({ userName: 'Marcos' }, 'es-ES'), 'Hola, Marcos, ¿en qué puedo ayudarte?');
  assert.equal(greetingFor({ userName: '  ' }, 'es'), '¡Hola! ¿En qué puedo ayudarte?');
});

test('saudação personalizada com {nome}', () => {
  assert.equal(greetingFor({ userName: 'Ana', voiceGreeting: 'E aí, {nome}! Manda.' }), 'E aí, Ana! Manda.');
  assert.equal(greetingFor({ userName: 'Ana', voiceGreeting: 'Fala, {Name}' }), 'Fala, Ana');
  assert.equal(greetingFor({ voiceGreeting: 'E aí, {nome}! Manda.' }), 'E aí! Manda.');
  assert.equal(greetingFor({ voiceGreeting: 'Olá, {nome}, tudo bem?' }), 'Olá, tudo bem?');
  assert.equal(greetingFor({ voiceGreeting: '{nome}' }, 'pt'), 'Olá! Em que posso ajudar?');
  assert.equal(greetingFor({ voiceGreeting: 'Pronto para ajudar.' }), 'Pronto para ajudar.');
});

test('despedidas encerram; pedidos com as mesmas palavras não', () => {
  for (const s of ['Obrigado!', 'muito obrigada', 'ok, obrigado', 'pode parar', 'tchau', 'Tchau NeuroTab', 'é só isso, obrigado', 'thanks', 'thank you', 'bye', 'gracias', 'adiós', 'eso es todo']) assert.ok(isGoodbye(s), s);
  for (const s of ['anotar obrigado ao João pelo presente', 'me lembre de dizer tchau para a vovó', 'pode parar o timer', 'parar som', '', 'timer de 5 minutos']) assert.equal(isGoodbye(s), false, s);
  assert.ok(isGoodbye('obrigado Verônica', 'Verônica'));
  assert.equal(FAREWELL.pt, 'Até mais!');
});

test('relógio de silêncio: recomeça a cada fala, pausa enquanto responde e vence uma vez', () => {
  let now = 0;
  const timers = new Map();
  let seq = 0;
  const setTimer = (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; };
  const clearTimer = (id) => timers.delete(id);
  const advance = (ms) => { now += ms; for (const [id, tm] of [...timers]) if (tm.at <= now) { timers.delete(id); tm.fn(); } };
  let fired = 0;
  const c = silenceClock(60000, () => fired++, { setTimer, clearTimer, now: () => now });
  c.kick();
  advance(59000);
  assert.equal(fired, 0);
  assert.equal(c.remaining, 1000);
  c.kick(); // a pessoa falou: recomeça
  advance(59000);
  assert.equal(fired, 0);
  c.pause(); // pensando / falando: não conta
  advance(120000);
  assert.equal(fired, 0);
  assert.equal(c.running, false);
  c.kick();
  advance(60000);
  assert.equal(fired, 1);
  assert.ok(c.expired);
  c.kick();
  advance(60000);
  assert.equal(fired, 1, 'vence uma vez só');
  assert.equal(silenceMs(60), 60000);
  assert.equal(silenceMs(5), 15000);
  assert.equal(silenceMs(9999), 300000);
  assert.equal(silenceMs(), 60000);
});

test('estados da voz', () => {
  let s = 'idle';
  for (const to of ['wake', 'greeting', 'listening', 'thinking', 'speaking', 'listening', 'closed']) {
    const r = step(s, to);
    assert.ok(r.ok, `${s} → ${to}`);
    s = r.state;
  }
  assert.deepEqual(step('closed', 'speaking'), { state: 'closed', ok: false });
  assert.deepEqual(step('listening', 'nada'), { state: 'listening', ok: false });
});

test('visual: volume, suavização, faixas e onda simulada', () => {
  assert.equal(levelFrom(new Uint8Array(256).fill(128)), 0, 'silêncio');
  const speech = Uint8Array.from({ length: 256 }, (_, i) => 128 + Math.round(Math.sin(i / 3) * 40));
  const loud = Uint8Array.from({ length: 256 }, (_, i) => 128 + Math.round(Math.sin(i / 3) * 127));
  const a = levelFrom(speech);
  const b = levelFrom(loud);
  assert.ok(a > 0.3 && a < 1, `fala normal ${a}`);
  assert.equal(b, 1, 'pico');
  assert.equal(levelFrom(null), 0);
  assert.ok(smooth(0, 1) > smooth(1, 0) - 0.5, 'sobe rápido');
  assert.ok(smooth(1, 0) > 0.8, 'desce devagar');
  const bands = bandsFrom(new Uint8Array(256).fill(255), 16);
  assert.equal(bands.length, 16);
  assert.ok(bands.every((v) => v === 1));
  assert.deepEqual(bandsFrom(null, 4), [0, 0, 0, 0]);
  assert.ok(simLevel(1000, 50) > simLevel(1000), 'pulso de palavra');
  assert.equal(vizStyle('nada'), 'orb');
  assert.ok(VIZ_STYLES.includes(DEFAULT_SETTINGS.voiceViz));
  assert.equal(DEFAULT_SETTINGS.voiceSilenceSecs, 60);
});
