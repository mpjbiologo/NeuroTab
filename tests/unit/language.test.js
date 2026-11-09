// Linguagem natural: datas, durações, contas e comandos de voz nos três idiomas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReminder, searchItems, fold } from '../../src/lib/brain.js';
import { parseDuration } from '../../src/lib/clock.js';
import { smartCalc, convert } from '../../src/lib/calc.js';
import { runCommand, stripWhen, tasksSummary, commandLang } from '../../src/lib/assistant.js';

const NOW = new Date(2026, 10, 5, 8, 0); // qui, 05/11/2026 08:00
const at = (ts) => { const d = new Date(ts); return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('parseReminder: português, inglês e espanhol', () => {
  const cases = [
    ['me lembre amanhã às 9h de pagar a conta', '6/11 09:00'],
    ['me lembre às 14:30 de ligar', '5/11 14:30'],
    ['dia 15 às 10h reunião', '15/11 10:00'],
    ['15/11 9h dentista', '15/11 09:00'],
    ['me lembre hoje às 8 da noite', '5/11 20:00'],
    ['remind me tomorrow at 9am to pay the bill', '6/11 09:00'],
    ['remind me at 2:30 pm to call mom', '5/11 14:30'],
    ['recuérdame mañana a las 9 pagar la cuenta', '6/11 09:00'],
    ['avísame pasado mañana a las 8', '7/11 08:00'],
  ];
  for (const [text, want] of cases) assert.equal(at(parseReminder(text, NOW, 'dmy')), want, text);
  assert.equal(at(parseReminder('11/15 9am dentist', NOW, 'mdy')), '15/11 09:00');
  assert.equal(parseReminder('lembrete em 20 minutos', NOW) - NOW.getTime(), 20 * 60e3);
  assert.equal(parseReminder('remind me in 2 hours', NOW) - NOW.getTime(), 2 * 3600e3);
  assert.equal(parseReminder('pagar a conta', NOW), null);
});

test('stripWhen tira data e hora do texto', () => {
  assert.equal(stripWhen('amanhã às 9h de pagar a conta'), 'pagar a conta');
  assert.equal(stripWhen('tomorrow at 9am to pay the bill'), 'pay the bill');
  assert.equal(stripWhen('mañana a las 9 pagar la cuenta'), 'pagar la cuenta');
});

test('parseDuration em três idiomas', () => {
  assert.equal(parseDuration('10 minutos'), 600000);
  assert.equal(parseDuration('1 hour 30 minutes'), 5400000);
  assert.equal(parseDuration('90 seg'), 90000);
  assert.equal(parseDuration('25'), 1500000);
  assert.equal(parseDuration('25:00'), 1500000);
  assert.equal(parseDuration('abc'), null);
});

test('calculadora e conversões', async () => {
  assert.match((await smartCalc('2^10 + 5')).text, /1\.029|1,029|1029/);
  assert.match((await smartCalc('15% de 200')).text, /30/);
  assert.match((await convert('10 km em milhas')).text, /6[,.]21/);
  assert.match((await convert('10 km to miles')).text, /6[,.]21/);
  assert.match((await convert('100 usd em brl', async () => 5)).text, /500/);
});

test('busca por palavras ignora acentos e maiúsculas', () => {
  const items = [{ id: 1, type: 'note', text: 'Reunião com a Coordenação', tags: [], createdAt: 1 }, { id: 2, type: 'note', text: 'outra coisa', tags: ['reuniao'], createdAt: 2 }];
  assert.deepEqual(searchItems(items, 'REUNIAO').map((i) => i.id).sort(), [1, 2]);
  assert.equal(fold('Ação'), 'acao');
});

function mockApi(log) {
  const now = Date.now();
  return {
    log,
    items: () => [
      { id: 'a', type: 'task', text: 'Pagar boleto', tags: [], remindAt: now - 3600e3, createdAt: now - 9e6 },
      ...Array.from({ length: 4 }, (_, i) => ({ id: 'u' + i, type: 'task', text: 'Ideia ' + i, tags: [], createdAt: now - i })),
    ],
    capture: async (p) => log.push(['capture', p.type, p.text]),
    aiReady: () => true,
    ask: async (q) => (log.push(['ask', q]), { answer: 'resposta' }),
    interpret: async (t) => (log.push(['interpret', t]), { action: 'note', text: t }),
    open: (u) => log.push(['open', u]),
    searchUrl: (q) => 'S:' + q,
    findLink: (n) => (/youtube/i.test(n) ? { url: 'https://youtube.com', title: 'YouTube' } : null),
    routeTo: (n) => (/trabalho|work|trabajo/i.test(n) ? 'ROTA ' + n : null),
    weatherText: async () => 'CLIMA',
    quotesText: async () => 'COTAÇÃO',
    tasksText: () => 'TAREFAS',
  };
}

test('comandos de voz: tabela pt/en/es', async () => {
  const cases = [
    ['pt', 'anotar comprar café', (r, log) => log[0][1] === 'note' && log[0][2] === 'comprar café'],
    ['pt', 'me lembre amanhã às 9h de pagar a conta', (r, log) => log[0][1] === 'task' && log[0][2] === 'Pagar a conta'],
    ['pt', 'Me diga aí, o que que eu tenho que fazer?', (r) => /^Atrasadas \(1\)/.test(r.reply)],
    ['pt', 'abrir youtube', (r, log) => log[0][1] === 'https://youtube.com'],
    ['pt', 'rota para o trabalho', (r) => r.reply.startsWith('ROTA')],
    ['pt', 'como está o tempo', (r) => r.reply === 'CLIMA'],
    ['pt', 'quanto é 15% de 200', (r) => /30/.test(r.reply)],
    ['pt', 'o que é fotossíntese?', (r, log) => log[0][0] === 'ask'],
    ['pt', 'comprar pão amanhã', (r, log) => log[0][0] === 'interpret'],
    ['en', 'note buy coffee', (r, log) => log[0][2] === 'buy coffee'],
    ['en', 'remind me tomorrow at 9am to pay the bill', (r, log) => log[0][2] === 'Pay the bill'],
    ['en', 'Hey, what do I have to do?', (r) => /^Overdue \(1\)/.test(r.reply) && r.translated],
    ['en', 'open youtube', (r, log) => log[0][1] === 'https://youtube.com'],
    ['en', 'what is 3 plus 4', (r) => /7/.test(r.reply)],
    ['es', 'anota comprar café', (r, log) => log[0][2] === 'comprar café'],
    ['es', '¿Qué tengo que hacer hoy?', (r) => /^Atrasadas \(1\)/.test(r.reply) && /Sin fecha/.test(r.reply)],
    ['es', 'cuánto es 10 dividido entre 4', (r) => /2[,.]5/.test(r.reply)],
  ];
  for (const [lang, said, ok] of cases) {
    const log = [];
    const r = await runCommand(said, mockApi(log), lang);
    assert.ok(ok(r, log), `${lang}: "${said}" → ${r.reply} ${JSON.stringify(log)}`);
  }
});

test('resumo de tarefas sem pendências e código de idioma', () => {
  assert.match(tasksSummary([]), /não tem tarefas pendentes/);
  assert.equal(commandLang('en-GB'), 'en');
  assert.equal(commandLang('es-MX'), 'es');
  assert.equal(commandLang(''), 'pt');
});
