// NeuroTab — estado compartilhado da nova aba.
import { createBus } from '../lib/events.js';
// Variáveis que várias partes leem e alteram ficam em S (ex.: S.data, S.items, S.editing).

export const S = {
  data: undefined, // configurações, grupos e atalhos (chrome.storage)
  items: [], // itens do cérebro
  activeId: undefined, // grupo aberto na barra de atalhos
  bgCache: null,
  drag: null, // { type: 'link' | 'group' | 'widget', id } enquanto algo é arrastado
  editing: false,
  mounted: [], // widgets montados: [{ id, destroy }]
  widgetsSig: '',
  gridCols: 12,
  zTop: 10,
  voiceSession: null, // reconhecimento de voz em andamento
};

export const EMOJIS = ['🏠','⭐','📁','🚀','🎓','💲','💼','🤖','🎮','📚','🍺','🥗','🎬','🎵','🛒','💻','🔗','🧪','🧬','📰','✈️','⚙️','❤️','📷'];
// Relógio e busca: referências fixas (no modo livre eles mudam de lugar no DOM).
export const heroEl = document.getElementById('hero');
export const omniEl = document.getElementById('omniWrap');
/** Barramento de eventos da nova aba (lib/events.js). Widgets assinam via ctx.on(). */
export const bus = createBus();
