// Data Hub (#71): chaves de cada pessoa para as fontes de dados.
// Ficam em chrome.storage.local (nt_datahub_keys): não sincronizam e não vão no backup comum
// (só no backup com "incluir chaves", como as de IA). Uma extensão não protege segredos de verdade:
// use chaves criadas só para isto.

export const KEYS_KEY = 'nt_datahub_keys';
export const KEY_SOURCES = ['brapi', 'hg'];

const area = () => chrome.storage.local;

export async function getKeys() {
  const k = (await area().get(KEYS_KEY))[KEYS_KEY];
  return k && typeof k === 'object' ? k : {};
}

export async function setKey(src, value) {
  const keys = await getKeys();
  const v = String(value || '').trim();
  const changed = (keys[src] || '') !== v;
  if (v) keys[src] = v; else delete keys[src];
  await area().set({ [KEYS_KEY]: keys });
  if (changed) await area().remove('nt_cache_dh'); // chave nova: o que dependia do plano antigo é buscado de novo
  return keys;
}

// Antes da 0.9.2 o token da brapi ficava em settings (e sincronizava). Move para cá e limpa lá.
// Devolve true se mudou algo em `data` (quem chama salva).
export async function migrateBrapiToken(data) {
  const tok = data?.settings?.brapiToken;
  if (!tok) return false;
  const keys = await getKeys();
  if (!keys.brapi) { keys.brapi = tok; await area().set({ [KEYS_KEY]: keys }); }
  data.settings.brapiToken = '';
  return true;
}

// Para o backup com chaves (options): só o que existe.
export async function importKeys(obj, overwrite = true) {
  if (!obj || typeof obj !== 'object') return 0;
  const keys = await getKeys();
  let n = 0;
  for (const src of KEY_SOURCES) if (obj[src] && (overwrite || !keys[src])) { keys[src] = String(obj[src]); n++; }
  if (n) await area().set({ [KEYS_KEY]: keys });
  return n;
}
