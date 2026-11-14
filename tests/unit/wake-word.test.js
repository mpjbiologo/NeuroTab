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

test('nome do assistente e frase composta (#15)', async () => {
  const { assistantName, wakePhraseOf, phraseSuggestions } = await import('../../src/lib/wake-word.js');
  assert.equal(assistantName({}), 'NeuroTab');
  assert.equal(assistantName({ assistantName: '  Verônica ' }), 'Verônica');
  assert.equal(wakePhraseOf({ assistantName: 'Verônica' }), 'Verônica', 'sem frase, vale o nome');
  assert.equal(wakePhraseOf({ assistantName: 'Verônica', wakePhrase: 'Acorde Verônica' }), 'Acorde Verônica');
  assert.deepEqual(phraseSuggestions('Verônica'), ['Verônica', 'Acorde Verônica', 'Olá Verônica']);
  assert.deepEqual(phraseSuggestions('Veronica', 'en'), ['Veronica', 'Wake up Veronica', 'Hey Veronica']);
  assert.deepEqual(phraseSuggestions('', 'es'), ['NeuroTab', 'Despierta NeuroTab', 'Hola NeuroTab']);
});

test('frase composta e pequenos erros do reconhecimento', async () => {
  const { afterWake, wakeVariants, editDistance, matchesWake } = await import('../../src/lib/wake-word.js');
  const acorde = wakeVariants('Acorde Verônica');
  assert.equal(afterWake('Acorde Verônica, anotar comprar café', acorde), 'anotar comprar café');
  assert.equal(afterWake('acorda berônica timer de 5 minutos', acorde), 'timer de 5 minutos', '2 erros numa frase longa');
  assert.equal(afterWake('ok então acorde Verônica', acorde), '');
  assert.equal(afterWake('acorde tarde amanhã', acorde), null);
  assert.equal(afterWake('Verônica', acorde), null, 'só o nome não basta quando a frase é composta');
  const nome = wakeVariants('Verônica');
  assert.equal(afterWake('Berônica abrir agenda', nome), 'abrir agenda', '1 erro em 8 letras');
  assert.equal(afterWake('Mônica abrir agenda', nome), null, '2 erros em 8 letras não');
  assert.equal(afterWake('Ama abrir', wakeVariants('Ana')), null, 'frase curta só exata');
  assert.equal(afterWake('Ana abrir', wakeVariants('Ana')), 'abrir');
  assert.equal(afterWake('neuro tabby anotar', wakeVariants('NeuroTab')), 'anotar');
  assert.equal(afterWake('neurotal anotar', wakeVariants('NeuroTab')), null, 'a padrão não usa tolerância');
  assert.equal(editDistance('veronica', 'beronica'), 1);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(matchesWake('veronica', ['veronica']), true);
});

test('cancelar, tempo para o comando e estado do indicador', async () => {
  const { isCancel, commandWindowMs, wakeState } = await import('../../src/lib/wake-word.js');
  for (const s of ['cancelar', 'Cancela.', 'esquece', 'Deixa pra lá', 'never mind', 'cancel', 'olvídalo']) assert.equal(isCancel(s), true, s);
  for (const s of ['cancelar a reunião', 'anotar cancelar', '']) assert.equal(isCancel(s), false, s);
  assert.equal(commandWindowMs(8), 8000);
  assert.equal(commandWindowMs(), 8000);
  assert.equal(commandWindowMs(1), 3000);
  assert.equal(commandWindowMs(99), 30000);
  assert.equal(wakeState({ enabled: false }), 'off');
  assert.equal(wakeState({ enabled: true, blocked: true }), 'error');
  assert.equal(wakeState({ enabled: true, busy: true, session: true }), 'processing');
  assert.equal(wakeState({ enabled: true, session: true }), 'listening');
  assert.equal(wakeState({ enabled: true, rec: {} }), 'waiting');
  assert.equal(wakeState({ enabled: true }), 'paused');
});
