// NeuroTab — biblioteca de imagens ligada ao cérebro (#17).
// Cada imagem lida vira um item do tipo "image" no cérebro (com captureId), com a descrição e o texto
// que foi lido. Assim a busca, a busca por significado e as perguntas ao cérebro já encontram as imagens.
// Excluir a imagem exclui o item; o item guarda só o texto, a imagem continua na biblioteca.
import { openDB } from './idb.js';
import { loadItems, saveItems, makeItem } from './brain.js';
import { readText, describeImage, findAddress, visionNeedsConsent } from './vision.js';

const STORE = 'captures';

async function tx(mode, fn) {
  const db = await openDB();
  if (!db.objectStoreNames.contains(STORE)) throw new Error('Biblioteca de imagens indisponível. Recarregue a extensão.');
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let out;
    Promise.resolve(fn(t.objectStore(STORE))).then((v) => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Falha na biblioteca de imagens.'));
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function listCaptures() {
  const all = await tx('readonly', (s) => req(s.getAll()));
  return (all || []).sort((a, b) => b.capturedAt - a.capturedAt);
}

export const getCapture = (id) => tx('readonly', (s) => req(s.get(id)));

export async function updateCapture(id, patch) {
  return tx('readwrite', async (s) => {
    const rec = await req(s.get(id));
    if (!rec) return null;
    Object.assign(rec, patch);
    s.put(rec);
    return rec;
  });
}

/** Exclui a imagem e o que o cérebro sabia dela. */
export async function deleteCapture(id) {
  await tx('readwrite', (s) => { s.delete(id); });
  const items = await loadItems();
  const left = items.filter((it) => it.captureId !== id);
  if (left.length !== items.length) await saveItems(left);
  try { chrome.runtime.sendMessage({ type: 'imageDeleted', id }).catch(() => {}); } catch { /* sem fundo (testes) */ }
}

/** Situação da leitura: 'pending' (ainda não lida), 'done', 'empty' (sem texto) ou 'error'. */
export function captureStatus(rec) {
  if (rec.analyzeError) return 'error';
  if (!rec.analyzedAt) return 'pending';
  return rec.ocrText || rec.ai?.description || rec.ai?.text ? 'done' : 'empty';
}

/** Imagens que ainda não foram lidas (nem deram erro). */
export async function pendingCaptures() {
  return (await listCaptures()).filter((r) => captureStatus(r) === 'pending');
}

/** Texto que o cérebro guarda para a imagem. */
export function captureText(rec) {
  const ai = rec.ai || {};
  const read = ai.text || rec.ocrText || '';
  return [
    ai.description && `Descrição: ${ai.description}`,
    read && `Texto da imagem:\n${read}`,
    rec.address && `Endereço: ${rec.address}`,
    ai.answer && ai.question && `Pergunta: ${ai.question}\nResposta: ${ai.answer}`,
  ].filter(Boolean).join('\n\n');
}

function captureTitle(rec) {
  const first = (rec.ocrText || '').split('\n').find((l) => l.length > 3) || '';
  return rec.ai?.title || (first.length <= 60 ? first : '') || rec.pageTitle || rec.fileName || 'Imagem';
}

/** Cria ou atualiza o item do cérebro ligado à imagem. Sem nenhum texto, não cria nada. */
export async function syncBrainItem(rec) {
  const items = await loadItems();
  const text = captureText(rec);
  const i = items.findIndex((it) => it.captureId === rec.id);
  if (!text) {
    if (i >= 0) { items.splice(i, 1); await saveItems(items); }
    return null;
  }
  const tags = [...new Set([...(items[i]?.tags || []), ...(rec.ai?.tags || [])])].slice(0, 6);
  if (i >= 0) {
    Object.assign(items[i], { title: captureTitle(rec), text, tags, updatedAt: Date.now() });
    await saveItems(items);
    return items[i];
  }
  const it = makeItem({ type: 'image', captureId: rec.id, title: captureTitle(rec), text, url: rec.pageUrl || '', pageTitle: rec.pageTitle || '', tags, source: rec.source || 'context', createdAt: rec.capturedAt, enriched: true });
  items.unshift(it);
  await saveItems(items);
  return it;
}

/**
 * Lê uma imagem da biblioteca.
 *  • ocr: lê o texto no computador (padrão).
 *  • ai: também descreve pela IA configurada. Para IA na internet, precisa de `allowed: true`
 *    (a pessoa confirmou) ou da autorização permanente nas configurações.
 * Devolve { rec, item }.
 */
export async function analyzeCapture(settings, id, { ocr = true, ai = false, allowed = false, question = '', onProgress } = {}) {
  const rec = await getCapture(id);
  if (!rec) throw new Error('Imagem não encontrada na biblioteca.');
  const patch = { analyzeError: '' };
  try {
    if (ocr && settings.imageOcr !== false) {
      onProgress?.({ step: 'ocr' });
      const r = await readText(rec.blob, { onProgress: (m) => onProgress?.({ step: 'ocr', ...m }) });
      patch.ocrText = r.text;
      patch.ocrConf = r.confidence;
    }
    if (ai) {
      if (visionNeedsConsent(settings) && !allowed) throw new Error('Envio da imagem à IA não autorizado.');
      onProgress?.({ step: 'ai' });
      const d = await describeImage(settings, rec.blob, { question, ocrText: patch.ocrText ?? rec.ocrText ?? '', pageTitle: rec.pageTitle });
      patch.ai = { ...d, question };
    }
    patch.address = patch.ai?.address || findAddress(patch.ai?.text || patch.ocrText || rec.ocrText || '') || rec.address || '';
    patch.analyzedAt = Date.now();
  } catch (e) {
    patch.analyzeError = e?.message || String(e);
    if (!rec.analyzedAt) patch.analyzedAt = 0;
    await updateCapture(id, patch);
    throw e;
  }
  const saved = await updateCapture(id, patch);
  const item = await syncBrainItem(saved);
  return { rec: saved, item };
}

/** Remove do cérebro itens de imagens que não existem mais (ex.: biblioteca limpa por fora). */
export async function pruneOrphans() {
  const ids = new Set((await listCaptures()).map((r) => r.id));
  const items = await loadItems();
  const left = items.filter((it) => it.type !== 'image' || !it.captureId || ids.has(it.captureId));
  if (left.length !== items.length) await saveItems(left);
  return items.length - left.length;
}
