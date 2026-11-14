// NeuroTab — regras da palavra de ativação e do nome do assistente, sem depender da tela (testáveis).
import { fold } from './brain.js';

/** Jeitos como o reconhecimento de voz costuma escrever "NeuroTab" em pt/en/es. */
export const WAKE_VARIANTS = ['neurotab', 'neurotabe', 'neurotabi', 'neurotap', 'neurotabs', 'neuraltab', 'neurotav', 'newrotab', 'neurotabby', 'neurotape'];

const squash = (s) => fold(s).replace(/[^a-z0-9]/g, '');

/** Nome do assistente (Configurações → IA e voz); padrão "NeuroTab". */
export const assistantName = (settings = {}) => String(settings.assistantName || '').trim() || 'NeuroTab';

/** Frase de ativação em uso: a configurada ou, se vazia, o nome do assistente. */
export const wakePhraseOf = (settings = {}) => String(settings.wakePhrase || '').trim() || assistantName(settings);

/** Sugestões de frase a partir do nome ("Verônica", "Acorde Verônica", "Olá Verônica"). */
export function phraseSuggestions(name, lang = 'pt') {
  const n = String(name || '').trim() || 'NeuroTab';
  const w = { pt: ['Acorde', 'Olá'], en: ['Wake up', 'Hey'], es: ['Despierta', 'Hola'] }[lang] || ['Acorde', 'Olá'];
  return [n, `${w[0]} ${n}`, `${w[1]} ${n}`];
}

/** Formas aceitas para a frase escolhida (a padrão aceita as variações acima). */
export function wakeVariants(phrase = 'NeuroTab') {
  const p = squash(phrase || 'NeuroTab');
  return p === 'neurotab' ? WAKE_VARIANTS : [p];
}

/** Distância de edição (quantas letras trocar, pôr ou tirar). */
export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * O trecho ouvido "bate" com a frase? Exato, ou com poucos erros de reconhecimento
 * quando a frase é longa o bastante (≥ 6 letras: 1 erro; ≥ 11: 2 erros), como
 * "Berônica" por "Verônica" ou "acorda" por "acorde". Frases curtas (ex.: "Ana") só valem exatas.
 */
export function matchesWake(chunk, variants) {
  if (variants.includes(chunk)) return true;
  if (variants === WAKE_VARIANTS) return false; // a padrão já tem as variações conhecidas
  return variants.some((v) => v.length >= 6 && Math.abs(v.length - chunk.length) <= 2 && editDistance(chunk, v) <= (v.length >= 11 ? 2 : 1));
}

/**
 * Procura a palavra de ativação no que foi ouvido (juntando até 5 palavras: "neuro tab", "acorde verônica").
 * Devolve o que vem depois dela ('' se nada) ou null se ela não foi dita.
 */
export function afterWake(text, variants = WAKE_VARIANTS) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 5 && i + n <= words.length; n++) {
      if (matchesWake(squash(words.slice(i, i + n).join('')), variants)) {
        return words.slice(i + n).join(' ').replace(/^[\s,.:;!?]+/, '').trim();
      }
    }
  }
  return null;
}

/** "Cancelar", "esquece", "never mind"… (só a palavra de cancelar, sem outro pedido junto). */
export function isCancel(text) {
  const t = fold(text).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(cancelar|cancela|cancele|esquece|esqueca|deixa pra la|deixa|nada|cancel|never ?mind|forget it|nothing|stop|olvidalo|olvida|nada mas)$/.test(t);
}

/** Quanto tempo a escuta fica ligada sem uso (mínimo 1 minuto, padrão 10). */
export const wakeWindowMs = (minutes) => Math.max(1, +minutes || 10) * 60e3;

/** Quanto tempo esperar o comando depois da frase de ativação (3 a 30 s, padrão 8). */
export const commandWindowMs = (secs) => Math.min(30, Math.max(3, +secs || 8)) * 1000;

/**
 * A escuta contínua deve estar ligada agora?
 * Só com a função ativada, sem pausa/bloqueio, sem outra escuta em andamento,
 * com a nova aba visível e em foco, e dentro do prazo.
 */
export function shouldListen(s) {
  return !!(s.enabled && !s.paused && !s.blocked && !s.external && !s.busy && !s.session
    && s.visible && s.focused && s.now < s.until);
}

/**
 * Estado mostrado no indicador da escuta (#15):
 * off (desligada), waiting (aguardando a frase), listening (ouvindo o comando),
 * processing (executando), paused (pausada) ou error (microfone bloqueado/indisponível).
 */
export function wakeState({ enabled, blocked, rec, session, busy }) {
  if (!enabled) return 'off';
  if (blocked) return 'error';
  if (busy) return 'processing';
  if (session) return 'listening';
  return rec ? 'waiting' : 'paused';
}
