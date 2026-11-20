// NeuroTab — leitor e gerador de iCalendar (.ics, RFC 5545), o formato que Google Agenda, Outlook, iCloud e
// outros usam para exportar e publicar agendas. Lê eventos, recorrências (RRULE), exceções (EXDATE e
// RECURRENCE-ID), eventos cancelados, fuso (TZID, inclusive nomes do Windows), dia inteiro e alarmes.
import { normTz, wallParts, zonedToUtc, LOCAL_TZ, pad } from './tz.js';

/** Junta as linhas dobradas (continuação começa com espaço ou tab). */
function unfold(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

const unescape = (v) => v.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');
const escapeText = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

function parseLine(line) {
  // NOME;PARAM=V;PARAM="V:com:dois-pontos":VALOR
  let i = 0;
  let inQ = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...ps] = head.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const params = {};
  for (const p of ps) {
    const k = p.indexOf('=');
    if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * Data/hora do .ics → { date: 'AAAA-MM-DD', time: 'HH:MM' | null, tz }.
 * UTC ("Z") é convertido para o fuso do evento (ou do computador) para a recorrência seguir o horário de parede.
 */
export function parseDateValue(value, params = {}, eventTz = '') {
  const v = String(value).trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (params.VALUE === 'DATE' || hh === undefined) return { date: `${y}-${mo}-${d}`, time: null, tz: null };
  if (z) {
    const tz = normTz(eventTz || LOCAL_TZ);
    const w = wallParts(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)), tz);
    return { date: `${w.y}-${pad(w.m)}-${pad(w.d)}`, time: `${pad(w.h)}:${pad(w.mi)}`, tz };
  }
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mi}`, tz: params.TZID ? normTz(params.TZID) : (eventTz ? normTz(eventTz) : LOCAL_TZ) };
}

/** Duração ISO (P1D, PT1H30M, -PT15M) → minutos. */
export function parseDuration(v) {
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const total = (+(w || 0)) * 10080 + (+(d || 0)) * 1440 + (+(h || 0)) * 60 + (+(mi || 0)) + Math.round((+(s || 0)) / 60);
  return sign === '-' ? -total : total;
}

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const WD_NAME = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** RRULE → { freq, interval, count, until, byday: [{ wd, n }], bymonthday, bymonth }. */
export function parseRRule(v, tz) {
  const r = { freq: '', interval: 1 };
  for (const part of String(v).split(';')) {
    const [k, val] = part.split('=');
    if (!val) continue;
    switch (k.toUpperCase()) {
      case 'FREQ': r.freq = val.toUpperCase(); break;
      case 'INTERVAL': r.interval = Math.max(1, +val || 1); break;
      case 'COUNT': r.count = +val; break;
      case 'UNTIL': { const d = parseDateValue(val, {}, tz); if (d) r.until = d.time ? `${d.date}T${d.time}` : `${d.date}T23:59`; break; }
      case 'BYDAY': r.byday = val.split(',').map((x) => { const m = x.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i); return m ? { n: m[1] ? +m[1] : 0, wd: WD[m[2].toUpperCase()] } : null; }).filter(Boolean); break;
      case 'BYMONTHDAY': r.bymonthday = val.split(',').map(Number).filter(Boolean); break;
      case 'BYMONTH': r.bymonth = val.split(',').map(Number).filter(Boolean); break;
      default: break;
    }
  }
  return ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq) ? r : null;
}

const key = (d) => (d.time ? `${d.date}T${d.time}` : d.date);

/**
 * Lê um .ics. Devolve { name, events } no formato da agenda da NeuroTab:
 * { uid, title, location, notes, url, allDay, tz, start, end, rrule, exdates: [], overrides: { chave: evento }, cancelled, alarm }.
 * start/end: 'AAAA-MM-DD' (dia inteiro, fim exclusivo) ou 'AAAA-MM-DDTHH:MM' (horário de parede no fuso tz).
 */
export function parseICS(text) {
  const lines = unfold(text);
  let name = '';
  let calTz = '';
  const raw = [];
  let cur = null;
  let depth = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const { name: n, params, value } = parseLine(line);
    if (n === 'BEGIN') { depth.push(value.toUpperCase()); if (value.toUpperCase() === 'VEVENT') cur = { props: [], alarm: null }; continue; }
    if (n === 'END') {
      const what = depth.pop();
      if (what === 'VEVENT' && cur) { raw.push(cur); cur = null; }
      continue;
    }
    const where = depth[depth.length - 1];
    if (where === 'VCALENDAR') {
      if (n === 'X-WR-CALNAME') name = unescape(value);
      if (n === 'X-WR-TIMEZONE') calTz = value;
    } else if (where === 'VEVENT' && cur) cur.props.push({ n, params, value });
    else if (where === 'VALARM' && cur && n === 'TRIGGER' && cur.alarm === null) {
      const min = parseDuration(value);
      if (min !== null && min <= 0) cur.alarm = -min;
    }
  }

  const masters = new Map();
  const overrides = [];
  for (const r of raw) {
    const get = (n) => r.props.find((p) => p.n === n);
    const all = (n) => r.props.filter((p) => p.n === n);
    const dtstart = get('DTSTART');
    if (!dtstart) continue;
    const tz0 = dtstart.params.TZID || calTz || '';
    const s = parseDateValue(dtstart.value, dtstart.params, tz0);
    if (!s) continue;
    const tz = s.tz || normTz(calTz || LOCAL_TZ);
    let e = get('DTEND') ? parseDateValue(get('DTEND').value, get('DTEND').params, tz) : null;
    if (e?.time && e.tz && e.tz !== tz) {
      // fim em outro fuso: converte para o horário de parede do fuso do início
      const [y, m, d] = e.date.split('-').map(Number);
      const [h, mi] = e.time.split(':').map(Number);
      const w = wallParts(zonedToUtc(y, m, d, h, mi, 0, e.tz), tz);
      e = { date: `${w.y}-${pad(w.m)}-${pad(w.d)}`, time: `${pad(w.h)}:${pad(w.mi)}`, tz };
    }
    const dur = get('DURATION') ? parseDuration(get('DURATION').value) : null;
    const allDay = !s.time;
    const start = key(s);
    let end = e ? key(e) : null;
    if (!end) end = allDay ? addDaysKey(start, Math.max(1, Math.round((dur ?? 1440) / 1440))) : addMinutesKey(start, dur ?? 60);
    if (allDay && end <= start) end = addDaysKey(start, 1);
    const ev = {
      uid: get('UID')?.value || `ics-${start}-${Math.random().toString(36).slice(2, 8)}`,
      title: unescape(get('SUMMARY')?.value || '(sem título)'),
      location: unescape(get('LOCATION')?.value || ''),
      notes: unescape(get('DESCRIPTION')?.value || '').slice(0, 4000),
      url: get('URL')?.value || '',
      allDay,
      tz: allDay ? null : tz,
      start,
      end,
      rrule: get('RRULE') ? parseRRule(get('RRULE').value, tz) : null,
      exdates: all('EXDATE').flatMap((p) => p.value.split(',').map((v) => parseDateValue(v, p.params, tz)).filter(Boolean).map(key)),
      cancelled: /CANCELLED/i.test(get('STATUS')?.value || ''),
      alarm: r.alarm ?? null,
    };
    const rid = get('RECURRENCE-ID');
    if (rid) {
      const d = parseDateValue(rid.value, rid.params, tz);
      if (d) overrides.push({ rid: key(d), ev });
    } else if (!ev.cancelled) masters.set(ev.uid, ev);
  }
  for (const { rid, ev } of overrides) {
    const m = masters.get(ev.uid);
    if (!m) { if (!ev.cancelled) masters.set(`${ev.uid}#${rid}`, { ...ev, uid: `${ev.uid}#${rid}` }); continue; }
    m.overrides ||= {};
    if (ev.cancelled) m.exdates.push(rid);
    else m.overrides[rid] = { ...ev, rrule: null };
  }
  return { name, events: [...masters.values()] };
}

