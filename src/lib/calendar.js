// NeuroTab — agenda (#26).
// Agendas: a local (criar, editar, excluir) e as assinadas por link .ics (Google Agenda, Outlook, iCloud…),
// que são só leitura e se atualizam sozinhas. Os eventos guardam o horário de parede e o fuso, então
// recorrências seguem o horário certo mesmo com horário de verão.
import { zonedToUtc, wallParts, normTz, LOCAL_TZ, pad, ymd, parseYmd, addDays, weekday, daysInMonth, todayYmd, dayStart } from './tz.js';
import { parseICS } from './ics.js';

export const CAL_KEY = 'nt_calendar'; // { calendars: [...], events: [...] }  (eventos da agenda local)
export const CAL_CACHE_KEY = 'nt_calendar_cache'; // { [calId]: { events, fetchedAt } }  (agendas por link)
export const LOCAL_CAL = 'local';
export const COLORS = ['#7c6cf0', '#2f9e8f', '#e07a3f', '#d04a6a', '#3f8fe0', '#8a9a2b', '#b05cd6', '#6b7280'];
export const REFRESH_MIN = 30; // atualização das agendas por link

const store = () => globalThis.chrome?.storage?.local;

export function defaultCalendars() {
  return [{ id: LOCAL_CAL, type: 'local', name: 'Minha agenda', color: COLORS[0], visible: true }];
}

export async function loadCalendar() {
  const r = await store().get([CAL_KEY, CAL_CACHE_KEY]);
  const data = r[CAL_KEY] || {};
  const calendars = Array.isArray(data.calendars) && data.calendars.length ? data.calendars : defaultCalendars();
  if (!calendars.some((c) => c.id === LOCAL_CAL)) calendars.unshift(defaultCalendars()[0]);
  return { calendars, events: Array.isArray(data.events) ? data.events : [], cache: r[CAL_CACHE_KEY] || {} };
}

export async function saveCalendar({ calendars, events }) {
  await store().set({ [CAL_KEY]: { calendars, events } });
}

const uid = () => `nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@neurotab`;

// ---------- Eventos locais ----------
/** Cria ou atualiza um evento da agenda local. */
export async function saveEvent(ev) {
  const cal = await loadCalendar();
  const clean = normalizeEvent(ev);
  const i = cal.events.findIndex((e) => e.id === clean.id);
  if (i >= 0) cal.events[i] = { ...cal.events[i], ...clean, updatedAt: Date.now() };
  else cal.events.push({ ...clean, createdAt: Date.now(), updatedAt: Date.now() });
  await saveCalendar(cal);
  return clean;
}

export async function deleteEvent(id, { occurrence } = {}) {
  const cal = await loadCalendar();
  const ev = cal.events.find((e) => e.id === id);
  if (!ev) return;
  if (occurrence && ev.rrule) {
    // só esta ocorrência
    ev.exdates = [...new Set([...(ev.exdates || []), occurrence])];
    if (ev.overrides) delete ev.overrides[occurrence];
  } else cal.events = cal.events.filter((e) => e.id !== id);
  await saveCalendar(cal);
}

/** Deixa um evento coerente: datas, fim depois do início, fuso, título. */
export function normalizeEvent(ev) {
  const allDay = !!ev.allDay;
  let start = String(ev.start || todayYmd());
  let end = String(ev.end || '');
  if (allDay) {
    start = start.slice(0, 10);
    end = end ? end.slice(0, 10) : addDays(start, 1);
    if (end <= start) end = addDays(start, 1);
  } else {
    if (start.length === 10) start += 'T09:00';
    if (!end || end.length === 10) end = keyPlus(start, 60);
    if (end <= start) end = keyPlus(start, 60);
  }
  return {
    id: ev.id || uid(),
    uid: ev.uid || ev.id || uid(),
    cal: LOCAL_CAL,
    title: String(ev.title || '').trim() || '(sem título)',
    location: String(ev.location || '').trim(),
    notes: String(ev.notes || '').trim(),
    url: String(ev.url || '').trim(),
    allDay,
    tz: allDay ? null : normTz(ev.tz || LOCAL_TZ),
    start,
    end,
    rrule: ev.rrule || null,
    exdates: ev.exdates || [],
    overrides: ev.overrides || undefined,
    alarm: ev.alarm === '' || ev.alarm == null ? null : Math.max(0, +ev.alarm),
  };
}

