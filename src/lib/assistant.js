// NeuroTab — comandos de voz em português. Interpreta a frase e executa com a "api" recebida.
import { fold, parseReminder, fmtDateTime, displayTitle } from './brain.js';
import { parseDuration, fmtDur, startTimer, startPomo, addAlarm, pausePomo, stopPomo, resetTimer, stopSound } from './clock.js';
import { smartCalc } from './calc.js';
import { hostOf, normalizeUrl } from './store.js';

const strip = (s, re) => s.replace(re, '').trim();

// Remove a parte de data/hora da frase: "amanhã às 9h de pagar a conta" → "pagar a conta"
export function stripWhen(s) {
  const L = '(?<!\\p{L})';
  const R = '(?!\\p{L})';
  return s
    .replace(new RegExp(`${L}(à|a|as|às)\\s+\\d{1,2}(h|:)\\d{0,2}${R}`, 'giu'), ' ')
    .replace(new RegExp(`${L}(depois de amanhã|depois de amanha|amanhã|amanha|hoje)${R}`, 'giu'), ' ')
    .replace(new RegExp(`${L}\\d{1,2}(h|:)\\d{0,2}${R}`, 'giu'), ' ')
    .replace(new RegExp(`${L}em\\s+\\d+\\s*(min|minutos?|h|horas?)${R}`, 'giu'), ' ')
    .replace(new RegExp(`${L}dia\\s+\\d{1,2}${R}`, 'giu'), ' ')
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^(de|que|para|pra)\s+/i, '')
    .replace(/\s+(de|que|para|pra)$/i, '')
    .trim();
}

