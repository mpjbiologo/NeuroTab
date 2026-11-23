// NeuroTab — Reuniões guardadas no navegador (IndexedDB): a reunião (transcrição, marcações, resumo) e o áudio
// em pedaços de ~10 s (assim nada se perde se a aba fechar no meio).
import { openDB } from './idb.js';

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(name, mode = 'readonly') { return (await openDB()).transaction(name, mode).objectStore(name); }

export async function saveMeeting(m) {
  const rec = { ...m, savedAt: Date.now() };
  await req((await store('meetings', 'readwrite')).put(rec));
  return rec;
}
export async function getMeeting(id) { return (await req((await store('meetings')).get(id))) || null; }
export async function listMeetings() {
  const all = await req((await store('meetings')).getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export async function addAudioChunk(meetingId, n, blob) {
  await req((await store('meeting_audio', 'readwrite')).put({ id: `${meetingId}:${String(n).padStart(6, '0')}`, meetingId, n, blob, size: blob.size }));
}
async function chunksOf(meetingId) {
  const idx = (await store('meeting_audio')).index('meeting');
  const rows = await req(idx.getAll(IDBKeyRange.only(meetingId)));
  return rows.sort((a, b) => a.n - b.n);
}
/** O áudio inteiro (WebM/Opus) ou null. */
export async function audioBlob(meetingId) {
  const rows = await chunksOf(meetingId);
  return rows.length ? new Blob(rows.map((r) => r.blob), { type: rows[0].blob.type || 'audio/webm' }) : null;
}
export async function audioSize(meetingId) { return (await chunksOf(meetingId)).reduce((a, r) => a + (r.size || 0), 0); }

/** Apaga só o áudio (a transcrição e o resumo ficam). */
export async function deleteAudio(meetingId) {
  const rows = await chunksOf(meetingId);
  const st = await store('meeting_audio', 'readwrite');
  await Promise.all(rows.map((r) => req(st.delete(r.id))));
  const m = await getMeeting(meetingId);
  if (m) await saveMeeting({ ...m, audioBytes: 0, audioChunks: 0, keepAudio: false });
}

export async function deleteMeeting(meetingId) {
  await deleteAudio(meetingId);
  await req((await store('meetings', 'readwrite')).delete(meetingId));
}

/** Tamanho do áudio de todas as reuniões: { total, byMeeting: Map } (para o Armazenamento). */
export async function audioUsage() {
  const rows = await req((await store('meeting_audio')).getAll());
  const byMeeting = new Map();
  let total = 0;
  for (const r of rows) { total += r.size || 0; byMeeting.set(r.meetingId, (byMeeting.get(r.meetingId) || 0) + (r.size || 0)); }
  return { total, byMeeting };
}

/** Apaga áudios de reuniões com mais de `days` dias. Devolve quantas reuniões perderam o áudio. */
export async function pruneAudio(days, now = Date.now()) {
  if (!(days > 0)) return 0;
  const { byMeeting } = await audioUsage();
  let n = 0;
  for (const id of byMeeting.keys()) {
    const m = await getMeeting(id);
    if (!m || now - (m.endedAt || m.startedAt) > days * 86400000) { await deleteAudio(id); n++; }
  }
  return n;
}
