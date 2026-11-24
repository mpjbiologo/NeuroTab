// Atalhos de teclado da nova aba (#75): os módulos registram a ação; o registro em lib/hotkeys.js
// decide a combinação (a da pessoa ou a padrão) e ignora campos de texto quando precisa.
import { S } from './state.js';
import { bindHotkeys, hotkeyLabel } from '../lib/hotkeys.js';

export const HK = {};
export const registerHotkey = (id, fn) => { HK[id] = fn; };
export function setupKeys() {
  bindHotkeys(HK, () => S.data?.settings?.hotkeys || {});
}

// Troca "(Alt+C)" de um texto pelo atalho atual da ação (ou tira, se estiver desligado).
export function withKey(text, id, def) {
  const k = hotkeyLabel(S.data?.settings?.hotkeys || {}, id);
  return String(text).replace(`(${def})`, k ? `(${k})` : '').replace(/\s+$/, '');
}
