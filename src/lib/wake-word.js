// NeuroTab — regras da palavra de ativação, sem depender da tela (testáveis).
import { fold } from './brain.js';

/** Jeitos como o reconhecimento de voz costuma escrever "NeuroTab" em pt/en/es. */
export const WAKE_VARIANTS = ['neurotab', 'neurotabe', 'neurotabi', 'neurotap', 'neurotabs', 'neuraltab', 'neurotav', 'newrotab', 'neurotabby', 'neurotape'];

const squash = (s) => fold(s).replace(/[^a-z0-9]/g, '');

/** Formas aceitas para a frase escolhida (a padrão aceita as variações acima). */
export function wakeVariants(phrase = 'NeuroTab') {
  const p = squash(phrase || 'NeuroTab');
  return p === 'neurotab' ? WAKE_VARIANTS : [p];
}

/**
 * Procura a palavra de ativação no que foi ouvido (juntando até 3 palavras: "neuro tab").
 * Devolve o que vem depois dela ('' se nada) ou null se ela não foi dita.
 */
export function afterWake(text, variants = WAKE_VARIANTS) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      if (variants.includes(squash(words.slice(i, i + n).join('')))) {
        return words.slice(i + n).join(' ').replace(/^[\s,.:;!?]+/, '').trim();
      }
    }
  }
  return null;
}

/** Quanto tempo a escuta fica ligada sem uso (mínimo 1 minuto, padrão 10). */
export const wakeWindowMs = (minutes) => Math.max(1, +minutes || 10) * 60e3;

/**
 * A escuta contínua deve estar ligada agora?
 * Só com a função ativada, sem pausa/bloqueio, sem outra escuta em andamento,
 * com a nova aba visível e em foco, e dentro do prazo.
 */
export function shouldListen(s) {
  return !!(s.enabled && !s.paused && !s.blocked && !s.external && !s.busy && !s.session
    && s.visible && s.focused && s.now < s.until);
}
