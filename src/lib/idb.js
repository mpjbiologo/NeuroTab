// NeuroTab — banco IndexedDB compartilhado: fotos dos slides, vetores da busca por significado, capturas de mídia
// e reuniões (transcrição e áudio, 0.8.3).
const DB = 'neurotab';
const VERSION = 4;
let pending = null;

export function openDB() {
  if (pending) return pending;
  pending = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('vectors')) d.createObjectStore('vectors', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('captures')) d.createObjectStore('captures', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meetings')) d.createObjectStore('meetings', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meeting_audio')) d.createObjectStore('meeting_audio', { keyPath: 'id' }).createIndex('meeting', 'meetingId');
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
