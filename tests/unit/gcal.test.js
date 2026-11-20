// Google Agenda pela conta (0.7.6.2): conversão de eventos, agendas da conta, criar, editar e excluir,
// com a API do Google simulada.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = {};
globalThis.chrome = { storage: { local: {
  get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in db).map((k) => [k, structuredClone(db[k])])),
  set: async (o) => { Object.assign(db, structuredClone(o)); },
  remove: async (keys) => { for (const k of [].concat(keys)) delete db[k]; },
} } };

const { fromGoogle, toGoogle, GCAL } = await import('../../src/lib/gcal.js');
const C = await import('../../src/lib/calendar.js');

const CAL_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
function login() {
  db.nt_accounts = { accounts: [{ id: 'google:1', provider: 'google', email: 'ana@gmail.com', scopes: CAL_SCOPES }] };
  db.nt_account_tokens = { 'google:1': { accessToken: 'tok', expiresAt: Date.now() + 3600e3, scopes: CAL_SCOPES } };
}

/** Google Agenda falso: duas agendas, eventos em memória. */
function fakeGoogle() {
  const events = { 'ana@gmail.com': [], feriados: [] };
  let n = 0;
  const calls = [];
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    calls.push(`${method} ${u.pathname}`);
    assert.equal(opts.headers.Authorization, 'Bearer tok');
    const path = decodeURIComponent(u.pathname.replace('/calendar/v3', ''));
    if (path === '/users/me/calendarList') return json({ items: [
      { id: 'feriados', summary: 'Feriados', accessRole: 'reader', backgroundColor: '#16a765' },
      { id: 'ana@gmail.com', summary: 'Ana', accessRole: 'owner', primary: true, backgroundColor: '#9fc6e7', timeZone: 'America/Sao_Paulo' },
    ] });
    const m = path.match(/^\/calendars\/([^/]+)\/events(?:\/(.+))?$/);
    if (!m) return json({ error: { message: 'nope' } }, 404);
    const [, cal, id] = m;
    const list = events[cal];
    if (method === 'GET') {
      // primeira página com 1 item, segunda com o resto: testa a paginação
      const page = u.searchParams.get('pageToken');
      const items = page ? list.slice(1) : list.slice(0, 1);
      return json({ timeZone: 'America/Sao_Paulo', defaultReminders: [{ method: 'popup', minutes: 30 }], items, ...(page || list.length < 2 ? {} : { nextPageToken: 'p2' }) });
    }
    if (method === 'POST') { const body = JSON.parse(opts.body); const it = { id: `ev${++n}`, status: 'confirmed', htmlLink: `https://calendar.google.com/e/${n}`, ...body }; list.push(it); return json(it); }
    if (method === 'PATCH') { const it = list.find((e) => e.id === id); if (!it) return json({}, 404); Object.assign(it, JSON.parse(opts.body)); return json(it); }
    if (method === 'DELETE') { const i = list.findIndex((e) => e.id === id || e.recurringEventId === id); events[cal] = list.filter((e) => e.id !== id && e.recurringEventId !== id); return new Response(null, { status: i >= 0 ? 204 : 410 }); }
    return json({}, 400);
  };
  return { events, fetchFn, calls };
}

