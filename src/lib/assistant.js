// NeuroTab — comandos de voz em português, inglês e espanhol.
// Cada idioma tem um "léxico" (expressões de cada comando); o motor abaixo é o mesmo para todos.
// Se nada bater e houver IA configurada, a própria IA interpreta a frase.
// As respostas são escritas em português e traduzidas para o idioma da interface (i18n).
import { fold, parseReminder, fmtDateTime, displayTitle } from './brain.js';
import { parseDuration, fmtDur, startTimer, startPomo, addAlarm, pausePomo, stopPomo, resetTimer, stopSound } from './clock.js';
import { smartCalc } from './calc.js';
import { hostOf, normalizeUrl } from './store.js';
import { tIn } from './i18n.js';

const strip = (s, re) => s.replace(re, '').trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------- Números por extenso (para durações) ----------
const NUMS = {
  pt: { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60 },
  en: { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 },
  es: { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60 },
};
function wordsToDigits(t, lang, noArticles = false) {
  let s = t
    .replace(/\b(uma hora e meia|an hour and a half|one and a half hours?|una hora y media|hora y media)\b/g, '90 min')
    .replace(/\b(meia hora|half an hour|half hour|media hora)\b/g, '30 min');
  const map = NUMS[lang] || {};
  const articles = new Set(['a', 'an', 'um', 'uma', 'un', 'una']);
  s = s.replace(/\b[a-z]+\b/g, (w) => (map[w] != null && !(noArticles && articles.has(w)) ? String(map[w]) : w));
  return s;
}

