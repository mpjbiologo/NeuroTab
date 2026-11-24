// Atalhos de teclado da nova aba (0.9.2.1, #75): um registro só, editável em
// Configurações → Sistema → Teclado. A tecla é lida pela posição física (e.code),
// para funcionar no Mac (Alt+Z vira "Ω" em e.key) e em qualquer layout de teclado.

export const HOTKEY_ACTIONS = [
  { id: 'search', label: 'Ir para a busca', def: 'Ctrl+K', inFields: true },
  { id: 'searchSlash', label: 'Ir para a busca (tecla única)', def: '/' },
  { id: 'voice', label: 'Comando de voz', def: 'Alt+M', inFields: true },
  { id: 'chat', label: 'Modo conversa', def: 'Alt+C' },
  { id: 'meeting', label: 'Modo reunião', def: 'Alt+R' },
  { id: 'clean', label: 'Modo Clean', def: 'Alt+Z' },
  { id: 'dock', label: 'Mostrar a barra de atalhos (quando escondida)', def: 'Ctrl+.', inFields: true },
  { id: 'pagePrev', label: 'Página anterior', def: 'Alt+[' },
  { id: 'pageNext', label: 'Próxima página', def: 'Alt+]' },
  { id: 'pageN', label: 'Ir para a página 1 a 9', def: 'Alt+1…9', digits: true },
];

// Teclas do navegador e de programas comuns que costumam "roubar" a combinação.
export const RESERVED = {
  'Ctrl+T': 'nova aba do navegador', 'Ctrl+W': 'fechar aba', 'Ctrl+N': 'nova janela', 'Ctrl+L': 'barra de endereço', 'Ctrl+R': 'recarregar',
  'Ctrl+F': 'procurar na página', 'Ctrl+P': 'imprimir', 'Ctrl+S': 'salvar página', 'Ctrl+D': 'favoritar', 'Ctrl+H': 'histórico', 'Ctrl+J': 'downloads',
  'Ctrl+Shift+T': 'reabrir aba', 'Ctrl+Shift+N': 'janela anônima', 'Ctrl+Shift+I': 'ferramentas do desenvolvedor', 'Ctrl+Tab': 'trocar de aba',
  'Alt+←': 'voltar', 'Alt+→': 'avançar', 'Alt+Home': 'página inicial', 'Alt+D': 'barra de endereço', 'Alt+F': 'menu do navegador', 'Alt+E': 'menu do navegador',
  'Alt+F4': 'fechar a janela', 'F5': 'recarregar', 'F11': 'tela cheia', 'F12': 'ferramentas do desenvolvedor',
};
export const KNOWN_APPS = {
  'Alt+Z': 'painel da NVIDIA (GeForce Experience / NVIDIA App)', 'Alt+R': 'painel da AMD (Adrenalin)', 'Alt+F9': 'gravação da NVIDIA',
  'Alt+F10': 'replay da NVIDIA', 'Ctrl+Shift+M': 'Discord (microfone)', 'Alt+F1': 'NVIDIA / Windows', 'Ctrl+Alt+Delete': 'sistema',
};
for (let i = 1; i <= 9; i++) RESERVED[`Ctrl+${i}`] = `ir para a aba ${i}`;

const CODE_KEY = {
  BracketLeft: '[', BracketRight: ']', Period: '.', Comma: ',', Slash: '/', Minus: '-', Equal: '=', Semicolon: ';', Quote: "'",
  Backquote: '`', Backslash: '\\', IntlBackslash: '\\', IntlRo: '/', Space: 'Espaço', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete', Enter: 'Enter',
  NumpadDecimal: '.', NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '-', NumpadAdd: '+',
};

// Tecla (sem modificadores) de um evento: "Z", "1", "[", "F5", "←"…
export function keyOf(e) {
  const c = e.code || '';
  let m = c.match(/^Key([A-Z])$/);
  if (m) return m[1];
  m = c.match(/^(?:Digit|Numpad)(\d)$/);
  if (m) return m[1];
  if (/^F\d{1,2}$/.test(c)) return c;
  // Pontuação: vale o que está escrito na tecla (e.key) — no ABNT2 o "[" fica em outra posição física.
  // Se o Alt do Mac trocou o caractere ("“"), cai na posição física.
  if (/^[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]$/.test(e.key || '')) return e.key;
  if (CODE_KEY[c]) return CODE_KEY[c];
  const k = e.key || '';
  return k.length === 1 ? k.toUpperCase() : '';
}

const MODS = ['Ctrl', 'Alt', 'Shift'];
export function comboFromEvent(e) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'Tab', 'Escape', 'Backspace'].includes(e.key)) return '';
  const key = keyOf(e);
  if (!key) return '';
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