test('evento do Google → NeuroTab: horário no fuso, dia inteiro, reunião, lembrete padrão, cancelado', () => {
  const e = fromGoogle({
    id: 'a', summary: 'Consulta', location: 'Clínica', description: 'Levar exames', htmlLink: 'https://g/a', hangoutLink: 'https://meet.google.com/x',
    start: { dateTime: '2026-11-23T14:00:00-03:00', timeZone: 'America/Sao_Paulo' }, end: { dateTime: '2026-11-23T14:50:00-03:00' },
    reminders: { useDefault: true }, recurringEventId: 'serie', updated: '2026-11-20T10:00:00Z',
  }, { defaults: [{ method: 'popup', minutes: 30 }, { method: 'email', minutes: 5 }] });
  assert.deepEqual([e.start, e.end, e.tz, e.allDay, e.url, e.link, e.remind, e.seriesId, e.gid], ['2026-11-23T14:00', '2026-11-23T14:50', 'America/Sao_Paulo', false, 'https://meet.google.com/x', 'https://g/a', 30, 'serie', 'a']);
  assert.equal(e.alarm, undefined, 'o aviso do Google não vira aviso da NeuroTab (não duplica)');
  // horário de outro fuso aparece no fuso do evento
  const ny = fromGoogle({ id: 'b', start: { dateTime: '2026-11-23T17:00:00Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-23T18:00:00Z' } });
  assert.deepEqual([ny.start, ny.tz], ['2026-11-23T12:00', 'America/New_York']);
  const d = fromGoogle({ id: 'c', summary: 'Feriado', start: { date: '2026-12-25' }, end: { date: '2026-12-26' } });
  assert.deepEqual([d.allDay, d.start, d.end, d.tz], [true, '2026-12-25', '2026-12-26', null]);
  assert.equal(fromGoogle({ id: 'x', status: 'cancelled', start: { date: '2026-01-01' } }), null);
});

