// Escopo de widget (#6): tudo o que o widget assina ou agenda é desfeito ao desmontar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScope } from '../../src/lib/widget-scope.js';
import { createBus } from '../../src/lib/events.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('dispose cancela inscrições, intervalos, timeouts e listeners', async () => {
  const bus = createBus();
  const target = new EventTarget();
  const s = createScope();
  let n = 0;
  s.add(bus.on('data.changed', () => n++));
  s.every(5, () => n++);
  s.after(5, () => n++);
  s.listen(target, 'ping', () => n++);
  assert.equal(s.size, 4);
  s.dispose();
  assert.equal(s.size, 0);
  bus.emit('data.changed');
  target.dispatchEvent(new Event('ping'));
  await wait(30);
  assert.equal(n, 0);
  assert.equal(bus.count('data.changed'), 0);
});

test('limpar antes do fim tira do escopo; limpeza com erro não impede as outras', () => {
  const s = createScope();
  const order = [];
  const stop = s.add(() => order.push('a'));
  s.add(() => { throw new Error('x'); });
  s.add(() => order.push('c'));
  stop();
  assert.deepEqual(order, ['a']);
  const err = console.error; console.error = () => {};
  s.dispose();
  console.error = err;
  assert.deepEqual(order, ['a', 'c']);
  s.dispose(); // duas vezes não repete
  assert.deepEqual(order, ['a', 'c']);
});

test('after roda uma vez e sai do escopo; registrar depois de descartado limpa na hora', async () => {
  const s = createScope();
  let n = 0;
  s.after(5, () => n++);
  await wait(20);
  assert.equal(n, 1);
  assert.equal(s.size, 0);
  s.dispose();
  let cleaned = false;
  s.add(() => { cleaned = true; });
  assert.equal(cleaned, true);
  assert.equal(s.disposed, true);
});