// Hora de um despertador: "6h30", "6:30", "6 am", "às 6", "at 6 pm", "a las 6 y media" → [h, m]
function parseClock(t) {
  let m = t.match(/\b(\d{1,2})(?:h|:)(\d{2})?\s*(am|pm|a\.m\.?|p\.m\.?)?/)
    || t.match(/\b(\d{1,2})\s*(?:horas?\s*)?()(am|pm|a\.m\.?|p\.m\.?)/)
    || t.match(/\b(?:as|a|at|for|para|a las|para las|to)\s+(\d{1,2})()(?:\s*(?:horas?|o'?clock))?\s*(am|pm)?\b/);
  if (!m) return null;
  let h = +m[1];
  let min = m[2] ? +m[2] : /\b(e meia|y media|thirty)\b/.test(t) ? 30 : 0;
  if (m[3] && /^p/.test(m[3]) && h < 12) h += 12;
  if (m[3] && /^a/.test(m[3]) && h === 12) h = 0;
  if (!m[3] && /\b(da noite|da tarde|de la noche|de la tarde|in the evening|at night|pm)\b/.test(t) && h < 12) h += 12;
  return [h, min];
}

// ---------- Léxicos ----------
// Todas as expressões trabalham sobre o texto "dobrado" (minúsculo, sem acentos), exceto as de `strip`,
// que removem o comando do texto original para preservar acentos do conteúdo.
const LEX = {
  pt: {
    code: 'pt',
    stop: /^(parar|para|pare|desligar|silencio)( o)?( (som|alarme|despertador|timer))?$/,
    remind: /^(me )?(lembre|lembra|lembrar|lembrete|avise|avisa)\b/,
    remindStrip: /^(me\s+)?(lembre|lembra|lembrar|lembrete|avise|avisa)(-me)?\s*((de|que|para|pra)\s+)?/i,
    task: /^(nova )?tarefa\b/,
    taskStrip: /^(nova\s+)?tarefa\s*:?\s*/i,
    note: /^(anotar|anota|anote|nota|salvar nota|salva nota|ideia)\b/,
    noteStrip: /^(anotar|anota|anote|nota|salvar nota|salva nota|ideia)(?!\p{L})\s*:?\s*(que\s+)?/iu,
    idea: /^ideia/,
    timer: /^(iniciar |inicia |comecar |começar )?(um )?(timer|temporizador|cronometro de|contagem)( de| para)? (.+)$/,
    timerCancel: /^(cancelar|zerar|parar) (o )?timer$/,
    pomoStart: /^(iniciar |comecar )?(o )?pomodoro$|^(hora de )?focar$/,
    pomoPause: /^pausar (o )?pomodoro$/,
    pomoStop: /^parar (o )?pomodoro$/,
    alarm: /despertador|alarme|me acord/,
    everyDay: /todo dia|todos os dias/,
    weekdays: /dias uteis|semana/,
    time: /^(que horas sao|que hora e|horas|hora)$/,
    date: /^(que dia e hoje|qual a data|data de hoje|que dia e)$/,
    weather: /(tempo|clima|previsao|temperatura|chover|chuva)/,
    quotes: /(dolar|euro|bitcoin|cotac|bolsa|acoes)/,
    tasks: /^(ler |leia |quais |o que )?(sao )?(minhas |as )?(tarefas|lembretes|pendencias|tenho (pra|para) hoje|agenda)( de hoje| pra hoje| para hoje)?$/,
    // Frases livres: "me diga aí, o que que eu tenho que fazer?", "o que tenho pra hoje", "quais são minhas pendências"
    tasksAsk: /\b(o que|oque)( que)? (eu )?(tenho|preciso|devo) (que |de |pra |para )?(fazer|resolver)\b|\b(o que|oque)( que)? (eu )?tenho (pra|para) hoje\b|\b(minhas|quais (sao )?(as |minhas )?)(tarefas|pendencias|lembretes)\b|\bminha agenda\b|\bo que tem (pra|para) hoje\b/,
    route: /^(rota|ir|como chegar|navegar|transito)\s+(para|pro|pra|ate|ao|a|na|no|em)\s+(o |a )?(.+)$/,
    open: /^(abrir|abra|abre|ir para|vai para|acessar|entrar no|entrar na)\s+(o |a )?(.+)$/,
    search: /^(pesquisar|pesquisa|pesquise|procurar|procura|buscar|busca|google)\s+(por\s+|sobre\s+)?(.+)$/,
    searchStrip: /^(pesquisar|pesquisa|pesquise|procurar|procura|buscar|busca|google)\s+(por\s+|sobre\s+)?/i,
    calc: /^(quanto e|quanto da|calcule|calcular|converter|converta)\b|^\d[\d\s.,+\-x*/%]*(mais|menos|vezes|dividido|por cento|em)/,
    calcStrip: /^(quanto e|quanto da|calcule|calcular|converter|converta)\s+/,
    calcWords: [[/\bmais\b/g, '+'], [/\bmenos\b/g, '-'], [/\bvezes\b/g, '*'], [/\bdividido por\b/g, '/'], [/\bpor cento\b/g, '%'], [/\belevado a\b/g, '^'], [/\braiz quadrada de\b/g, 'raiz']],
    ask: /^(perguntar|pergunta|pergunte|o que eu salvei|o que eu anotei|procure nas notas)\b/,
    askStrip: /^(perguntar|pergunta|pergunte)\s*(a|à|ao)?\s*(ia|cerebro|cérebro)?\s*:?\s*/i,
    dot: /\s+ponto\s+/g,
    question: /\?$|^(o que|qual|quais|quem|quando|onde|como|por que|porque|quanto)\b/,
    officialSite: ' site oficial',
  },
  en: {
    code: 'en',
    stop: /^(stop|silence|quiet|turn off|shut up)( the)?( (sound|alarm|timer|music))?$/,
    remind: /^(remind me|reminder|set a reminder|alert me)\b/,
    remindStrip: /^(remind\s+me|reminder|set\s+a\s+reminder|alert\s+me)\s*((to|that|about|of)\s+)?/i,
    task: /^(new task|add (a )?task|task)\b/,
    taskStrip: /^(new\s+task|add\s+(a\s+)?task|task)\s*:?\s*/i,
    note: /^(note|take a note|make a note|write down|jot down|save note|idea)\b/,
    noteStrip: /^(take\s+a\s+note|make\s+a\s+note|write\s+down|jot\s+down|save\s+note|note|idea)(?!\p{L})\s*:?\s*(that\s+)?/iu,
    idea: /^idea/,
    timer: /^(start |set )?(a )?(timer|countdown)( for| of)? (.+)$/,
    timerCancel: /^(cancel|stop|reset|clear) (the )?timer$/,
    pomoStart: /^(start )?(a |the )?pomodoro$|^(time to )?focus$/,
    pomoPause: /^pause (the )?pomodoro$/,
    pomoStop: /^stop (the )?pomodoro$/,
    alarm: /alarm|wake me/,
    everyDay: /every ?day|daily/,
    weekdays: /weekdays|week days|workdays|monday to friday/,
    time: /^(what time is it|what's the time|whats the time|what is the time|time)$/,
    date: /^(what day is (it )?today|what's the date|whats the date|what is the date|today's date|todays date|what day is it)$/,
    weather: /(weather|forecast|temperature|rain|raining|sunny)/,
    quotes: /(dollar|euro|bitcoin|exchange rate|stock|quotes?)/,
    tasks: /^(read |what are )?(my )?(tasks|reminders|to ?dos|agenda)( for today| today)?$|^what do i have (to do )?today$/,
    tasksAsk: /\bwhat (do|should|must|will) i (have|need|got)? ?to do\b|\bwhat do i have (to do )?today\b|\bwhat('?s| is) on my (list|agenda|plate|schedule)\b|\b(my|read my|list my) (tasks|to ?dos|reminders)\b/,
    route: /^(route|directions|navigate|go|take me|drive|how do i get)\s+(to|home)\s*(the )?(.*)$/,
    open: /^(open|go to|launch|visit|show me)\s+(the )?(.+)$/,
    search: /^(search|search for|google|look up|find on the web)\s+(for\s+|about\s+)?(.+)$/,
    searchStrip: /^(search(\s+for)?|google|look\s+up|find\s+on\s+the\s+web)\s+(for\s+|about\s+)?/i,
    calc: /^(what is|what's|whats|how much is|calculate|convert)\b|^\d[\d\s.,+\-x*/%]*(plus|minus|times|divided|percent|to|in)/,
    calcStrip: /^(what is|what's|whats|how much is|calculate|convert)\s+/,
    calcWords: [[/\bplus\b/g, '+'], [/\bminus\b/g, '-'], [/\b(times|multiplied by)\b/g, '*'], [/\bdivided by\b/g, '/'], [/\bpercent\b/g, '%'], [/\bto the power of\b/g, '^'], [/\bsquare root of\b/g, 'raiz'], [/\bof\b/g, 'de'], [/\b(to|in)\b/g, 'em']],
    ask: /^(ask|what did i (save|note|write)|search my notes)\b/,
    askStrip: /^ask\s*(the)?\s*(ai|brain)?\s*:?\s*/i,
    dot: /\s+dot\s+/g,
    question: /\?$|^(what|which|who|when|where|how|why|is|are|do|does|did|can)\b/,
    officialSite: ' official site',
  },
  es: {
    code: 'es',
    stop: /^(parar|para|detener|deten|silencio|apagar|callate)( el| la)?( (sonido|alarma|despertador|temporizador))?$/,
    remind: /^(recuerdame|recordarme|recordatorio|avisame|recuerda)\b/,
    remindStrip: /^(recu[eé]rdame|recordarme|recordatorio|av[ií]same|recuerda)\s*((de|que|para)\s+)?/i,
    task: /^(nueva tarea|anadir tarea|tarea)\b/,
    taskStrip: /^(nueva\s+tarea|a[nñ]adir\s+tarea|tarea)\s*:?\s*/i,
    note: /^(anotar|anota|apunta|apuntar|nota|guardar nota|idea)\b/,
    noteStrip: /^(anotar|anota|apuntar|apunta|guardar\s+nota|nota|idea)(?!\p{L})\s*:?\s*(que\s+)?/iu,
    idea: /^idea/,
    timer: /^(iniciar |inicia |pon |poner |empezar )?(un )?(temporizador|timer|cuenta atras)( de| para| por)? (.+)$/,
    timerCancel: /^(cancelar|detener|parar|quitar) (el )?(temporizador|timer)$/,
    pomoStart: /^(iniciar |empezar )?(el |un )?pomodoro$|^(hora de )?concentrarme$/,
    pomoPause: /^pausar (el )?pomodoro$/,
    pomoStop: /^(parar|detener) (el )?pomodoro$/,
    alarm: /alarma|despertador|despiertame/,
    everyDay: /todos los dias|cada dia/,
    weekdays: /dias laborables|entre semana|de lunes a viernes/,
    time: /^(que hora es|la hora|hora)$/,
    date: /^(que dia es hoy|cual es la fecha|fecha de hoy|que fecha es hoy|que dia es)$/,
    weather: /(tiempo|clima|pronostico|temperatura|llover|lluvia)/,
    quotes: /(dolar|euro|bitcoin|cotizacion|bolsa|acciones)/,
    tasks: /^(leer |lee |cuales son |que )?(son )?(mis )?(tareas|recordatorios|pendientes|agenda|tengo (para )?hoy)( de hoy| para hoy)?$/,
    tasksAsk: /\bque (tengo|debo|necesito) (que |de )?hacer\b|\bque tengo (para |pa )?hoy\b|\b(mis|cuales son (mis )?)(tareas|pendientes|recordatorios)\b|\bmi agenda\b/,
    route: /^(ruta|ir|como llegar|navegar|trafico)\s+(a|al|hacia|hasta|para)\s+(el |la |mi )?(.+)$/,
    open: /^(abrir|abre|ir a|entrar en|acceder a)\s+(el |la )?(.+)$/,
    search: /^(buscar|busca|busque|google)\s+(por\s+|sobre\s+)?(.+)$/,
    searchStrip: /^(buscar|busca|busque|google)\s+(por\s+|sobre\s+)?/i,
    calc: /^(cuanto es|cuanto da|calcula|calcular|convertir|convierte)\b|^\d[\d\s.,+\-x*/%]*(mas|menos|por|dividido|entre|en)/,
    calcStrip: /^(cuanto es|cuanto da|calcula|calcular|convertir|convierte)\s+/,
    calcWords: [[/\bpor ciento\b/g, '%'], [/\bdividido (por|entre)\b/g, '/'], [/\bmultiplicado por\b/g, '*'], [/\bmas\b/g, '+'], [/\bmenos\b/g, '-'], [/\bpor\b/g, '*'], [/\bentre\b/g, '/'], [/\belevado a\b/g, '^'], [/\braiz cuadrada de\b/g, 'raiz'], [/\ben\b/g, 'em']],
    ask: /^(preguntar|pregunta|pregunte|que guarde|que anote|busca en mis notas)\b/,
    askStrip: /^(preguntar|pregunta|pregunte)\s*(a|al)?\s*(la )?(ia|cerebro)?\s*:?\s*/i,
    dot: /\s+punto\s+/g,
    question: /\?$|^(que|cual|cuales|quien|cuando|donde|como|por que|cuanto)\b/,
    officialSite: ' sitio oficial',
  },
};

/** Idioma dos comandos: 'pt' | 'en' | 'es', a partir de um código como "en-US". */
export function commandLang(code) {
  const c = String(code || '').toLowerCase();
  return c.startsWith('en') ? 'en' : c.startsWith('es') ? 'es' : 'pt';
}

// Remove a parte de data/hora da frase: "amanhã às 9h de pagar a conta" → "pagar a conta"
export function stripWhen(s) {
  const L = '(?<!\\p{L})';
  const R = '(?!\\p{L})';
  const AMPM = '(\\s*(am|pm|a\\.m\\.|p\\.m\\.))?';
  return s
    .replace(new RegExp(`${L}(à|a|as|às|at|a las|a la)\\s+\\d{1,2}((h|:)\\d{0,2})?${AMPM}(\\s+(da noite|da tarde|da manhã|de la noche|de la tarde|de la mañana|in the evening|in the morning))?${R}`, 'giu'), ' ')
    .replace(new RegExp(`${L}(depois de amanhã|depois de amanha|amanhã|amanha|hoje|day after tomorrow|tomorrow|today|tonight|pasado mañana|pasado manana|mañana|manana|hoy|esta noche)${R}`, 'giu'), ' ')
    .replace(new RegExp(`${L}\\d{1,2}((h|:)\\d{0,2})?\\s*(am|pm|a\\.m\\.|p\\.m\\.)${R}`, 'giu'), ' ')
    .replace(new RegExp(`${L}\\d{1,2}(h|:)\\d{0,2}${R}`, 'giu'), ' ')
    .replace(new RegExp(`${L}(em|in|en|dentro de)\\s+\\d+\\s*(min|mins|minutos?|minutes?|h|hrs?|horas?|hours?)${R}`, 'giu'), ' ')
    .replace(new RegExp(`${L}(dia|el día|el dia|on the)\\s+\\d{1,2}(st|nd|rd|th)?${R}`, 'giu'), ' ')
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^(de|que|para|pra|to|that|about)\s+/i, '')
    .replace(/\s+(de|que|para|pra|to|that|about|at|a las)$/i, '')
    .trim();
}

/**
 * Executa uma frase. Retorna { reply, long? } — reply é falado e mostrado.
 * lang: 'pt' | 'en' | 'es' (idioma em que a pessoa falou).
 */
export async function runCommand(raw, api, lang = 'pt') {
  const L = LEX[lang] || LEX.pt;
  const text = raw.trim();
  const t = fold(text).replace(/[.!]+$/, '').replace(/\?$/, '').trim();
  const tq = fold(text).trim(); // mantém "?" para detectar perguntas
  let m;

  if (L.stop.test(t)) {
    await stopSound();
    return { reply: 'Som parado.' };
  }

  // Lembretes, tarefas e notas
  if (L.remind.test(t)) {
    const content = strip(text, L.remindStrip);
    return doReminder(api, text, content);
  }
  if (L.task.test(t)) {
    const content = strip(text, L.taskStrip);
    await api.capture({ type: 'task', text: content, remindAt: parseReminder(content), source: 'voice' });
    return { reply: 'Tarefa adicionada.' };
  }
  if (L.note.test(t)) {
    const content = strip(text, L.noteStrip);
    if (!content) return { reply: 'O que você quer anotar?' };
    await api.capture({ type: L.idea.test(t) ? 'idea' : 'note', text: content, source: 'voice' });
    return { reply: 'Anotado.' };
  }

  // Relógio
  if ((m = t.match(L.timer))) return doTimer(wordsToDigits(m[5], lang));
  if (L.timerCancel.test(t)) { await resetTimer(); return { reply: 'Timer cancelado.' }; }
  if (L.pomoStart.test(t)) { await startPomo(); return { reply: 'Pomodoro iniciado. Bom foco!' }; }
  if (L.pomoPause.test(t)) { await pausePomo(); return { reply: 'Pomodoro pausado.' }; }
  if (L.pomoStop.test(t)) { await stopPomo(); return { reply: 'Pomodoro encerrado.' }; }
  if (L.alarm.test(t)) {
    const hm = parseClock(wordsToDigits(t, lang, true));
    if (!hm) return { reply: 'Para que horas?' };
    const days = L.everyDay.test(t) ? [0, 1, 2, 3, 4, 5, 6] : L.weekdays.test(t) ? [1, 2, 3, 4, 5] : [];
    return doAlarm(hm[0], hm[1], days);
  }

  // Informações
  if (L.time.test(t)) return { reply: `São ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` };
  if (L.date.test(t)) return { reply: `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}.` };
  // Locais e rotas do widget de mapas: endereço, distância, tempo, listas (funciona sem IA).
  // Vem antes do clima ("quanto tempo até o trabalho" não é sobre o tempo lá fora); "rota para…" abre o mapa (abaixo).
  if (!L.route.test(t)) {
    const placeReply = api.placesAnswer?.(text, lang);
    if (placeReply) return { reply: placeReply, translated: true };
  }
  if (L.weather.test(t) && t.split(' ').length <= 7) return { reply: await api.weatherText() };
  if (L.quotes.test(t) && t.split(' ').length <= 6) return { reply: await api.quotesText(t) };
  if (L.tasks.test(t) || (L.tasksAsk.test(t) && t.split(' ').length <= 14)) return api.items ? { reply: tasksSummary(api.items(), (x) => tIn(lang, x)), translated: true } : { reply: api.tasksText() };

  // Rotas (só se o lugar existir nos favoritos do widget Trânsito)
  if ((m = t.match(L.route))) {
    const target = (m[2] === 'home' ? 'home ' + (m[4] || '') : m[4] || '').trim();
    const r = target && (api.routeTo?.(target) || (lang === 'en' && /^home/.test(target) && (api.routeTo?.('casa') || api.routeTo?.('home'))));
    if (r) return { reply: r };
  }

  // Abrir sites
  if ((m = t.match(L.open))) return doOpen(api, m[3].trim(), L);

  // Pesquisa
  if (L.search.test(t)) {
    api.open(api.searchUrl(strip(text, L.searchStrip)));
    return { reply: 'Pesquisando.' };
  }

  // Contas e conversões
  if (L.calc.test(t)) {
    let expr = t.replace(L.calcStrip, '');
    for (const [re, sub] of L.calcWords) expr = expr.replace(re, sub);
    try {
      const r = await smartCalc(expr);
      return { reply: r.text.startsWith('=') ? r.text.slice(1).trim() : `Dá ${r.text}.` };
    } catch {
      /* não era conta: segue para a IA */
    }
  }

  // Perguntas às notas / IA
  if (L.ask.test(t) || (api.aiReady() && L.question.test(tq))) {
    const q = strip(text, L.askStrip) || text;
    if (!api.aiReady()) return { reply: 'Configure a IA nas configurações para eu responder perguntas.' };
    const { answer } = await api.ask(q);
    return { reply: answer, long: true };
  }

  // Nada bateu: a IA interpreta a frase (qualquer idioma)
  if (api.aiReady() && api.interpret) {
    try {
      const r = await runIntent(await api.interpret(text), api, text, L);
      if (r) return r;
    } catch (e) {
      console.warn('NeuroTab: a IA não interpretou o comando', e);
    }
  }

  api.open(api.searchUrl(text));
  return { reply: `Pesquisando "${text}".` };
}

async function doReminder(api, text, content) {
  const when = parseReminder(text) || parseReminder('remind ' + text);
  const clean = stripWhen(content) || content;
  await api.capture({ type: 'task', text: cap(clean) || text, remindAt: when, source: 'voice' });
  return { reply: when ? `Combinado. Vou te lembrar ${fmtDateTime(when)}.` : 'Tarefa anotada. Não entendi o horário; você pode ajustar no item.' };
}

async function doTimer(spec) {
  const ms = typeof spec === 'number' ? spec : parseDuration(spec);
  if (!ms) return { reply: 'Não entendi a duração do timer.' };
  await startTimer(ms);
  return { reply: `Timer de ${fmtDur(ms)} iniciado.` };
}

async function doAlarm(hh, mm, days) {
  if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return { reply: 'Para que horas?' };
  const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  await addAlarm({ time, days, label: 'Despertador' });
  return { reply: `Despertador para ${time}${days.length ? ' (' + (days.length === 7 ? 'todos os dias' : 'dias úteis') + ')' : ''}.` };
}

function doOpen(api, target, L) {
  const link = api.findLink(target);
  if (link) { api.open(link.url); return { reply: `Abrindo ${link.title}.` }; }
  const asHost = target.replace(L.dot, '.').replace(/\s/g, '');
  if (/^[\w-]+(\.[\w-]+)+/.test(asHost)) {
    const url = normalizeUrl(asHost);
    api.open(url);
    return { reply: `Abrindo ${hostOf(url)}.` };
  }
  api.open(api.searchUrl(target + L.officialSite));
  return { reply: `Não encontrei "${target}" nos atalhos. Pesquisando.` };
}

// Executa a intenção devolvida pela IA (ver interpretCommand em ai.js).
async function runIntent(it, api, text, L) {
  if (!it || typeof it !== 'object') return null;
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  switch (it.action) {
    case 'note':
    case 'idea':
      if (!s(it.text)) return null;
      await api.capture({ type: it.action, text: s(it.text), source: 'voice' });
      return { reply: 'Anotado.' };
    case 'task':
    case 'reminder': {
      const when = it.when ? Date.parse(it.when) : null;
      await api.capture({ type: 'task', text: cap(s(it.text)) || text, remindAt: when && when > Date.now() - 60e3 ? when : null, source: 'voice' });
      return { reply: when ? `Combinado. Vou te lembrar ${fmtDateTime(when)}.` : 'Tarefa adicionada.' };
    }
    case 'timer':
      return doTimer(Math.round(Number(it.seconds) * 1000) || 0);
    case 'alarm': {
      const [hh, mm] = s(it.time).split(':').map(Number);
      return doAlarm(hh, mm || 0, Array.isArray(it.days) ? it.days.filter((d) => d >= 0 && d <= 6) : []);
    }
    case 'pomodoro': await startPomo(); return { reply: 'Pomodoro iniciado. Bom foco!' };
    case 'stop': await stopSound(); return { reply: 'Som parado.' };
    case 'open': return s(it.target) ? doOpen(api, s(it.target), L) : null;
    case 'search': api.open(api.searchUrl(s(it.query) || text)); return { reply: 'Pesquisando.' };
    case 'route': { const r = api.routeTo?.(s(it.target)); return r ? { reply: r } : null; }
    case 'weather': return { reply: await api.weatherText() };
    case 'quotes': return { reply: await api.quotesText(fold(s(it.query) || text)) };
    case 'tasks': return api.items ? { reply: tasksSummary(api.items(), (x) => tIn(L.code, x)), translated: true } : { reply: api.tasksText() };
    case 'time': return { reply: `São ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` };
    case 'ask': {
      const { answer } = await api.ask(s(it.query) || text);
      return { reply: answer, long: true };
    }
    default: return null;
  }
}

export function tasksSummary(items, tr = (x) => x) {
  const now = Date.now();
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const time = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const pend = items.filter((i) => !i.done && !i.deletedAt && (i.type === 'task' || i.remindAt));
  const late = pend.filter((i) => i.remindAt && i.remindAt < now).sort((a, b) => a.remindAt - b.remindAt);
  const today = pend.filter((i) => i.remindAt && i.remindAt >= now && i.remindAt <= end).sort((a, b) => a.remindAt - b.remindAt);
  const undated = pend.filter((i) => !i.remindAt).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.createdAt - b.createdAt);
  if (!pend.length) return tr('Você não tem tarefas pendentes. 🎉');
  const list = (arr, n, fmt = displayTitle) => arr.slice(0, n).map(fmt).join('; ') + (arr.length > n ? tr(`; e mais ${arr.length - n}`) : '');
  const parts = [];
  if (late.length) parts.push(tr(`Atrasadas (${late.length}): ${list(late, 3)}.`));
  if (today.length) parts.push(tr(`Para hoje: ${list(today, 5, (i) => tr(`${displayTitle(i)} às ${time(i.remindAt)}`))}.`));
  if (!late.length && !today.length) parts.push(tr('Nada com horário para hoje.'));
  if (undated.length) parts.push(tr(`Sem data (${undated.length}): ${list(undated, late.length || today.length ? 3 : 5)}.`));
  return parts.join(' ');
}