test('NeuroTab → Google: horário com fuso, dia inteiro, lembrete e repetição', () => {
  const b = toGoogle({ title: 'Reunião', start: '2026-11-24T09:00', end: '2026-11-24T10:00', tz: 'America/Sao_Paulo', remind: 10, rrule: { freq: 'WEEKLY', interval: 1, byday: [{ wd: 2, n: 0 }] } });
  assert.deepEqual(b.start, { dateTime: '2026-11-24T09:00:00', timeZone: 'America/Sao_Paulo' });
  assert.deepEqual(b.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
  assert.deepEqual(b.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU']);
  const d = toGoogle({ title: 'Viagem', allDay: true, start: '2026-12-01', end: '2026-12-04', remind: null });
  assert.deepEqual([d.start, d.end, d.reminders], [{ date: '2026-12-01' }, { date: '2026-12-04' }, { useDefault: true }]);
  // uma data de uma série: sem regra (o Google recusaria)
  assert.equal(toGoogle({ title: 'x', start: '2026-11-24T09:00', end: '2026-11-24T10:00', rrule: { freq: 'DAILY', interval: 1 }, seriesId: 's' }, { series: false }).recurrence, undefined);
});

test('escolher agendas, ver eventos, criar, editar e excluir no Google', async () => {
  login();
  const G = fakeGoogle();
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  G.events['ana@gmail.com'].push(
    { id: 'e1', summary: 'Dentista', start: { dateTime: iso(now + 864e5) }, end: { dateTime: iso(now + 864e5 + 36e5) }, reminders: { useDefault: true } },
    { id: 'e2_20261201', recurringEventId: 'e2', summary: 'Pilates', start: { dateTime: iso(now + 2 * 864e5) }, end: { dateTime: iso(now + 2 * 864e5 + 36e5) } },
    { id: 'e2_20261208', recurringEventId: 'e2', summary: 'Pilates', start: { dateTime: iso(now + 9 * 864e5) }, end: { dateTime: iso(now + 9 * 864e5 + 36e5) } },
  );
  G.events.feriados.push({ id: 'f1', summary: 'Natal', start: { date: '2026-12-25' }, end: { date: '2026-12-26' } });

  const choices = await C.googleCalendarChoices('google:1', { fetchFn: G.fetchFn });
  assert.deepEqual(choices.map((c) => [c.name, c.writable, c.primary, c.added]), [['Ana', true, true, false], ['Feriados', false, false, false]]);

  let cal = await C.setGoogleCalendars('google:1', choices, { fetchFn: G.fetchFn });
  const ana = C.googleCalId('google:1', 'ana@gmail.com');
  const fer = C.googleCalId('google:1', 'feriados');
  assert.equal(cal.calendars.find((c) => c.id === ana).count, 3, 'paginação: as 3 datas vieram');
  assert.deepEqual(C.writableCalendars(cal).map((c) => c.id), ['local', ana], 'só dá para criar na local e nas agendas próprias');
  const occ = C.eventsBetween(cal, now, now + 10 * 864e5).filter((o) => o.calendar.id === ana);
  assert.deepEqual(occ.map((o) => o.ev.title), ['Dentista', 'Pilates', 'Pilates']);
  // situação da agenda fica no cache, não no que sincroniza
  assert.equal(db.nt_calendar.calendars.find((c) => c.id === ana).lastSync, undefined);
  assert.ok(db.nt_calendar_cache[ana].status.lastSync);

  // criar
  const made = await C.saveGoogleEvent(ana, { title: 'Nutri', start: '2026-12-02T15:00', end: '2026-12-02T15:50', tz: 'America/Sao_Paulo', remind: 15 }, { fetchFn: G.fetchFn });
  assert.equal(G.events['ana@gmail.com'].at(-1).summary, 'Nutri');
  assert.ok((await C.loadCalendar()).cache[ana].events.some((e) => e.gid === made.gid && e.remind === 15));
  // editar
  await C.saveGoogleEvent(ana, { ...made, title: 'Nutri (retorno)' }, { fetchFn: G.fetchFn });
  assert.equal(G.events['ana@gmail.com'].find((e) => e.id === made.gid).summary, 'Nutri (retorno)');
  assert.ok(G.calls.includes(`PATCH /calendar/v3/calendars/ana%40gmail.com/events/${made.gid}`));
  // editar só uma data de uma série: sem regra no corpo
  const pil = (await C.loadCalendar()).cache[ana].events.find((e) => e.gid === 'e2_20261201');
  await C.saveGoogleEvent(ana, { ...pil, title: 'Pilates (remarcado)' }, { fetchFn: G.fetchFn });
  assert.equal(G.events['ana@gmail.com'].find((e) => e.id === 'e2_20261201').summary, 'Pilates (remarcado)');
  assert.equal(G.events['ana@gmail.com'].find((e) => e.id === 'e2_20261208').summary, 'Pilates');
  // excluir só uma data / a série inteira
  await C.deleteGoogleEvent(ana, pil, { fetchFn: G.fetchFn });
  assert.ok(!G.events['ana@gmail.com'].some((e) => e.id === 'e2_20261201'));
  const pil2 = (await C.loadCalendar()).cache[ana].events.find((e) => e.gid === 'e2_20261208');
  await C.deleteGoogleEvent(ana, pil2, { series: true, fetchFn: G.fetchFn });
  assert.ok(G.calls.includes('DELETE /calendar/v3/calendars/ana%40gmail.com/events/e2'));
  assert.ok(!(await C.loadCalendar()).cache[ana].events.some((e) => e.seriesId === 'e2'));

  // tirar uma agenda da lista
  cal = await C.setGoogleCalendars('google:1', choices.filter((c) => c.gid === 'ana@gmail.com'), { fetchFn: G.fetchFn });
  assert.ok(!cal.calendars.some((c) => c.id === fer));
  assert.equal(cal.cache[fer], undefined);
});

test('erro do Google fica na agenda, sem quebrar as outras', async () => {
  login();
  const G = fakeGoogle();
  await C.setGoogleCalendars('google:1', [{ gid: 'ana@gmail.com', name: 'Ana', writable: true }], { fetchFn: G.fetchFn });
  const ana = C.googleCalId('google:1', 'ana@gmail.com');
  const fail = async () => new Response(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }), { status: 403 });
  const cal = await C.refreshFeeds({ only: ana, force: true, fetchFn: fail });
  assert.match(cal.calendars.find((c) => c.id === ana).error, /ocupado/);
  // conta desconectada
  delete db.nt_accounts;
  const cal2 = await C.refreshFeeds({ only: ana, force: true, fetchFn: G.fetchFn });
  assert.match(cal2.calendars.find((c) => c.id === ana).error, /não conectada/);
  assert.equal(GCAL, 'https://www.googleapis.com/calendar/v3');
});
