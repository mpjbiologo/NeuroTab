// Agenda (#26): fusos, leitor de .ics, recorrências, exceções e agendas por link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, wallParts, normTz, addDays } from '../../src/lib/tz.js';
import { parseICS, parseRRule, parseDuration, toICS } from '../../src/lib/ics.js';
import { occurrences, normalizeEvent, keyToTs, normalizeFeedUrl, guessFeedName, fetchFeed, addFeed, refreshFeeds, loadCalendar, saveEvent, deleteEvent, importICS, eventsBetween } from '../../src/lib/calendar.js';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
const iso = (t) => new Date(t).toISOString();

test('fusos: horário de parede ↔ instante, com horário de verão', () => {
  assert.equal(iso(zonedToUtc(2026, 11, 20, 9, 0, 0, SP)), '2026-11-20T12:00:00.000Z');
  assert.equal(iso(zonedToUtc(2026, 7, 1, 9, 0, 0, NY)), '2026-07-01T13:00:00.000Z'); // EDT
  assert.equal(iso(zonedToUtc(2026, 12, 1, 9, 0, 0, NY)), '2026-12-01T14:00:00.000Z'); // EST
  assert.deepEqual(({ ...wallParts(Date.parse('2026-11-20T12:00:00Z'), SP) }).h, 9);
  assert.equal(normTz('E. South America Standard Time'), SP);
  assert.equal(normTz('Fuso/Inexistente'), normTz('')); // cai no fuso do computador
});

const GOOGLE = `BEGIN:VCALENDAR\r
VERSION:2.0\r
X-WR-CALNAME:Trabalho\r
X-WR-TIMEZONE:America/Sao_Paulo\r
BEGIN:VEVENT\r
DTSTART;TZID=America/Sao_Paulo:20261102T090000\r
DTEND;TZID=America/Sao_Paulo:20261102T093000\r
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6\r
EXDATE;TZID=America/Sao_Paulo:20261104T090000\r
UID:daily@google.com\r
SUMMARY:Reunião diária\\, time\r
LOCATION:Sala 2\r
DESCRIPTION:Linha 1\\nLinha 2 com texto bem longo que o Google dobra em vár\r
 ias linhas\r
BEGIN:VALARM\r
TRIGGER:-PT15M\r
ACTION:DISPLAY\r
END:VALARM\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;TZID=America/Sao_Paulo:20261111T100000\r
DTEND;TZID=America/Sao_Paulo:20261111T103000\r
RECURRENCE-ID;TZID=America/Sao_Paulo:20261111T090000\r
UID:daily@google.com\r
SUMMARY:Reunião diária (movida)\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20261125\r
DTEND;VALUE=DATE:20261127\r
UID:feriado@google.com\r
SUMMARY:Viagem\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART:20261120T150000Z\r
DTEND:20261120T160000Z\r
UID:utc@google.com\r
SUMMARY:Chamada\r
STATUS:CONFIRMED\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART:20261121T150000Z\r
UID:cancelado@google.com\r
SUMMARY:Cancelado\r
STATUS:CANCELLED\r
END:VEVENT\r
END:VCALENDAR\r
`;

test('.ics do Google: nome, texto com escapes e dobras, alarme, dia inteiro, UTC e cancelado', () => {
  const { name, events } = parseICS(GOOGLE);
  assert.equal(name, 'Trabalho');
  assert.equal(events.length, 3, 'cancelado fica de fora');
  const r = events.find((e) => e.uid === 'daily@google.com');
  assert.equal(r.title, 'Reunião diária, time');
  assert.equal(r.notes, 'Linha 1\nLinha 2 com texto bem longo que o Google dobra em várias linhas');
  assert.equal(r.alarm, 15);
  assert.equal(r.start, '2026-11-02T09:00');
  assert.equal(r.tz, SP);
  assert.deepEqual(r.exdates, ['2026-11-04T09:00']);
  assert.equal(r.overrides['2026-11-11T09:00'].start, '2026-11-11T10:00');
  const v = events.find((e) => e.uid === 'feriado@google.com');
  assert.deepEqual([v.allDay, v.start, v.end], [true, '2026-11-25', '2026-11-27']);
  const c = events.find((e) => e.uid === 'utc@google.com');
  assert.equal(c.start, '2026-11-20T12:00'); // 15h UTC = 12h em São Paulo
});

