// NeuroTab — banco IndexedDB compartilhado: fotos dos slides e vetores da busca por significado.
const DB = 'neurotab';
const VERSION = 2;
let pending = null;

export function openDB() {
  if (pending) return pending;
  pending = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('vectors')) d.createObjectStore('vectors', { keyPath: 'id' });
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); pending = null; };
      res(d);
    };
    r.onerror = () => { pending = null; rej(r.error); };
  });
  return pending;
}