/** Retorna { reply, done } — reply é falado e mostrado. */
export async function runCommand(raw, api) {
  const text = raw.trim();
  const t = fold(text).replace(/[.!?]+$/, '');
  let m;

  // Parar som / alarme
  if (/^(parar|para|pare|desligar|silencio)( o)?( (som|alarme|despertador|timer))?$/.test(t)) {
    await stopSound();
    return { reply: 'Som parado.' };
  }

  // Lembretes e tarefas
  if ((m = t.match(/^(me )?(lembre|lembra|lembrar|lembrete|avise|avisa)\b/))) {
    const content = strip(text, /^(me\s+)?(lembre|lembra|lembrar|lembrete|avise|avisa)(-me)?\s*(de|que|para|pra)?\s*/i);
    const when = parseReminder(text) || parseReminder('me lembre ' + text);
    const clean = stripWhen(content) || content;
    await api.capture({ type: 'task', text: clean ? clean[0].toUpperCase() + clean.slice(1) : text, remindAt: when, source: 'voice' });
    return { reply: when ? `Combinado. Vou te lembrar ${fmtDateTime(when)}.` : 'Tarefa anotada. Não entendi o horário; você pode ajustar no item.' };
  }
  if ((m = t.match(/^(nova )?tarefa\b/))) {
    const content = strip(text, /^(nova\s+)?tarefa\s*:?\s*/i);
    await api.capture({ type: 'task', text: content, remindAt: parseReminder(content), source: 'voice' });
    return { reply: 'Tarefa adicionada.' };
  }
  if ((m = t.match(/^(anotar|anota|anote|nota|salvar nota|salva nota|ideia)\b/))) {
    const content = strip(text, /^(anotar|anota|anote|nota|salvar nota|salva nota|ideia)\s*:?\s*(que\s+)?/i);
    if (!content) return { reply: 'O que você quer anotar?' };
    await api.capture({ type: /^ideia/.test(t) ? 'idea' : 'note', text: content, source: 'voice' });
    return { reply: 'Anotado.' };
  }

  // Relógio
  if ((m = t.match(/^(iniciar |inicia |comecar |começar )?(um )?(timer|temporizador|cronometro de|contagem)( de| para)? (.+)$/))) {
    const ms = parseDuration(m[5].replace(/\bum\b/, '1').replace(/\buma\b/, '1').replace(/\bmeia hora\b/, '30 min'));
    if (!ms) return { reply: 'Não entendi a duração do timer.' };
    await startTimer(ms);
    return { reply: `Timer de ${fmtDur(ms)} iniciado.` };
  }
  if (/^(cancelar|zerar|parar) (o )?timer$/.test(t)) { await resetTimer(); return { reply: 'Timer cancelado.' }; }
  if (/^(iniciar |comecar |começar )?(o )?pomodoro|^(hora de )?focar$/.test(t)) { await startPomo(); return { reply: 'Pomodoro iniciado. Bom foco!' }; }
  if (/^pausar (o )?pomodoro$/.test(t)) { await pausePomo(); return { reply: 'Pomodoro pausado.' }; }
  if (/^parar (o )?pomodoro$/.test(t)) { await stopPomo(); return { reply: 'Pomodoro encerrado.' }; }
  if ((m = t.match(/^(criar |crie |colocar |coloque |por |me acorde|me acorda|despertador|alarme)(.*)$/)) && /despertador|alarme|acord/.test(t)) {
    const hm = t.match(/(\d{1,2})(?:h|:| horas?)\s*(\d{2})?/);
    if (!hm) return { reply: 'Para que horas?' };
    const time = `${String(hm[1]).padStart(2, '0')}:${hm[2] || '00'}`;
    const days = /todo dia|todos os dias/.test(t) ? [0, 1, 2, 3, 4, 5, 6] : /dias uteis|semana/.test(t) ? [1, 2, 3, 4, 5] : [];
    await addAlarm({ time, days, label: 'Despertador' });
    return { reply: `Despertador para ${time}${days.length ? ' (' + (days.length === 7 ? 'todos os dias' : 'dias úteis') + ')' : ''}.` };
  }

  // Informações
  if (/^(que horas sao|que hora e|horas|hora)$/.test(t)) {
    return { reply: `São ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` };
  }
  if (/^(que dia e hoje|qual a data|data de hoje|que dia e)$/.test(t)) {
    return { reply: `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}.` };
  }
  if (/(tempo|clima|previsao|temperatura|chover|chuva)/.test(t) && t.split(' ').length <= 7) {
    return { reply: await api.weatherText() };
  }
  if (/(dolar|euro|bitcoin|cotac|bolsa|acoes)/.test(t) && t.split(' ').length <= 6) {
    return { reply: await api.quotesText(t) };
  }
  if (/^(ler |leia |quais |o que )?(sao )?(minhas |as )?(tarefas|lembretes|pendencias|tenho (pra|para) hoje|agenda)( de hoje| pra hoje| para hoje)?$/.test(t)) {
    return { reply: api.tasksText() };
  }

  // Abrir sites
  if ((m = t.match(/^(abrir|abra|abre|ir para|vai para|acessar|entrar no|entrar na)\s+(o |a )?(.+)$/))) {
    const target = m[3].trim();
    const link = api.findLink(target);
    if (link) { api.open(link.url); return { reply: `Abrindo ${link.title}.` }; }
    if (/^[\w-]+(\.[\w-]+)+/.test(target.replace(/\s+ponto\s+/g, '.').replace(/\s/g, ''))) {
      const url = normalizeUrl(target.replace(/\s+ponto\s+/g, '.').replace(/\s/g, ''));
      api.open(url);
      return { reply: `Abrindo ${hostOf(url)}.` };
    }
    api.open(api.searchUrl(target + ' site oficial'));
    return { reply: `Não encontrei "${target}" nos atalhos. Pesquisando.` };
  }

  // Pesquisa
  if ((m = t.match(/^(pesquisar|pesquisa|pesquise|procurar|procura|buscar|busca|google)\s+(por\s+|sobre\s+)?(.+)$/))) {
    api.open(api.searchUrl(strip(text, /^(pesquisar|pesquisa|pesquise|procurar|procura|buscar|busca|google)\s+(por\s+|sobre\s+)?/i)));
    return { reply: 'Pesquisando.' };
  }

  // Contas e conversões
  if (/^(quanto e|quanto da|calcule|calcular|converter|converta)\b/.test(t) || /^\d[\d\s.,+\-x*/%]*(mais|menos|vezes|dividido|por cento|em)/.test(t)) {
    const expr = t
      .replace(/^(quanto e|quanto da|calcule|calcular|converter|converta)\s+/, '')
      .replace(/\bmais\b/g, '+').replace(/\bmenos\b/g, '-').replace(/\bvezes\b/g, '*').replace(/\bdividido por\b/g, '/')
      .replace(/\bpor cento\b/g, '%').replace(/\belevado a\b/g, '^').replace(/\braiz quadrada de\b/g, 'raiz');
    try {
      const r = await smartCalc(expr);
      return { reply: r.text.startsWith('=') ? r.text.slice(1).trim() : `Dá ${r.text}.` };
    } catch {
      /* cai na IA */
    }
  }

  // Perguntar às notas / IA
  if ((m = t.match(/^(perguntar|pergunta|pergunte|o que eu salvei|o que eu anotei|procure nas notas)\b/)) || api.aiReady()) {
    const q = strip(text, /^(perguntar|pergunta|pergunte)\s*(a|à|ao)?\s*(ia|cerebro|cérebro)?\s*:?\s*/i) || text;
    if (!api.aiReady()) return { reply: 'Configure a IA nas configurações para eu responder perguntas.' };
    const { answer } = await api.ask(q);
    return { reply: answer, long: true };
  }

  api.open(api.searchUrl(text));
  return { reply: `Pesquisando "${text}".` };
}

export function tasksSummary(items) {
  const now = Date.now();
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const pend = items.filter((i) => !i.done && (i.type === 'task' || i.remindAt));
  const late = pend.filter((i) => i.remindAt && i.remindAt < now);
  const today = pend.filter((i) => i.remindAt && i.remindAt >= now && i.remindAt <= end);
  if (!late.length && !today.length) return pend.length ? `Nada com horário para hoje. Você tem ${pend.length} tarefa(s) sem data.` : 'Você não tem tarefas pendentes. 🎉';
  const parts = [];
  if (late.length) parts.push(`${late.length} atrasada(s): ${late.slice(0, 3).map(displayTitle).join('; ')}`);
  if (today.length) parts.push(`para hoje: ${today.slice(0, 5).map((i) => `${displayTitle(i)} às ${new Date(i.remindAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`).join('; ')}`);
  return parts.join('. ') + '.';
}
