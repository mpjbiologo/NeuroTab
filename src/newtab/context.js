// NeuroTab — Contexto entregue aos widgets (src/widgets/*): dados, configurações, cérebro e ações da nova aba.
import { saveData, faviconUrl } from '../lib/store.js';
import * as Brain from '../lib/brain.js';
import { isConfigured } from '../lib/ai.js';
import { toast } from '../lib/ui.js';
import { semanticOn, hybridSearch, embedConfig } from '../lib/semantic.js';
import { WIDGETS } from '../widgets/index.js';
import { S, bus } from './state.js';
import { openItemDialog } from './editor.js';
import { editLink } from './rail.js';


// ---------- Contexto entregue aos widgets ----------
export const ctx = {
  get data() { return S.data; },
  get settings() { return S.data.settings; },
  get items() { return S.items; },
  brain: Brain,
  toast,
  async saveSettings(patch) {
    Object.assign(S.data.settings, patch);
    await saveData(S.data);
  },
  /** Assina um evento do barramento (lib/events.js); devolve a função para cancelar. */
  on: (evt, fn) => bus.on(evt, fn),
  openItem: (it) => openItemDialog(it),
  newItem: (p) => openItemDialog(null, p),
  async capture(p) {
    const it = await Brain.addItem(p);
    S.items = await Brain.loadItems();
    if (S.data.settings.ai.autoEnrich && isConfigured(S.data.settings)) {
      chrome.runtime.sendMessage({ type: 'enrich', id: it.id }).catch(() => {});
    }
    return it;
  },
  aiReady: () => isConfigured(S.data.settings),
  semanticOn: () => semanticOn(S.data.settings) && embedConfig(S.data.settings).supported,
  smartSearch: (q, limit = 20, list = S.items) => hybridSearch(S.data.settings, list, q, limit),
  openLinkDialog: (link, preset) => editLink(link, preset),
  faviconFor: (l) => l.favicon || faviconUrl(l.url),
  openSettings: (hash = '') => { location.href = 'options.html' + hash; },
  /** Trechos de dados dos widgets para o cérebro (contrato brainContext, docs/dev/WIDGETS.md). */
  brainExtras: (question) => brainExtras(question),
};

/** Junta o que cada widget oferece ao cérebro para esta pergunta (mesmo sem o widget na tela). */
export function brainExtras(question) {
  const out = [];
  for (const def of Object.values(WIDGETS)) {
    if (typeof def.brainContext !== 'function') continue;
    try { const x = def.brainContext(S.data.settings, question); if (x?.text) out.push(x); } catch (e) { console.error('NeuroTab: brainContext de', def.id, e); }
  }
  return out;
}
