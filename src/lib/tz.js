// NeuroTab — fusos horários sem biblioteca: converte "horário de parede" de um fuso (IANA) para instante e vice-versa,
// usando o Intl do navegador (que já conhece horário de verão de todos os lugares).

export const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

// Nomes de fuso do Windows (Outlook/Exchange mandam assim no .ics) → IANA. Os mais comuns.
const WINDOWS = {
  'E. South America Standard Time': 'America/Sao_Paulo', 'SA Eastern Standard Time': 'America/Cayenne', 'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/La_Paz', 'Bahia Standard Time': 'America/Bahia', 'Tocantins Standard Time': 'America/Araguaina',
  'Argentina Standard Time': 'America/Buenos_Aires', 'Pacific SA Standard Time': 'America/Santiago', 'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles', 'Central Standard Time (Mexico)': 'America/Mexico_City', 'Atlantic Standard Time': 'America/Halifax',
  'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw', 'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow', 'Tokyo Standard Time': 'Asia/Tokyo', 'China Standard Time': 'Asia/Shanghai', 'India Standard Time': 'Asia/Kolkata',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'UTC': 'UTC', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
};

const valid = new Map();
/** Nome de fuso utilizável (IANA). Nomes do Windows são traduzidos; desconhecidos viram o fuso do computador. */
export function normTz(tz) {
  if (!tz) return LOCAL_TZ;
  const name = String(tz).replace(/^\/+|"/g, '').trim();
  const t = WINDOWS[name] || name;
  if (!valid.has(t)) {
    let ok = true;
    try { new Intl.DateTimeFormat('en-US', { timeZone: t }); } catch { ok = false; }
    valid.set(t, ok);
  }
  return valid.get(t) ? t : LOCAL_TZ;
}

const fmts = new Map();
function fmt(tz) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  return fmts.get(tz);
}

/** Partes do horário de parede de um instante num fuso: { y, m (1-12), d, h, mi, s, wd (0=dom) }. */
export function wallParts(ts, tz = LOCAL_TZ) {
  const p = Object.fromEntries(fmt(normTz(tz)).formatToParts(new Date(ts)).filter((x) => x.type !== 'literal').map((x) => [x.type, +x.value]));
  const wd = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second, wd };
}

/** Diferença do fuso para UTC (ms) num instante. */
export function tzOffset(ts, tz) {
  const w = wallParts(ts, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ts / 1000) * 1000;
}

/** Instante (ms) de um horário de parede num fuso. Horário que "não existe" (pulo do verão) vai para depois do pulo. */
export function zonedToUtc(y, m, d, h = 0, mi = 0, s = 0, tz = LOCAL_TZ) {
  const zone = normTz(tz);
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let t = guess - tzOffset(guess, zone);
  const o2 = tzOffset(t, zone);
  t = guess - o2;
  return t;
}

// ---------- Datas de calendário (sem horário), em 'AAAA-MM-DD' ----------
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export function parseYmd(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return { y, m, d }; }
/** Soma dias a uma data de calendário. */
export function addDays(s, n) { const { y, m, d } = parseYmd(s); const t = new Date(Date.UTC(y, m - 1, d + n)); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
export const weekday = (s) => { const { y, m, d } = parseYmd(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Data de hoje (ou de um instante) no fuso do computador. */
export function todayYmd(ts = Date.now(), tz = LOCAL_TZ) { const w = wallParts(ts, tz); return ymd(w.y, w.m, w.d); }
/** Início do dia (instante) de uma data de calendário no fuso do computador. */
export function dayStart(s, tz = LOCAL_TZ) { const { y, m, d } = parseYmd(s); return zonedToUtc(y, m, d, 0, 0, 0, tz); }