test('recorrência semanal com dias, contagem, exceção e ocorrência movida', () => {
  const r = parseICS(GOOGLE).events.find((e) => e.uid === 'daily@google.com');
  const occ = occurrences(r, Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-12-31T00:00:00Z'));
  const keys = occ.map((o) => o.key);
  // COUNT=6 conta a exceção: 2, 4(ex), 9, 11(movida), 16, 18
  assert.deepEqual(keys, ['2026-11-02T09:00', '2026-11-09T09:00', '2026-11-11T09:00', '2026-11-16T09:00', '2026-11-18T09:00']);
  const moved = occ.find((o) => o.key === '2026-11-11T09:00');
  assert.equal(iso(moved.start), '2026-11-11T13:00:00.000Z');
  assert.equal(moved.ev.title, 'Reunião diária (movida)');
  assert.equal(occ[0].end - occ[0].start, 30 * 60e3);
});

test('recorrências: diária com UNTIL, mensal (2ª terça, último dia), anual, dia 31 e horário de verão', () => {
  const at = (ev, a, b) => occurrences(normalizeEvent(ev), Date.parse(a), Date.parse(b)).map((o) => o.key);
  assert.deepEqual(at({ start: '2026-11-28T08:00', tz: SP, rrule: { freq: 'DAILY', interval: 2, until: '2026-12-04T23:59' } }, '2026-11-01T00:00Z', '2027-01-01T00:00Z'),
    ['2026-11-28T08:00', '2026-11-30T08:00', '2026-12-02T08:00', '2026-12-04T08:00']);
  assert.deepEqual(at({ start: '2026-01-13T19:00', tz: SP, rrule: parseRRule('FREQ=MONTHLY;BYDAY=2TU') }, '2026-11-01T00:00Z', '2027-01-01T00:00Z'),
    ['2026-11-10T19:00', '2026-12-08T19:00']);
  assert.deepEqual(at({ start: '2026-01-31', allDay: true, rrule: parseRRule('FREQ=MONTHLY;BYMONTHDAY=-1') }, '2026-02-01T12:00Z', '2026-05-01T00:00Z').map((k) => k.slice(0, 10)),
    ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(at({ start: '2026-01-31T10:00', tz: SP, rrule: parseRRule('FREQ=MONTHLY') }, '2026-01-01T00:00Z', '2026-06-01T00:00Z'),
    ['2026-01-31T10:00', '2026-03-31T10:00', '2026-05-31T10:00'], 'mês sem dia 31 é pulado');
  assert.deepEqual(at({ start: '2020-11-20', allDay: true, title: 'Aniversário', rrule: parseRRule('FREQ=YEARLY') }, '2026-01-01T00:00Z', '2028-01-01T00:00Z'),
    ['2026-11-20', '2027-11-20']);
  // Nova York: 9h continua 9h depois que o horário de verão acaba (1º domingo de novembro)
  const ny = occurrences(normalizeEvent({ start: '2026-10-30T09:00', tz: NY, rrule: { freq: 'DAILY', interval: 1, count: 5 } }), Date.parse('2026-10-01Z'), Date.parse('2026-12-01Z'));
  assert.deepEqual(ny.map((o) => new Date(o.start).toISOString().slice(11, 16)), ['13:00', '13:00', '14:00', '14:00', '14:00']); // 30 e 31/out em EDT; a partir de 1º/nov, EST
});

test('evento diário antigo não trava e aparece no intervalo de hoje', () => {
  const ev = normalizeEvent({ start: '2001-01-01T07:00', tz: SP, rrule: { freq: 'DAILY', interval: 1 } });
  const t0 = performance.now();
  const occ = occurrences(ev, Date.parse('2026-11-20T00:00:00-03:00'), Date.parse('2026-11-22T00:00:00-03:00'));
  assert.deepEqual(occ.map((o) => o.key), ['2026-11-20T07:00', '2026-11-21T07:00']);
  assert.ok(performance.now() - t0 < 200);
  const wk = normalizeEvent({ start: '2001-01-02T07:00', tz: SP, rrule: parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH') });
  const w = occurrences(wk, Date.parse('2026-11-16T00:00:00-03:00'), Date.parse('2026-11-30T00:00:00-03:00')).map((o) => o.key.slice(0, 10));
  assert.equal(w.length, 2);
  assert.ok(w.every((d) => [2, 4].includes(new Date(d + 'T12:00Z').getUTCDay())));
});

test('duração, normalização e geração de .ics que lê de volta igual', () => {
  assert.equal(parseDuration('PT1H30M'), 90);
  assert.equal(parseDuration('-PT15M'), -15);
  assert.equal(parseDuration('P1D'), 1440);
  const e = normalizeEvent({ title: ' Dentista ', start: '2026-11-21T14:00', end: '2026-11-21T13:00', tz: SP, alarm: '30' });
  assert.equal(e.title, 'Dentista');
  assert.equal(e.end, '2026-11-21T15:00', 'fim antes do início vira 1 hora');
  assert.equal(e.alarm, 30);
  const back = parseICS(toICS([{ ...e, rrule: { freq: 'WEEKLY', interval: 1, byday: [{ wd: 6, n: 0 }], count: 3 }, exdates: ['2026-11-28T14:00'], notes: 'Levar exames; jejum, 8h' }])).events[0];
  assert.deepEqual([back.title, back.start, back.end, back.tz, back.alarm, back.notes], ['Dentista', '2026-11-21T14:00', '2026-11-21T15:00', SP, 30, 'Levar exames; jejum, 8h']);
  assert.deepEqual(back.exdates, ['2026-11-28T14:00']);
  assert.equal(back.rrule.count, 3);
  assert.equal(keyToTs('2026-11-21T14:00', SP), Date.parse('2026-11-21T17:00:00Z'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

// chrome.storage.local falso para as funções que gravam
function fakeStorage() {
  const db = {};
  globalThis.chrome = { storage: { local: {
    get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in db).map((k) => [k, structuredClone(db[k])])),
    set: async (o) => { Object.assign(db, structuredClone(o)); },
  } } };
  return db;
}

test('agenda local: criar, excluir uma ocorrência, excluir tudo, importar sem duplicar', async () => {
  fakeStorage();
  const ev = await saveEvent({ title: 'Academia', start: '2026-11-23T07:00', tz: SP, rrule: { freq: 'DAILY', interval: 1, count: 3 } });
  await deleteEvent(ev.id, { occurrence: '2026-11-24T07:00' });
  let cal = await loadCalendar();
  assert.deepEqual(eventsBetween(cal, Date.parse('2026-11-20Z'), Date.parse('2026-12-01Z')).map((o) => o.key), ['2026-11-23T07:00', '2026-11-25T07:00']);
  await deleteEvent(ev.id);
  assert.equal((await loadCalendar()).events.length, 0);
  assert.equal(await importICS(GOOGLE), 3);
  assert.equal(await importICS(GOOGLE), 3);
  cal = await loadCalendar();
  assert.equal(cal.events.length, 3, 'mesmo UID não duplica');
  await assert.rejects(importICS('BEGIN:VCALENDAR\nEND:VCALENDAR'), /Nenhum evento/);
});

test('agendas por link: webcal, nomes, erros claros, atualização e visibilidade', async () => {
  fakeStorage();
  assert.equal(normalizeFeedUrl('webcal://p01-caldav.icloud.com/published/2/abc'), 'https://p01-caldav.icloud.com/published/2/abc');
  assert.equal(normalizeFeedUrl('ftp://x'), null);
  assert.equal(guessFeedName('https://calendar.google.com/calendar/ical/x/private-y/basic.ics'), 'Google Agenda');
  assert.equal(guessFeedName('https://outlook.office365.com/owa/calendar/x/calendar.ics'), 'Outlook');
  const ok = async () => new Response(GOOGLE, { status: 200 });
  await assert.rejects(fetchFeed('https://x', { fetchFn: async () => new Response('<html>', { status: 200 }) }), /não é de uma agenda/);
  await assert.rejects(fetchFeed('https://x', { fetchFn: async () => new Response('', { status: 404 }) }), /não encontrado/);
  await assert.rejects(fetchFeed('https://x', { fetchFn: async () => { throw new TypeError('rede'); } }), /Não consegui baixar/);
  const c = await addFeed('webcal://calendar.google.com/calendar/ical/x/private-y/basic.ics', { fetchFn: ok });
  assert.equal(c.name, 'Trabalho');
  assert.equal(c.count, 3);
  await assert.rejects(addFeed('https://calendar.google.com/calendar/ical/x/private-y/basic.ics', { fetchFn: ok }), /já foi adicionada/);
  let cal = await loadCalendar();
  assert.equal(eventsBetween(cal, Date.parse('2026-11-20T00:00:00-03:00'), Date.parse('2026-11-21T00:00:00-03:00')).find((o) => o.ev.title === 'Chamada').calendar.id, c.id);
  // erro de atualização fica registrado, os eventos antigos continuam
  cal = await refreshFeeds({ force: true, fetchFn: async () => new Response('', { status: 403 }) });
  const saved = cal.calendars.find((x) => x.id === c.id);
  assert.match(saved.error, /recusou o acesso/);
  assert.equal(cal.cache[c.id].events.length, 3);
  // esconder a agenda tira os eventos da visão
  saved.visible = false;
  assert.equal(eventsBetween(cal, Date.parse('2026-11-01Z'), Date.parse('2026-12-31Z')).filter((o) => o.calendar.id === c.id).length, 0);
});

test('cérebro: "o que tenho amanhã?" responde com a agenda e as tarefas do dia', async () => {
  fakeStorage();
  const { runCommand } = await import('../../src/lib/assistant.js');
  const { agendaText, calendarContext } = await import('../../src/lib/calendar.js');
  const { todayYmd, addDays } = await import('../../src/lib/tz.js');
  const tomorrow = addDays(todayYmd(), 1);
  assert.equal(await agendaText(1), '', 'sem nenhuma agenda, não fala de agenda');
  await saveEvent({ title: 'Dentista', start: `${tomorrow}T16:30`, end: `${tomorrow}T17:15`, location: 'Centro' });
  await saveEvent({ title: 'Viagem', start: tomorrow, allDay: true });
  assert.equal(await agendaText(1), 'Agenda de amanhã: dia todo Viagem; 16:30 Dentista (Centro).');
  assert.equal(await agendaText(2), 'Nada na agenda depois de amanhã.');
  const at9 = new Date(`${tomorrow}T09:00`).getTime();
  const api = { items: () => [{ id: 't', type: 'task', title: 'Pagar a luz', text: 'Pagar a luz', remindAt: at9, done: false, createdAt: 1 }] };
  const r = await runCommand('O que eu tenho amanhã?', api, 'pt');
  assert.match(r.reply, /Agenda de amanhã: dia todo Viagem; 16:30 Dentista \(Centro\)\. Tarefas de amanhã: Pagar a luz às 09:00\./);
  const hoje = await runCommand('minha agenda de hoje', { items: () => [] }, 'pt');
  assert.match(hoje.reply, /Nada na agenda hoje\./);
  const ctx = await calendarContext();
  assert.match(ctx, new RegExp(`${tomorrow} \\([^)]+\\):\\n- dia todo Viagem \\[Minha agenda\\]\\n- 16:30–17:15 Dentista · Centro`));
});
