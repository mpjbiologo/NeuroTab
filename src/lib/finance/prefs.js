// Finanças (#66): preferências (ficam em settings.finance e sincronizam como as outras;
// os dados financeiros em si NÃO sincronizam).
import { CURRENCIES } from './money.js';

export const DEFAULT_FINANCE = {
  currency: 'BRL', // moeda principal
  discreet: false, // modo discreto: valores escondidos (••••) até tocar no olho
  lockMin: 15, // cofre: bloqueia depois de X minutos sem uso (0 = só ao fechar o navegador)
  remind: true, // lembrar contas a pagar (notificação)
  remindHour: 9, // hora do lembrete
  mailHint: true, // e-mail com "fatura"/"vencimento" no assunto vira aviso no widget
  widgetBills: 3, // quantas contas a pagar o widget mostra
  vaultAsked: false, // já sugeriu o cofre no primeiro uso
};

export function sanitizeFinancePrefs(p) {
  const s = { ...DEFAULT_FINANCE, ...(p && typeof p === 'object' ? p : {}) };
  const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  return {
    currency: CURRENCIES.includes(s.currency) ? s.currency : 'BRL',
    discreet: !!s.discreet,
    lockMin: n(s.lockMin, 0, 240, 15),
    remind: s.remind !== false,
    remindHour: n(s.remindHour, 0, 23, 9),
    mailHint: s.mailHint !== false,
    widgetBills: n(s.widgetBills, 0, 8, 3),
    vaultAsked: !!s.vaultAsked,
  };
}
