// Ambiente dos testes de unidade: um chrome.* falso em memória e interface em português.
import { setLang } from '../../src/lib/i18n.js';

export const memory = {};
export function resetStorage(init = {}) {
  for (const k of Object.keys(memory)) delete memory[k];
  Object.assign(memory, structuredClone(init));
}

const pick = (keys) => {
  if (keys == null) return structuredClone(memory);
  const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
  return Object.fromEntries(list.filter((k) => k in memory).map((k) => [k, structuredClone(memory[k])]));
};

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => pick(keys),
      set: async (obj) => { Object.assign(memory, structuredClone(obj)); },
      remove: async (keys) => { for (const k of [].concat(keys)) delete memory[k]; },
    },
    onChanged: { addListener() {} },
  },
  runtime: { sendMessage: async () => {}, getManifest: () => ({ version: '0.0.0' }), getURL: (p) => 'chrome-extension://test/' + p },
  alarms: { create() {}, clear: async () => true, get: async () => null },
  permissions: { contains: async () => true, request: async () => true, remove: async () => true, getAll: async () => ({ origins: [] }) },
};

setLang('pt-BR');
