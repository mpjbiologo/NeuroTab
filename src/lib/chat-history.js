// NeuroTab — Histórico do modo conversa por voz (0.8.3, #44). Puro, sem DOM.
// A IA recebe as últimas trocas inteiras e um resumo curto do que veio antes (custo baixo, contexto suficiente
// para "e amanhã?", "explica melhor", "e o segundo item?").

const plain = (s) => String(s || '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** Histórico novo. */
export const newHistory = () => ({ turns: [], summary: '', all: [], startedAt: Date.now() });

/**
 * Acrescenta uma troca. keep = quantas trocas vão inteiras; as mais antigas viram uma linha do resumo
 * (o resumo guarda as últimas `maxSummary` letras). `all` guarda tudo, para salvar a conversa como nota.
 */
export function addTurn(h, user, assistant, { keep = 6, maxSummary = 1500, at = Date.now() } = {}) {
  const u = plain(user);
  const a = plain(assistant);
  const out = { ...h, turns: [...h.turns, { user: cut(u, 800), assistant: cut(a, 1200) }], all: [...(h.all || []), { user: String(user || ''), assistant: String(assistant || ''), at }] };
  while (out.turns.length > keep) {
    const old = out.turns.shift();
    const line = `- ${cut(old.user, 140)} → ${cut(old.assistant, 200)}`;
    const sum = out.summary ? out.summary + '\n' + line : line;
    out.summary = sum.length > maxSummary ? '…' + sum.slice(sum.length - maxSummary + 1).replace(/^[^\n]*\n/, '\n').trimStart() : sum;
  }
  return out;
}

/** Mensagens para a IA (formato { role, content }). */
export function historyMessages(h) {
  if (!h) return [];
  const msgs = [];
  if (h.summary) {
    msgs.push({ role: 'user', content: `Resumo do começo desta conversa por voz (para contexto):\n${h.summary}` });
    msgs.push({ role: 'assistant', content: 'Entendido.' });
  }
  for (const t of h.turns) msgs.push({ role: 'user', content: t.user }, { role: 'assistant', content: t.assistant });
  return msgs;
}

/** Quantas mensagens a IA deve receber para não cortar o resumo. */
export const historyLimit = (h) => historyMessages(h).length;

/** Texto da nota "Conversa — data" (Markdown). */
export function conversationNote(h, { title = 'Conversa por voz', you = 'Você', assistant = 'Assistente', locale = 'pt-BR' } = {}) {
  const when = new Date(h.startedAt || Date.now());
  const head = `${title} — ${when.toLocaleDateString(locale)} ${when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
  const lines = (h.all || []).map((t) => `**${you}:** ${t.user}\n\n**${assistant}:** ${t.assistant}`);
  return `${head}\n\n${lines.join('\n\n')}`.trim();
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** "anota isso", "salva essa resposta", "save that"… → guardar a última resposta. */
export function isSaveThat(text) {
  return /^(ok |entao )?(anota|anote|anotar|salva|salve|salvar|guarda|guarde|guardar|grava|grave|save|note|keep|apunta|anota|guarda|guardar) (isso|isto|essa resposta|esta resposta|a resposta|that|this|that answer|eso|esto|esa respuesta)( (no cerebro|nas notas|in my notes|en mis notas))?$/.test(norm(text));
}

/** Pedidos para mudar de modo por voz: 'chat' | 'meeting' | null. */
export function modeRequest(text) {
  const s = norm(text);
  if (/^(ligar |ativar |abrir |iniciar |entrar no |turn on |start |activar |iniciar el )?(o )?(modo conversa|modo de conversa|conversation mode|chat mode|modo conversacion)$/.test(s)) return 'chat';
  if (/^(iniciar|comecar|abrir|ligar|ativar|start|begin|open|iniciar|empezar|comenzar)( (a|o|uma|um|the|a|la|una))? (reuniao|modo reuniao|meeting|meeting mode|reunion|modo reunion)$/.test(s) || /^modo (reuniao|reunion)$/.test(s) || s === 'meeting mode') return 'meeting';
  return null;
}
