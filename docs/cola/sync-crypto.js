// NeuroTab — criptografia da sincronização (#27).
// Com senha: a chave sai da senha (PBKDF2-SHA256, 600 mil rodadas) e cifra com AES-GCM 256 antes de sair do
// computador. O serviço (Google Drive) guarda só o envelope cifrado e não consegue ler.
// Sem senha: o envelope vai com o conteúdo legível (a pessoa escolheu a opção mais simples).
const enc = new TextEncoder();
const dec = new TextDecoder();
export const KDF_ITERATIONS = 600_000;

const b64 = (bytes) => { let s = ''; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

/** Deriva a chave da senha. Devolve a chave em base64 (para guardar só neste navegador). */
export async function deriveKey(passphrase, saltB64, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations }, base, 256);
  return b64(bits);
}

const aes = (rawB64, use) => crypto.subtle.importKey('raw', unb64(rawB64), 'AES-GCM', false, [use]);

/** Cifra um objeto. keyB64 vazio = sem senha (envelope legível). */
export async function seal(obj, keyB64) {
  const json = JSON.stringify(obj);
  if (!keyB64) return { v: 1, alg: 'none', data: json };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(keyB64, 'encrypt'), enc.encode(json));
  return { v: 1, alg: 'A256GCM', iv: b64(iv), ct: b64(ct) };
}

export class WrongKeyError extends Error { constructor() { super('Senha de sincronização incorreta.'); this.code = 'wrong_key'; } }

/** Abre um envelope. Senha errada → WrongKeyError. */
export async function open(env, keyB64) {
  if (!env || env.v !== 1) throw new Error('Arquivo de sincronização em formato desconhecido.');
  if (env.alg === 'none') return JSON.parse(env.data);
  if (!keyB64) throw new WrongKeyError();
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await aes(keyB64, 'decrypt'), unb64(env.ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new WrongKeyError();
  }
}

/** Impressão curta e estável de um valor (para saber se um registro mudou desde a última sincronização). */
export async function digest(value) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(stableStringify(value)));
  return b64(h).slice(0, 22);
}

export function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}
