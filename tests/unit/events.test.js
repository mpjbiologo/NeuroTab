// Barramento de eventos (#5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus, EVENTS } from '../../src/lib/events.js';

const quiet = () => createBus({ onError: () => {} });

test('assinar, receber e cancelar', () => {
  const bus = quiet();
  const got = [];
  const off = bus.on('data.changed', (p) => got.push(p));
  assert.equal(bus.emit('data.changed', 1), 1);
  off();
  off(); // cancelar duas vezes não quebra
  assert.equal(bus.emit('data.changed', 2), 0);
  assert.deepEqual(got, [1]);
  assert.equal(bus.count('data.changed'), 0);
});

test('nomes antigos continuam funcionando (data, brain, ask)', () => {
  const bus = quiet();
  const got = [];
  bus.on('brain', (p) => got.push(['old', p]));
  bus.on('brain.changed', (p) => got.push(['new', p]));
  bus.emit('brain', 'x');
  assert.deepEqual(got, [['old', 'x'], ['new', 'x']]);
  assert.equal(bus.count('brain'), 2);
});

test('um assinante com erro não impede os outros', () => {
  const errors = [];
  const bus = createBus({ onError: (e, evt) => errors.push([e.message, evt]) });
  const got = [];
  bus.on('ask.requested', () => { throw new Error('quebrou'); });
  bus.on('ask.requested', (q) => got.push(q));
  assert.equal(bus.emit('ask.requested', 'oi'), 1);
  assert.deepEqual(got, ['oi']);
  assert.deepEqual(errors, [['quebrou', 'ask.requested']]);
});

test('once roda uma vez; a mesma função pode assinar duas vezes', () => {
  const bus = quiet();
  let n = 0;
  bus.once('data.changed', () => n++);
  bus.emit('data.changed'); bus.emit('data.changed');
  assert.equal(n, 1);
  const fn = () => n++;
  const a = bus.on('data.changed', fn);
  bus.on('data.changed', fn);
  bus.emit('data.changed');
  assert.equal(n, 3);
  a();
  bus.emit('data.changed');
  assert.equal(n, 4);
});

test('contratos: evento desconhecido e campos obrigatórios', () => {
  const bus = quiet();
  assert.throws(() => bus.on('nao.existe', () => {}), /desconhecido/);
  assert.throws(() => bus.emit('nao.existe'), /desconhecido/);
  assert.throws(() => bus.emit('task.created', {}), /obrigatórios \(id\)/);
  assert.throws(() => bus.emit('brain.item.created', { id: 1 }), /type/);
  assert.equal(bus.emit('task.created', { id: 't1' }), 0);
  assert.throws(() => bus.on('data.changed', 'x'), /função/);
  for (const k of ['brain.item.created', 'task.created', 'task.completed', 'knowledge.source.added', 'study.review.due']) assert.ok(EVENTS[k], k);
});

test('assinante que se cancela durante o aviso não atrapalha os demais', () => {
  const bus = quiet();
  const got = [];
  let off1;
  off1 = bus.on('data.changed', () => { got.push(1); off1(); });
  bus.on('data.changed', () => got.push(2));
  bus.emit('data.changed'); bus.emit('data.changed');
  assert.deepEqual(got, [1, 2, 2]);
});

test('eventos do cérebro: item criado, tarefa criada e tarefa concluída', async () => {
  const { brainEvents } = await import('../../src/lib/events.js');
  const prev = [{ id: 'a', type: 'note' }, { id: 't', type: 'task', done: false }, { id: 'u', type: 'task', done: true }];
  const next = [...prev.slice(0, 1), { id: 't', type: 'task', done: true }, { id: 'u', type: 'task', done: true }, { id: 'n', type: 'task' }, { id: 'm', type: 'note' }];
  assert.deepEqual(brainEvents(prev, next).map(([e, it]) => `${e}:${it.id}`), ['task.completed:t', 'brain.item.created:n', 'task.created:n', 'brain.item.created:m']);
  assert.deepEqual(brainEvents(next, next), []);
  assert.equal(brainEvents([], [{ id: 'x', type: 'note' }]).length, 1);
});
