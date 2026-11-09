// Migrações: dados de uma instalação antiga (v0.3) e banco IndexedDB antigo (v2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, fixtureJSON } from './helpers.js';

test('dados da v0.3 são migrados ao abrir a nova aba', async () => {
  const x = await launch();
  try {
    // Grava os dados antigos a partir de uma página neutra (a nova aba reage a mudanças no armazenamento).
    const g = await x.open('src/grant.html', { wait: 200 });
    await x.seed(g, fixtureJSON('legacy-v0.3-storage.json'), { clear: true, reload: false });
    await g.close();
    const p = await x.open('src/newtab.html', { wait: 1500 });
    const meta = await x.storage(p, 'nt_meta');
    assert.ok(meta.schema >= 2);
    const brain = await x.storage(p, 'nt_brain');
    assert.ok(brain.every((i) => Array.isArray(i.tags)));
    assert.ok(brain.some((i) => i.text === 'Comprar café'));
    const s = (await x.storage(p, 'nt_data')).settings;
    assert.equal(s.places[0].name, 'Belo Horizonte');
    assert.ok(await x.storage(p, 'nt_migration_backup'), 'cópia de segurança guardada');
    assert.match(await p.textContent('body'), /Ligar para o banco/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('IndexedDB v2 → v3: fotos preservadas e biblioteca de imagens criada', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/grant.html', { wait: 200 });
    const out = await p.evaluate(async () => {
      await new Promise((r) => { const d = indexedDB.deleteDatabase('neurotab'); d.onsuccess = d.onerror = d.onblocked = r; });
      await new Promise((res, rej) => {
        const r = indexedDB.open('neurotab', 2);
        r.onupgradeneeded = () => { r.result.createObjectStore('photos', { keyPath: 'id' }); r.result.createObjectStore('vectors', { keyPath: 'id' }); };
        r.onsuccess = () => { const tx = r.result.transaction('photos', 'readwrite'); tx.objectStore('photos').put({ id: 'p1', name: 'praia.jpg' }); tx.oncomplete = () => { r.result.close(); res(); }; };
        r.onerror = () => rej(r.error);
      });
      const { openDB } = await import('./lib/idb.js');
      const db = await openDB();
      const photo = await new Promise((r) => { const q = db.transaction('photos').objectStore('photos').get('p1'); q.onsuccess = () => r(q.result); });
      return { version: db.version, stores: [...db.objectStoreNames].sort(), photo: photo?.name };
    });
    assert.equal(out.version, 3);
    assert.deepEqual(out.stores, ['captures', 'photos', 'vectors']);
    assert.equal(out.photo, 'praia.jpg');
  } finally {
    await x.close();
  }
});