function addDaysKey(k, n) {
  const [y, m, d] = k.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}${k.slice(10)}`;
}
function addMinutesKey(k, n) {
  const [date, time = '00:00'] = k.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h, mi + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

// ---------- Gerar .ics (exportar a agenda local) ----------
const icsDate = (k, tz) => (k.length === 10 ? `;VALUE=DATE:${k.replace(/-/g, '')}` : `;TZID=${tz}:${k.replace(/[-:]/g, '')}00`);
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };

export function rruleText(r) {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/[-:]/g, '').slice(0, 13)}00`);
  if (r.byday?.length) parts.push(`BYDAY=${r.byday.map((b) => (b.n ? b.n : '') + WD_NAME[b.wd]).join(',')}`);
  if (r.bymonthday?.length) parts.push(`BYMONTHDAY=${r.bymonthday.join(',')}`);
  if (r.bymonth?.length) parts.push(`BYMONTH=${r.bymonth.join(',')}`);
  return parts.join(';');
}

/** Gera um .ics com os eventos (agenda local da NeuroTab). */
export function toICS(events, { name = 'NeuroTab' } = {}) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NeuroTab//Agenda//PT', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeText(name)}`];
  for (const e of events) {
    out.push('BEGIN:VEVENT', `UID:${e.uid || e.id}`, `DTSTAMP:${now}`, `DTSTART${icsDate(e.start, e.tz)}`, `DTEND${icsDate(e.end, e.tz)}`, `SUMMARY:${escapeText(e.title)}`);
    if (e.location) out.push(`LOCATION:${escapeText(e.location)}`);
    if (e.notes) out.push(`DESCRIPTION:${escapeText(e.notes)}`);
    if (e.url) out.push(`URL:${e.url}`);
    if (e.rrule) out.push(`RRULE:${rruleText(e.rrule)}`);
    for (const x of e.exdates || []) out.push(`EXDATE${icsDate(x, e.tz)}`);
    if (e.alarm != null) out.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:-PT${e.alarm}M`, 'END:VALARM');
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.map(fold).join('\r\n') + '\r\n';
}