// ---------- Horários ----------
function keyToParts(k) {
  const [date, time] = k.split('T');
  const { y, m, d } = parseYmd(date);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return { y, m, d, h, mi };
}
/** Instante (ms) de uma chave 'AAAA-MM-DD[THH:MM]' no fuso dado (dia inteiro: início do dia no fuso do computador). */
export function keyToTs(k, tz) {
  const p = keyToParts(k);
  return k.length === 10 ? zonedToUtc(p.y, p.m, p.d, 0, 0, 0, LOCAL_TZ) : zonedToUtc(p.y, p.m, p.d, p.h, p.mi, 0, tz || LOCAL_TZ);
}
export function keyPlus(k, minutes) {
  const p = keyToParts(k);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi + minutes));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
/** Instante → chave de parede no fuso. */
export function tsToKey(ts, tz = LOCAL_TZ) { const w = wallParts(ts, tz); return `${ymd(w.y, w.m, w.d)}T${pad(w.h)}:${pad(w.mi)}`; }

// ---------- Recorrência ----------
const MAX_STEPS = 4000;

/** Datas (AAAA-MM-DD) candidatas de uma regra, a partir do início, em ordem. */
function* candidates(startDate, r) {
  const s = parseYmd(startDate);
  const iv = r.interval || 1;
  if (r.freq === 'DAILY') {
    for (let i = 0; ; i += iv) yield addDays(startDate, i);
  }
  if (r.freq === 'WEEKLY') {
    const days = r.byday?.length ? [...new Set(r.byday.map((b) => b.wd))].sort() : [weekday(startDate)];
    const weekStart = addDays(startDate, -weekday(startDate)); // domingo
    for (let w = 0; ; w += iv) {
      const base = addDays(weekStart, w * 7);
      for (const wd of days) { const d = addDays(base, wd); if (d >= startDate) yield d; }
    }
  }
  if (r.freq === 'MONTHLY' || r.freq === 'YEARLY') {
    const step = r.freq === 'MONTHLY' ? iv : iv * 12;
    for (let k = 0; ; k += step) {
      const months = r.freq === 'YEARLY' && r.bymonth?.length ? r.bymonth.map((bm) => ({ y: s.y + Math.floor((s.m - 1 + k) / 12), m: bm })) : [{ y: s.y + Math.floor((s.m - 1 + k) / 12), m: ((s.m - 1 + k) % 12) + 1 }];
      for (const { y, m } of months) {
        const dim = daysInMonth(y, m);
        let days = [];
        if (r.byday?.length) {
          for (const b of r.byday) {
            const all = [];
            for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.wd) all.push(d);
            if (!b.n) days.push(...all);
            else { const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (pick) days.push(pick); }
          }
        } else if (r.bymonthday?.length) days = r.bymonthday.map((d) => (d < 0 ? dim + d + 1 : d)).filter((d) => d >= 1 && d <= dim);
        else if (s.d <= dim) days = [s.d]; // dia 31 não existe em todo mês: pula
        for (const d of [...new Set(days)].sort((a, b) => a - b)) { const k2 = ymd(y, m, d); if (k2 >= startDate) yield k2; }
      }
    }
  }
}

/**
 * Ocorrências de um evento que tocam o intervalo [from, to) (instantes em ms).
 * Cada ocorrência: { ev, key (início de parede, identifica a ocorrência), start, end (ms), allDay }.
 */
export function occurrences(ev, from, to) {
  const out = [];
  const time = ev.allDay ? '' : ev.start.slice(10);
  const durMs = keyToTs(ev.end, ev.tz) - keyToTs(ev.start, ev.tz);
  const durDays = ev.allDay ? Math.max(1, Math.round(durMs / 864e5)) : 0;
  const ex = new Set(ev.exdates || []);
  const push = (k) => {
    const o = ev.overrides?.[k];
    const src = o || ev;
    const start = keyToTs(o ? o.start : k, src.tz || ev.tz);
    const end = o ? keyToTs(o.end, src.tz || ev.tz) : (ev.allDay ? keyToTs(addDays(k, durDays), null) : start + durMs);
    if (end > from && start < to) out.push({ ev: o ? { ...ev, ...o, id: ev.id, cal: ev.cal } : ev, key: k, start, end, allDay: !!src.allDay });
  };
  if (!ev.rrule) { push(ev.start); return out; }
  const r = ev.rrule;
  let n = 0;
  let steps = 0;
  // Sem COUNT, diário e semanal pulam direto para perto do intervalo (evento antigo não percorre anos de dias).
  let first = ev.start.slice(0, 10);
  if (!r.count && (r.freq === 'DAILY' || r.freq === 'WEEKLY')) {
    const span = (r.freq === 'DAILY' ? 1 : 7) * (r.interval || 1);
    const gap = Math.floor((from - keyToTs(ev.end, ev.tz)) / 864e5 / span) - 1;
    if (gap > 0) first = addDays(first, gap * span);
  }
  for (const date of candidates(first, r)) {
    if (++steps > MAX_STEPS) break;
    const k = date + time;
    if (r.until && k > r.until) break;
    n++;
    if (r.count && n > r.count) break;
    if (keyToTs(k, ev.tz) >= to) break;
    if (!ex.has(k)) push(k);
  }
  // ocorrências movidas para dentro do intervalo
  for (const [k, o] of Object.entries(ev.overrides || {})) {
    if (out.some((x) => x.key === k) || ex.has(k)) continue;
    const s = keyToTs(o.start, o.tz || ev.tz);
    const e = keyToTs(o.end, o.tz || ev.tz);
    if (e > from && s < to) out.push({ ev: { ...ev, ...o, id: ev.id, cal: ev.cal }, key: k, start: s, end: e, allDay: !!o.allDay });
  }
  return out;
}

