// NeuroTab — Google Agenda pela conta (#26, 0.7.6.2).
// Lê as agendas da conta (lista de agendas) e os eventos de cada uma, já com as repetições abertas em datas
// (singleEvents), e cria, edita e exclui eventos lá. Usa o acesso da conta conectada (accounts.js), com a
// permissão "calendar" pedida só quando a pessoa liga a agenda.
import { authFetch } from './accounts.js';
import { tsToKeyTz } from './gcal-time.js';
import { rruleText } from './ics.js';
import { LOCAL_TZ, normTz } from './tz.js';

export const GCAL = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;

export class GcalError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function call(accountId, path, { method = 'GET', body, query, fetchFn, interactive = false } = {}) {
  const url = new URL(GCAL + path);
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== '') url.searchParams.set(k, v);
  const res = await authFetch(accountId, 'calendar', url.href, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }, { fetchFn, interactive });
  if (res.status === 204 || (method === 'DELETE' && (res.status === 410 || res.status === 404))) return null;
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || '';
    const msg =
      res.status === 403 && /insufficient|scope/i.test(reason + (data?.error?.message || '')) ? 'Falta a permissão da agenda. Escolha as agendas de novo para autorizar.'
      : res.status === 403 && /rateLimit|quota/i.test(reason) ? 'O Google Agenda está ocupado. A NeuroTab tenta de novo em alguns minutos.'
      : res.status === 403 ? 'Você não tem permissão para mudar esta agenda.'
      : res.status === 404 ? 'Esta agenda ou evento não existe mais no Google.'
      : res.status === 412 ? 'O evento mudou no Google enquanto você editava. Abra de novo e tente outra vez.'
      : `Google Agenda: erro ${res.status}.`;
    throw new GcalError(msg, res.status);
  }
  return data;
}

/** Agendas da conta: [{ gid, name, color, writable, primary }]. */
export async function listCalendars(accountId, { fetchFn, interactive = false } = {}) {
  const out = [];
  let pageToken;
  do {
    const r = await call(accountId, '/users/me/calendarList', { query: { maxResults: 250, pageToken, showHidden: 'false' }, fetchFn, interactive });
    for (const c of r?.items || []) {
      if (c.deleted || c.accessRole === 'freeBusyReader') continue;
      out.push({
        gid: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '',
        writable: c.accessRole === 'owner' || c.accessRole === 'writer', primary: !!c.primary, selected: c.selected !== false,
        tz: c.timeZone || '',
      });
    }
    pageToken = r?.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name));
}

/** Lembrete do Google → minutos antes (só pop-up), ou null. */
function reminderOf(item, defaults = []) {
  const list = item.reminders?.useDefault ? defaults : item.reminders?.overrides || [];
  const pop = list.filter((r) => r.method === 'popup').map((r) => r.minutes);
  return pop.length ? Math.min(...pop) : null;
}

/** Evento do Google → formato da agenda da NeuroTab (sem repetição: o Google já manda cada data). */
export function fromGoogle(item, { calTz = LOCAL_TZ, defaults = [] } = {}) {
  if (!item || item.status === 'cancelled' || !item.start) return null;
  const allDay = !!item.start.date;
  const tz = allDay ? null : normTz(item.start.timeZone || calTz || LOCAL_TZ);
  const key = (x) => (x.date ? x.date : tsToKeyTz(Date.parse(x.dateTime), tz));
  const meet = item.hangoutLink || item.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || '';
  return {
    uid: item.id,
    gid: item.id,
    seriesId: item.recurringEventId || null,
    title: item.summary || '(sem título)',
    location: item.location || '',
    notes: item.description || '',
    url: meet,
    link: item.htmlLink || '',
    allDay,
    tz,
    start: key(item.start),
    end: key(item.end || item.start),
    rrule: null,
    exdates: [],
    remind: reminderOf(item, defaults),
    updatedAt: item.updated ? Date.parse(item.updated) : 0,
  };
}

/** Evento da NeuroTab → corpo para o Google. */
export function toGoogle(ev, { series = true } = {}) {
  const at = (k) => (ev.allDay ? { date: k.slice(0, 10) } : { dateTime: `${k}:00`, timeZone: ev.tz || LOCAL_TZ });
  const body = {
    summary: ev.title || '',
    location: ev.location || '',
    description: ev.notes || '',
    start: at(ev.start),
    end: at(ev.end),
    reminders: ev.remind == null || ev.remind === '' ? { useDefault: true } : { useDefault: false, overrides: [{ method: 'popup', minutes: Math.max(0, +ev.remind) }] },
  };
  if (series && ev.rrule) body.recurrence = [`RRULE:${rruleText(ev.rrule)}`];
  return body;
}

/** Eventos de uma agenda entre dois instantes (repetições já abertas). */
export async function fetchEvents(accountId, gid, from, to, { fetchFn, calTz } = {}) {
  const out = [];
  let pageToken;
  let defaults = [];
  do {
    const r = await call(accountId, `/calendars/${enc(gid)}/events`, {
      query: { singleEvents: 'true', orderBy: 'startTime', timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), maxResults: 2500, pageToken },
      fetchFn,
    });
    defaults = r?.defaultReminders || defaults;
    for (const it of r?.items || []) { const e = fromGoogle(it, { calTz: r?.timeZone || calTz, defaults }); if (e) out.push(e); }
    pageToken = r?.nextPageToken;
  } while (pageToken);
  return out;
}

export async function insertEvent(accountId, gid, ev, { fetchFn } = {}) {
  return fromGoogle(await call(accountId, `/calendars/${enc(gid)}/events`, { method: 'POST', body: toGoogle(ev), fetchFn }), { calTz: ev.tz });
}

/** Edita um evento (ou só esta data, quando é uma repetição: o id é o da ocorrência). */
export async function patchEvent(accountId, gid, eventId, ev, { fetchFn } = {}) {
  return fromGoogle(await call(accountId, `/calendars/${enc(gid)}/events/${enc(eventId)}`, { method: 'PATCH', body: toGoogle(ev, { series: !ev.seriesId }), fetchFn }), { calTz: ev.tz });
}

export async function removeEvent(accountId, gid, eventId, { fetchFn } = {}) {
  await call(accountId, `/calendars/${enc(gid)}/events/${enc(eventId)}`, { method: 'DELETE', fetchFn });
}
