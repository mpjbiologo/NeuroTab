// Finanças (#66): cofre opcional com senha.
// A chave sai da senha (PBKDF2-SHA256, 600 mil rodadas) e cifra com AES-GCM 256,
// reaproveitando sync-crypto.js. Guardado em chrome.storage.local fica só o envelope;
// a chave vive em chrome.storage.session (memória do navegador, some ao fechar)
// e expira sozinha depois de X minutos sem uso.
import { deriveKey, newSalt, seal, open, KDF_ITERATIONS } from '../sync-crypto.js';

export const isSealed = (raw) => !!(raw && raw.sealed === true && raw.env && raw.salt);

export async function sealWith(fin, key, salt, iter = KDF_ITERATIONS) {
  return { sealed: true, salt, iter, env: await seal(fin, key) };
}

// Liga o cofre: devolve { record, key } (record vai para o storage.local).
export async function createVault(fin, password, iter = KDF_ITERATIONS) {
  if (!password || password.length < 6) throw new Error('A senha do cofre precisa de pelo menos 6 caracteres.');
  const salt = newSalt();
  const key = await deriveKey(password, salt, iter);
  return { record: await sealWith(fin, key, salt, iter), key };
}

// Abre com a senha: devolve { fin, key }. Senha errada → WrongKeyError (code 'wrong_key').
export async function unlockVault(record, password) {
  const key = await deriveKey(password, record.salt, record.iter || KDF_ITERATIONS);
  return { fin: await open(record.env, key), key };
}

// Abre com a chave já derivada (que está na sessão).
export const openWithKey = (record, key) => open(record.env, key);