/** Todas as ocorrências visíveis no intervalo, de todas as agendas visíveis, em ordem. */
export function eventsBetween(cal, from, to) {
  const visible = new Map(cal.calendars.filter((c) => c.visible !== false).map((c) => [c.id, c]));
  const out = [];
  const add = (ev, c) => { for (const o of occurrences(ev, from, to)) out.push({ ...o, calendar: c }); };
  if (visible.has(LOCAL_CAL)) for (const ev of cal.events) add(ev, visible.get(LOCAL_CAL));
  for (const c of visible.values()) {
    if (c.id === LOCAL_CAL) continue;
    for (const ev of cal.cache[c.id]?.events || []) add({ ...ev, cal: c.id, id: `${c.id}:${ev.uid}` }, c);
  }
  return out.sort((a, b) => a.start - b.start || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));
}

// ---------- Agendas por link (.ics) ----------
/** Endereço de assinatura: webcal:// vira https://. */
export function normalizeFeedUrl(u) {
  const s = String(u || '').trim().replace(/^webcal:\/\//i, 'https://');
  try { const x = new URL(s); if (!/^https?:$/.test(x.protocol)) return null; return x.href; } catch { return null; }
}

/** Nome sugerido para um link conhecido. */
export function guessFeedName(url) {
  if (/calendar\.google\.com/.test(url)) return 'Google Agenda';
  if (/outlook\.(office|live)\d*\.com|office365/.test(url)) return 'Outlook';
  if (/icloud\.com/.test(url)) return 'iCloud';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Agenda'; }
}

/** Baixa e lê uma agenda por link. Devolve { name, events }. */
export async function fetchFeed(url, { fetchFn = fetch } = {}) {
  let res;
  try {
    res = await fetchFn(url, { cache: 'no-store', credentials: 'omit' });
  } catch {
    throw new Error('Não consegui baixar a agenda. Verifique a internet e se o link está certo.');
  }
  if (res.status === 401 || res.status === 403) throw new Error('O serviço recusou o acesso. Confira se o link é o "endereço secreto" ou se a agenda está publicada.');
  if (res.status === 404) throw new Error('Link não encontrado. Ele pode ter sido redefinido no serviço.');
  if (!res.ok) throw new Error(`O serviço respondeu com erro (HTTP ${res.status}).`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Esse link não é de uma agenda .ics. No Google Agenda, use o "Endereço secreto no formato iCal".');
  return parseICS(text);
}

/** Atualiza as agendas por link (todas ou uma), guardando o resultado e o erro de cada uma. */
export async function refreshFeeds({ only = null, force = false, fetchFn } = {}) {
  const cal = await loadCalendar();
  const now = Date.now();
  let changed = false;
  for (const c of cal.calendars) {
    if (c.type !== 'ics' || (only && c.id !== only)) continue;
    if (!force && c.lastSync && now - c.lastSync < REFRESH_MIN * 60e3) continue;
    try {
      const r = await fetchFeed(c.url, { fetchFn });
      cal.cache[c.id] = { events: r.events, fetchedAt: now };
      Object.assign(c, { lastSync: now, error: '', count: r.events.length });
      if (!c.name && r.name) c.name = r.name;
    } catch (e) {
      Object.assign(c, { lastSync: now, error: e.message });
    }
    changed = true;
  }
  if (changed) await store().set({ [CAL_KEY]: { calendars: cal.calendars, events: cal.events }, [CAL_CACHE_KEY]: cal.cache });
  return cal;
}

/** Adiciona uma agenda por link e já baixa. */
export async function addFeed(url, { name = '', fetchFn } = {}) {
  const u = normalizeFeedUrl(url);
  if (!u) throw new Error('Link inválido. Cole o endereço que começa com https:// ou webcal://.');
  const cal = await loadCalendar();
  if (cal.calendars.some((c) => c.url === u)) throw new Error('Essa agenda já foi adicionada.');
  const r = await fetchFeed(u, { fetchFn });
  const c = { id: 'ics-' + Date.now().toString(36), type: 'ics', name: name || r.name || guessFeedName(u), url: u, color: COLORS[cal.calendars.length % COLORS.length], visible: true, lastSync: Date.now(), error: '', count: r.events.length };
  cal.calendars.push(c);
  cal.cache[c.id] = { events: r.events, fetchedAt: Date.now() };
  await store().set({ [CAL_KEY]: { calendars: cal.calendars, events: cal.events }, [CAL_CACHE_KEY]: cal.cache });
  return c;
}

export async function updateCalendarMeta(id, patch) {
  const cal = await loadCalendar();
  const c = cal.calendars.find((x) => x.id === id);
  if (!c) return;
  Object.assign(c, patch);
  await saveCalendar(cal);
}

/** Remove uma agenda por link (a local não pode ser removida). */
export async function removeCalendar(id) {
  if (id === LOCAL_CAL) return;
  const cal = await loadCalendar();
  cal.calendars = cal.calendars.filter((c) => c.id !== id);
  delete cal.cache[id];
  await store().set({ [CAL_KEY]: { calendars: cal.calendars, events: cal.events }, [CAL_CACHE_KEY]: cal.cache });
}

/** Importa um arquivo .ics para a agenda local, sem duplicar (mesmo UID substitui). Devolve quantos entraram. */
export async function importICS(text) {
  const { events } = parseICS(text);
  if (!events.length) throw new Error('Nenhum evento encontrado no arquivo.');
  const cal = await loadCalendar();
  const byUid = new Map(cal.events.map((e) => [e.uid, e]));
  let n = 0;
  for (const ev of events) {
    const old = byUid.get(ev.uid);
    const clean = normalizeEvent({ ...ev, id: old?.id, overrides: ev.overrides });
    if (old) Object.assign(old, clean, { updatedAt: Date.now() });
    else cal.events.push({ ...clean, createdAt: Date.now(), updatedAt: Date.now() });
    n++;
  }
  await saveCalendar(cal);
  return n;
}

// ---------- Texto para o cérebro e a voz ----------
/** Ocorrências de hoje até N dias, para perguntas como "o que tenho amanhã?". */
export async function upcoming(days = 7, from = Date.now()) {
  const cal = await loadCalendar();
  const start = dayStart(todayYmd(from));
  return eventsBetween(cal, start, start + days * 864e5).filter((o) => o.end > from);
}

const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const occLine = (o, tr = (x) => x) => `${o.allDay ? tr('dia todo') : hm(o.start)} ${o.ev.title}${o.ev.location ? ` (${o.ev.location})` : ''}`;

/**
 * Resumo falado/escrito da agenda de um dia (0 = hoje, 1 = amanhã…). Hoje só mostra o que ainda não acabou.
 * tr: tradução (padrões "Agenda de hoje: {0}." etc.). Devolve '' se não houver nenhuma agenda com eventos.
 */
export async function agendaText(offset = 0, tr = (x) => x, now = Date.now()) {
  const cal = await loadCalendar();
  const hasAny = cal.events.length || Object.values(cal.cache).some((c) => c.events?.length);
  if (!hasAny) return '';
  const day = addDays(todayYmd(now), offset);
  const occ = eventsBetween(cal, dayStart(day), dayStart(addDays(day, 1))).filter((o) => offset > 0 || o.end > now);
  const label = offset === 0 ? 'hoje' : offset === 1 ? 'amanhã' : 'depois de amanhã';
  if (!occ.length) return tr(`Nada na agenda ${label}.`);
  const list = occ.slice(0, 6).map((o) => occLine(o, tr)).join('; ') + (occ.length > 6 ? `; +${occ.length - 6}` : '');
  return tr(`Agenda de ${label}: ${list}.`);
}

/** Agenda dos próximos dias em texto, para a IA responder perguntas ("tenho algo livre na quinta?"). */
export async function calendarContext(days = 14, now = Date.now()) {
  const cal = await loadCalendar();
  const from = dayStart(todayYmd(now));
  const occ = eventsBetween(cal, from - 864e5, from + days * 864e5).slice(0, 80);
  if (!occ.length) return '';
  const lines = [];
  let last = '';
  for (const o of occ) {
    const d = todayYmd(o.start);
    if (d !== last) { lines.push(`${d} (${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][weekday(d)]}):`); last = d; }
    lines.push(`- ${o.allDay ? 'dia todo' : `${hm(o.start)}–${hm(o.end)}`} ${o.ev.title}${o.ev.location ? ` · ${o.ev.location}` : ''} [${o.calendar.name}]`);
  }
  return lines.join('\n');
}

