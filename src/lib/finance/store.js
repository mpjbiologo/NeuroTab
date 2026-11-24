// Finanças (#66): ler e salvar nt_finance (aberto ou no cofre), bloquear e desbloquear.
// Os dados ficam só neste computador (chrome.storage.local): não sincronizam,
// não entram no backup comum e não vão para a IA sem pedido.
import { FIN_KEY, sanitizeFinance, emptyFinance } from './model.js';
import { isSealed, sealWith, createVault, unlockVault, openWithKey } from './vault.js';

export const SESSION_KEY = 'nt_fin_key';
const local = () => chrome.storage.local;
const session = () => chrome.storage.session;

async function sessionKey() {
  const s = (await session().get(SESSION_KEY))[SESSION_KEY];
  if (!s?.key) return null;
  if (s.until && Date.now() > s.until) { await session().remove(SESSION_KEY); return null; }
  return s;
}

async function keepKey(key, lockMin) {
  await session().set({ [SESSION_KEY]: { key, lockMin, until: lockMin ? Date.now() + lockMin * 60e3 : 0 } });
}

// Renova o prazo do bloqueio automático (a pessoa está usando).
export async function touchVault() {
  const s = await sessionKey();
  if (s?.lockMin) await keepKey(s.key, s.lockMin);
}

// { state: 'open' | 'locked', vault: bool, fin }
export async function loadFinance() {
  const raw = (await local().get(FIN_KEY))[FIN_KEY];
  if (!raw) return { state: 'open', vault: false, fin: emptyFinance(), fresh: true };
  if (!isSealed(raw)) return { state: 'open', vault: false, fin: sanitizeFinance(raw) };
  const s = await sessionKey();
  if (!s) return { state: 'locked', vault: true, fin: null };
  try {
    return { state: 'open', vault: true, fin: sanitizeFinance(await openWithKey(raw, s.key)) };
  } catch {
    await session().remove(SESSION_KEY);
    return { state: 'locked', vault: true, fin: null };
  }
}

export class LockedError extends Error { constructor() { super('O cofre das finanças está bloqueado.'); this.code = 'locked'; } }

export async function saveFinance(fin) {
  const clean = sanitizeFinance(fin);
  const raw = (await local().get(FIN_KEY))[FIN_KEY];
  if (isSealed(raw)) {
    const s = await sessionKey();
    if (!s) throw new LockedError();
    await local().set({ [FIN_KEY]: await sealWith(clean, s.key, raw.salt, raw.iter) });
    if (s.lockMin) await keepKey(s.key, s.lockMin);
  } else {
    await local().set({ [FIN_KEY]: clean });
  }
  return clean;
}

// Lê, altera e salva de uma vez. fn(fin) devolve o novo fin.
export async function updateFinance(fn) {
  const cur = await loadFinance();
  if (cur.state !== 'open') throw new LockedError();
  return saveFinance(await fn(cur.fin));
}

export async function unlockFinance(password, lockMin = 15) {
  const raw = (await local().get(FIN_KEY))[FIN_KEY];
  if (!isSealed(raw)) return true;
  const { key } = await unlockVault(raw, password); // senha errada → WrongKeyError
  await keepKey(key, lockMin);
  return true;
}

export const lockFinance = () => session().remove(SESSION_KEY);

export async function enableVault(password, lockMin = 15) {
  const cur = await loadFinance();
  if (cur.state !== 'open') throw new LockedError();
  if (cur.vault) throw new Error('O cofre já está ligado.');
  const { record, key } = await createVault(sanitizeFinance(cur.fin), password);
  await local().set({ [FIN_KEY]: record });
  await keepKey(key, lockMin);
}

export async function disableVault(password) {
  const raw = (await local().get(FIN_KEY))[FIN_KEY];
  if (!isSealed(raw)) return;
  const { fin } = await unlockVault(raw, password);
  await local().set({ [FIN_KEY]: sanitizeFinance(fin) });
  await lockFinance();
}

export async function changeVaultPassword(oldPass, newPass, lockMin = 15) {
  const raw = (await local().get(FIN_KEY))[FIN_KEY];
  if (!isSealed(raw)) throw new Error('O cofre não está ligado.');
  const { fin } = await unlockVault(raw, oldPass);
  const { record, key } = await createVault(sanitizeFinance(fin), newPass);
  await local().set({ [FIN_KEY]: record });
  await keepKey(key, lockMin);
}

// Apaga tudo (dados e chave da sessão).
export async function wipeFinance() {
  await local().remove(FIN_KEY);
  await lockFinance();
}

// Backup próprio das finanças: com o cofre ligado, sai selado (só abre com a senha).
export async function exportFinance() {
  const raw = (await local().get(FIN_KEY))[FIN_KEY] || emptyFinance();
  return { format: 'neurotab-finance', v: 1, exportedAt: new Date().toISOString(), sealed: isSealed(raw), data: raw };
}

export async function importFinance(json) {
  if (!json || json.format !== 'neurotab-finance' || !json.data) throw new Error('Arquivo não reconhecido. Use um backup das finanças da NeuroTab.');
  await local().set({ [FIN_KEY]: isSealed(json.data) ? json.data : sanitizeFinance(json.data) });
  await lockFinance();
  return isSealed(json.data);
}

// Avisa quando os dados mudam (em outra aba) ou o cofre bloqueia/desbloqueia.
export function onFinanceChange(cb) {
  const fn = (changes, area) => {
    if ((area === 'local' && changes[FIN_KEY]) || (area === 'session' && changes[SESSION_KEY])) cb();
  };
  chrome.storage.onChanged.addListener(fn);
  return () => chrome.storage.onChanged.removeListener(fn);
}
