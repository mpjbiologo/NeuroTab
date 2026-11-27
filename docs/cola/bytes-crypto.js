// NeuroTab — cifrar arquivos (fotos, vídeos, áudios) antes de sair do aparelho (0.9.3.2, #80).
// Mesmo esquema da área de transferência: AES-GCM 256 com a chave da sincronização (nuvem) ou a do
// canal do ntfy (que só vai no QR). Formato: "NTB1" + iv (12 bytes) + texto cifrado (com a etiqueta GCM).
// Este arquivo é copiado igual em docs/cola/ (a página do celular); um teste confere.
const MAGIC = [0x4e, 0x54, 0x42, 0x31]; // "NTB1"
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const aes = (keyB64, use) => crypto.subtle.importKey('raw', unb64(keyB64), 'AES-GCM', false, [use]);

export class WrongFileKeyError extends Error { constructor() { super('Não consegui abrir o arquivo (chave diferente).'); this.code = 'wrong_key'; } }

/** Cifra bytes. keyB64 vazio = sem cifra (devolve os mesmos bytes). */
export async function sealBytes(bytes, keyB64) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!keyB64) return data;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(keyB64, 'encrypt'), data));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

export const isSealed = (bytes) => bytes.length > 16 && MAGIC.every((b, i) => bytes[i] === b);

/** Abre bytes cifrados por sealBytes. Sem "NTB1" no começo, devolve como veio (arquivo sem cifra). */
export async function openBytes(bytes, keyB64) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isSealed(data)) return data;
  if (!keyB64) throw new WrongFileKeyError();
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(4, 16) }, await aes(keyB64, 'decrypt'), data.subarray(16)));
  } catch {
    throw new WrongFileKeyError();
  }
}
