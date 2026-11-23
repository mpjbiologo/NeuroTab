// NeuroTab — erros da IA com código (0.8.0, #7). Toda falha de provedor vira um AIError com um destes códigos,
// para a interface explicar o que houve e o roteador decidir se pode usar a Reserva.
export const AI_ERRORS = {
  config: 'Configure a IA em Configurações → IA.',
  offline: 'Não foi possível conectar ao provedor de IA. Verifique a internet, o endereço e a permissão de acesso.',
  auth: 'Chave de API recusada.',
  limit: 'Limite de uso atingido no provedor. Tente de novo em instantes.',
  missing: 'O modelo não existe neste servidor.',
  unsupported: 'O modelo escolhido não sabe fazer isso.',
  invalid: 'A IA respondeu em formato inesperado.',
  server: 'O servidor de IA está com problema agora.',
  consent: 'A IA principal falhou e a Reserva fica na internet.',
  failed: 'A IA não conseguiu responder.',
};

/** Falhas em que vale tentar a Reserva (a principal pode voltar depois; não é culpa do pedido). */
export const RETRYABLE = new Set(['offline', 'limit', 'server', 'missing']);

export class AIError extends Error {
  constructor(code, message = '', extra = {}) {
    super(message || AI_ERRORS[code] || AI_ERRORS.failed);
    this.name = 'AIError';
    this.code = AI_ERRORS[code] ? code : 'failed';
    Object.assign(this, extra);
  }
}

/** Código a partir do status HTTP da resposta do provedor. */
export function codeFromStatus(status, msg = '') {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'limit';
  if (status === 404 || /model.*(not found|does not exist|unknown)|no such model|not_found/i.test(msg)) return 'missing';
  if (status >= 500) return 'server';
  if (/image|vision|multimodal|modalit|does not support|not support/i.test(msg)) return 'unsupported';
  return 'failed';
}
