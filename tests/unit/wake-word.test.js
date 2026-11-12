// Palavra de ativação: achar "NeuroTab" no que foi ouvido e decidir quando escutar.
import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterWake, wakeVariants, wakeWindowMs, shouldListen, WAKE_VARIANTS } from '../../src/lib/wake-word.js';

test('acha a palavra e devolve o comando que vem depois', () => {
  assert.equal(afterWake('NeuroTab anotar comprar café'), 'anotar comprar café');
  assert.equal(afterWake('neuro tab, timer de 5 minutos'), 'timer de 5 minutos');
  assert.equal(afterWake('Neuro-Tab: que horas são?'), 'que horas são?');
  assert.equal(afterWake('ok neurotabe abrir youtube'), 'abrir youtube');
  assert.equal(afterWake('NEURAL TAB how is the weather'), 'how is the weather');
});

test('só a palavra, sem comando, devolve vazio; sem a palavra, null', () => {
  assert.equal(afterWake('NeuroTab'), '');
  assert.equal(afterWake('NeuroTab!'), '');
  assert.equal(afterWake('abrir o youtube'), null);
  assert.equal(afterWake(''), null);
  assert.equal(afterWake(undefined), null);
  assert.equal(afterWake('neuro'), null);
});

test('frase personalizada (sem variações) e acentos', () => {
  const v = wakeVariants('Jarvis');
  assert.deepEqual(v, ['jarvis']);
  assert.equal(afterWake('Jarvis, abrir agenda', v), 'abrir agenda');
  assert.equal(afterWake('NeuroTab abrir agenda', v), null);
  assert.equal(afterWake('Olá Computação tocar música', wakeVariants('olá computação')), 'tocar música');
  assert.deepEqual(wakeVariants(''), WAKE_VARIANTS);
  assert.deepEqual(wakeVariants('Neuro Tab'), WAKE_VARIANTS);
});

test('prazo de escuta: mínimo 1 minuto, padrão 10', () => {
  assert.equal(wakeWindowMs(5), 5 * 60e3);
  assert.equal(wakeWindowMs(0), 10 * 60e3);
  assert.equal(wakeWindowMs(undefined), 10 * 60e3);
  assert.equal(wakeWindowMs(0.2), 60e3);
  assert.equal(wakeWindowMs('3'), 3 * 60e3);
});

test('quando escutar: tudo liberado e dentro do prazo', () => {
  const ok = { enabled: true, paused: false, blocked: false, external: false, busy: false, session: false, visible: true, focused: true, now: 1000, until: 2000 };
  assert.equal(shouldListen(ok), true);
  for (const k of ['paused', 'blocked', 'external', 'busy', 'session']) assert.equal(shouldListen({ ...ok, [k]: true }), false, k);
  for (const k of ['enabled', 'visible', 'focused']) assert.equal(shouldListen({ ...ok, [k]: false }), false, k);
  assert.equal(shouldListen({ ...ok, now: 2000 }), false, 'prazo vencido');
});
