// NeuroTab — biblioteca local de imagens (IndexedDB, store "captures").
// Usada pelo menu de contexto (background), pela Captura Rápida (colar imagem) e pelo widget Biblioteca.
import { openDB } from './idb.js';
import { uid } from './store.js';

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const STORE = 'captures';

/** Descobre o tipo pela assinatura dos primeiros bytes (para servidores que não informam o tipo certo). */
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const at = (i, ...xs) => xs.every((x, k) => b[i + k] === x);
  const ascii = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF8')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return 'image/avif';
  if (ascii(0, 'BM')) return 'image/bmp';
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  const head = new TextDecoder().decode(b.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return '';
}

/** Valida tipo e tamanho; devolve o tipo MIME normalizado ou lança erro com mensagem amigável. */
export function validateImage(blob, declaredType = '') {
  const type = (blob?.type || declaredType || '').split(';')[0].trim().toLowerCase();
  if (!blob || !blob.size) throw new Error('A imagem está vazia.');
  if (!type.startsWith('image/')) throw new Error('O conteúdo não é uma imagem.');
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('Imagem maior que 12 MB. Escolha uma versão menor.');
  return type;
}

/** Salva uma imagem na biblioteca e avisa as abas abertas. */
export async function saveCapture({ blob, type = '', url = '', pageUrl = '', pageTitle = '', fileName = 'imagem', source = 'context' }) {
  // Servidor sem tipo ou com tipo genérico (application/octet-stream)? Descobre pelos primeiros bytes.
  const declared = (blob?.type || type || '').split(';')[0].trim().toLowerCase();
  if (blob?.size && !declared.startsWith('image/')) {
    const sniffed = sniffImageType(new Uint8Array(await blob.slice(0, 256).arrayBuffer()));
    if (sniffed) { blob = blob.slice(0, blob.size, sniffed); type = sniffed; }
  }
  const mime = validateImage(blob, type);
  const db = await openDB();
  if (!db.objectStoreNames.contains(STORE)) throw new Error('Biblioteca de imagens indisponível. Recarregue a extensão para atualizar o banco local.');
  const record = {
    id: uid(),
    blob: blob.type === mime ? blob : blob.slice(0, blob.size, mime),
    type: mime,
    size: blob.size,
    url,
    pageUrl,
    pageTitle: String(pageTitle || '').slice(0, 300),
    fileName: String(fileName || 'imagem').slice(0, 160),
    source,
    capturedAt: Date.now(),
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Falha ao salvar a imagem.'));
  });
  // Outras abas recebem a mensagem; a própria página recebe o evento local.
  chrome.runtime.sendMessage({ type: 'imageCaptured', id: record.id }).catch(() => {});
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nt-image-captured', { detail: record.id }));
  return record;
}

/** Baixa uma imagem (o domínio já precisa estar autorizado) e salva na biblioteca. */
export async function downloadAndSave(sourceUrl, meta = {}) {
  const response = await fetch(sourceUrl, { credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('Não foi possível baixar a imagem (' + response.status + ').');
  if (Number(response.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) throw new Error('Imagem maior que 12 MB. Escolha uma versão menor.');
  const blob = await response.blob();
  let fileName = 'imagem';
  try { fileName = decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() || 'imagem'); } catch { /* mantém o padrão */ }
  return saveCapture({ ...meta, blob, type: response.headers.get('content-type') || '', url: sourceUrl, fileName });
}
