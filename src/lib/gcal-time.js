// Instante → chave de parede 'AAAA-MM-DDTHH:MM' num fuso (separado para o gcal.js não depender do calendar.js).
import { wallParts, pad, ymd } from './tz.js';
export function tsToKeyTz(ts, tz) { const w = wallParts(ts, tz); return `${ymd(w.y, w.m, w.d)}T${pad(w.h)}:${pad(w.mi)}`; }