export function parseCombo(s) {
  const parts = String(s || '').split('+').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const key = parts.pop();
  const mods = new Set(parts);
  if ([...mods].some((m) => !MODS.includes(m)) || !key) return null;
  return { ctrl: mods.has('Ctrl'), alt: mods.has('Alt'), shift: mods.has('Shift'), key };
}
export const normalizeCombo = (s) => {
  const p = parseCombo(s);
  return p ? [p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', p.key].filter(Boolean).join('+') : '';
};

// O evento casa com a combinação? Tecla única sem modificador também aceita e.key ("/" em teclados ABNT).
export function matches(e, combo) {
  const p = parseCombo(combo);
  if (!p) return false;
  if (!!(e.ctrlKey || e.metaKey) !== p.ctrl || !!e.altKey !== p.alt) return false;
  const key = keyOf(e);
  if (key === p.key && !!e.shiftKey === p.shift) return true;
  if (CODE_KEY[e.code] === p.key && !!e.shiftKey === p.shift) return true; // posição física (Mac com Alt)
  // Sem Ctrl/Alt: "/" pode vir com Shift em alguns layouts.
  return !p.ctrl && !p.alt && !p.shift && (e.key || '').toUpperCase() === p.key;
}

// Atalho efetivo de cada ação (o da pessoa ou o padrão; '' = desligado).
export function effectiveHotkeys(custom = {}) {
  const out = {};
  for (const a of HOTKEY_ACTIONS) out[a.id] = a.digits ? (custom[a.id] === '' ? '' : custom[a.id] || 'Alt') : custom[a.id] != null ? custom[a.id] : a.def;
  return out;
}

export function sanitizeHotkeys(h) {
  const out = {};
  if (!h || typeof h !== 'object') return out;
  for (const a of HOTKEY_ACTIONS) {
    if (!(a.id in h)) continue;
    const v = h[a.id];
    if (v === '') { out[a.id] = ''; continue; }
    if (a.digits) { if (['Alt', 'Ctrl+Alt', 'Alt+Shift', 'Ctrl+Shift'].includes(v)) out[a.id] = v; continue; }
    const n = normalizeCombo(v);
    if (n) out[a.id] = n;
  }
  return out;
}

// Conflitos: entre ações (mesma combinação), com o navegador e com programas conhecidos.
export function conflictsFor(id, combo, custom = {}) {
  if (!combo) return [];
  const eff = effectiveHotkeys(custom);
  const out = [];
  for (const a of HOTKEY_ACTIONS) {
    if (a.id === id) continue;
    if (a.digits) {
      const m = combo.match(/^(.*)\+([1-9])$/);
      if (m && eff[a.id] && m[1] === eff[a.id]) out.push({ kind: 'action', text: `já usado em "${a.label}"` });
    } else if (eff[a.id] === combo) out.push({ kind: 'action', text: `já usado em "${a.label}"` });
  }
  if (RESERVED[combo]) out.push({ kind: 'browser', text: `o navegador usa para ${RESERVED[combo]}` });
  if (KNOWN_APPS[combo]) out.push({ kind: 'app', text: `costuma abrir o ${KNOWN_APPS[combo]}` });
  if (!/^(Ctrl|Alt)/.test(combo) && !/(^|\+)F\d/.test(combo)) out.push({ kind: 'typing', text: 'sem Ctrl ou Alt: só funciona fora dos campos de texto' });
  return out;
}

const editable = (t) => !!t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

/**
 * Liga os atalhos na página. handlers = { search: fn, clean: fn, pageN: (n) => …, … }.
 * getCustom() devolve settings.hotkeys (lido a cada tecla, para valer na hora).
 */
export function bindHotkeys(handlers, getCustom = () => ({})) {
  const fn = (e) => {
    if (e.repeat || e.isComposing) return;
    if (document.querySelector('.hk-capturing')) return; // gravando um atalho novo
    const eff = effectiveHotkeys(getCustom());
    const inField = editable(e.target);
    for (const a of HOTKEY_ACTIONS) {
      const h = handlers[a.id];
      const combo = eff[a.id];
      if (!h || !combo) continue;
      if (a.digits) {
        const m = keyOf(e).match(/^[1-9]$/);
        if (!m || !matches(e, `${combo}+${m[0]}`)) continue;
        if (inField) continue;
        e.preventDefault();
        h(Number(m[0]));
        return;
      }
      if (!matches(e, combo)) continue;
      const plain = !/^(Ctrl|Alt)/.test(combo);
      if (inField && (plain || !a.inFields)) continue;
      if (a.id === 'searchSlash' && document.querySelector('dialog[open]')) continue;
      e.preventDefault();
      h(e);
      return;
    }
  };
  document.addEventListener('keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}

// Texto curto para dicas na tela ("Alt+Z").
export const hotkeyLabel = (custom, id) => {
  const a = HOTKEY_ACTIONS.find((x) => x.id === id);
  const v = effectiveHotkeys(custom)[id];
  return !v ? '' : a?.digits ? `${v}+1…9` : v;
};
