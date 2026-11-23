// NeuroTab — Conversa por voz (0.8.2, #40): saudação, despedidas, relógio de silêncio e estados. Puro, sem DOM.

const lang2 = (lang) => (String(lang || 'pt').slice(0, 2).toLowerCase() === 'es' ? 'es' : String(lang || 'pt').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'pt');

export const GREETINGS = {
  pt: ['Olá, {nome}, em que posso ajudar?', 'Olá! Em que posso ajudar?'],
  en: ['Hi, {nome}, how can I help?', 'Hi! How can I help?'],
  es: ['Hola, {nome}, ¿en qué puedo ayudarte?', '¡Hola! ¿En qué puedo ayudarte?'],
};
export const FAREWELL = { pt: 'Até mais!', en: 'See you!', es: '¡Hasta luego!' };

const NAME_TAG = /\{\s*(nome|name|nombre)\s*\}/gi;

/** Frase falada ao ser chamado. settings: { userName, voiceGreeting }. */
export function greetingFor(settings = {}, lang = 'pt') {
  const l = lang2(lang);
  const name = String(settings.userName || '').trim().slice(0, 40);
  const custom = String(settings.voiceGreeting || '').trim().slice(0, 160);
  if (!custom) return name ? GREETINGS[l][0].replace(NAME_TAG, name) : GREETINGS[l][1];
  if (name) return custom.replace(NAME_TAG, name);
  // Sem nome cadastrado: tira o marcador e a vírgula/espaço em volta ("Olá, {nome}, tudo bem?" → "Olá, tudo bem?").
  return custom.replace(/\s*,?\s*\{\s*(nome|name|nombre)\s*\}\s*(?=[,.!?¿¡]|$)/gi, '').replace(/^\s*,\s*/, '').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim() || GREETINGS[l][1];
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Frases que encerram a conversa (o texto todo tem de ser a despedida, não "anotar obrigado ao João"). */
export const GOODBYES = [
  'obrigado', 'obrigada', 'muito obrigado', 'muito obrigada', 'valeu', 'pode parar', 'para', 'parar', 'tchau', 'ate mais', 'ate logo', 'encerrar', 'encerra', 'so isso', 'e so isso', 'era so isso', 'nada mais', 'pode ir', 'chega', 'fechar',
  'thanks', 'thank you', 'thank you very much', 'stop', 'bye', 'goodbye', 'bye bye', 'see you', 'that s all', 'thats all', 'nothing else', 'close',
  'gracias', 'muchas gracias', 'para', 'detente', 'adios', 'chao', 'hasta luego', 'eso es todo', 'nada mas', 'cerrar',
];
const FILLER = new Set(['ok', 'okay', 'ta', 'tá', 'bom', 'entao', 'certo', 'beleza', 'e', 'pronto', 'agora', 'por', 'hoje', 'enquanto', 'well', 'now', 'pues', 'vale', 'bueno', 'neurotab']);

export function isGoodbye(text, assistant = '') {
  let s = norm(text);
  if (!s) return false;
  const name = norm(assistant);
  if (name) s = s.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  const words = s.split(' ');
  if (words.length > 6) return false;
  for (const g of GOODBYES) {
    const gw = g.split(' ');
    for (let i = 0; i + gw.length <= words.length; i++) {
      if (words.slice(i, i + gw.length).join(' ') !== g) continue;
      const rest = [...words.slice(0, i), ...words.slice(i + gw.length)];
      if (rest.every((w) => FILLER.has(w) || GOODBYES.includes(w))) return true;
    }
  }
  return false;
}

export const SILENCE_CHOICES = [30, 60, 120];
export const silenceMs = (secs) => Math.min(300, Math.max(15, +secs || 60)) * 1000;

/**
 * Relógio de silêncio: kick() recomeça a contagem (a cada fala, inclusive parcial); pause() para de contar
 * enquanto o assistente pensa ou fala; onTimeout() é chamado uma vez quando o prazo vence.
 */
export function silenceClock(ms, onTimeout, { setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() } = {}) {
  let id = null;
  let deadline = 0;
  let done = false;
  const stopTimer = () => { if (id != null) clearTimer(id); id = null; };
  return {
    kick() {
      if (done) return;
      stopTimer();
      deadline = now() + ms;
      id = setTimer(() => { id = null; if (done) return; done = true; onTimeout(); }, ms);
    },
    pause() { stopTimer(); deadline = 0; },
    stop() { done = true; stopTimer(); },
    get running() { return id != null; },
    get remaining() { return id != null ? Math.max(0, deadline - now()) : null; },
    get expired() { return done; },
  };
}

/** Estados da tela de voz (também o que o visual desenha). */
export const VOICE_STATES = ['idle', 'wake', 'greeting', 'listening', 'thinking', 'speaking', 'error', 'closed'];
const NEXT = {
  idle: ['wake', 'greeting', 'listening', 'thinking', 'error', 'closed'],
  wake: ['greeting', 'listening', 'thinking', 'error', 'closed'],
  greeting: ['listening', 'thinking', 'error', 'closed'],
  listening: ['thinking', 'listening', 'error', 'closed'],
  thinking: ['speaking', 'listening', 'error', 'closed'],
  speaking: ['listening', 'closed', 'error'],
  error: ['closed', 'listening', 'idle'],
  closed: ['idle', 'wake', 'greeting', 'listening', 'thinking'],
};
/** Passa para o próximo estado; transição impossível mantém o atual (e devolve false em ok). */
export function step(state, to) {
  const ok = VOICE_STATES.includes(to) && (NEXT[state] || []).includes(to);
  return { state: ok ? to : state, ok };
}

/** Texto curto do estado para leitores de tela e para a tela. */
export const STATE_LABEL = {
  wake: 'Chamado', greeting: 'Falando', listening: 'Ouvindo', thinking: 'Pensando', speaking: 'Falando', error: 'Sem microfone', idle: '', closed: '',
};
