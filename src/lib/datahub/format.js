// Data Hub (#71): como mostrar e falar os valores, sempre com a fonte e o horário.
import { SOURCES } from './sources.js';
import { INDICATORS, INDEXES, itemKey } from './prefs.js';

export const sourceName = (id) => SOURCES[id]?.name || id || '';

export function timeLabel(at, now = Date.now(), lang = 'pt-BR') {
  if (!at) return '';
  const d = new Date(at);
  const same = new Date(now).toDateString() === d.toDateString();
  return same ? d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(lang, { day: '2-digit', month: '2-digit' });
}

export function itemTitle(it, v) {
  if (it.kind === 'indicator') return INDICATORS[it.sym]?.name || it.sym;
  if (it.kind === 'index') return INDEXES[it.sym] || it.sym;
  if (it.kind === 'currency' || it.kind === 'crypto') return it.sym.split('-')[0];
  return it.sym;
}
export function itemSub(it, v) {
  if (it.kind === 'indicator') return INDICATORS[it.sym]?.unit || '';
  if (it.kind === 'stock') return (v?.name || '').slice(0, 18);
  if (it.kind === 'currency' || it.kind === 'crypto') return (v?.name || '').slice(0, 18);
  return '';
}

export function priceText(it, v, lang = 'pt-BR') {
  return rawPrice(it, v, lang).replace(/[\u00a0\u202f]/g, ' ');
}
function rawPrice(it, v, lang) {
  if (v?.price == null) return '—';
  if (it.kind === 'indicator') return v.price.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  if (it.kind === 'index') return v.price.toLocaleString(lang, { maximumFractionDigits: 0 }) + ' pts';
  const cur = v.cur || 'BRL';
  try {
    return v.price.toLocaleString(lang, { style: 'currency', currency: cur, maximumFractionDigits: v.price >= 1000 ? 0 : v.price < 1 ? 4 : 2 });
  } catch { return v.price.toLocaleString(lang) + ' ' + cur; }
}

export function changeText(it, v, lang = 'pt-BR') {
  if (v?.price == null || v.pct == null) return { text: '', cls: '' };
  if (v.pctIsPoints) {
    if (!v.pct) return { text: '', cls: '' };
    return { text: `${v.pct > 0 ? '▲' : '▼'} ${Math.abs(v.pct).toLocaleString(lang, { maximumFractionDigits: 2 })} p.p.`, cls: '' };
  }
  return { text: `${v.pct >= 0 ? '▲' : '▼'} ${Math.abs(v.pct).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`, cls: v.pct >= 0 ? 'up' : 'down' };
}

// "BrAPI · 14:05 · atraso de ~30 min" (+ "desatualizado")
export function provenance(v, now = Date.now()) {
  if (!v?.source) return '';
  const parts = [sourceName(v.source), timeLabel(v.at, now)];
  if (v.period && !v.at) parts.push(v.period);
  if (v.delay) parts.push(`atraso de ~${v.delay} min`);
  if (v.stale) parts.push('desatualizado');
  return parts.filter(Boolean).join(' · ');
}

export const ERROR_LABEL = {
  key: '🔑 precisa de chave', paid: '🔒 plano pago da fonte', quota: '⏳ cota esgotada', notfound: 'não encontrado', net: 'sem conexão', http: 'indisponível', nosource: 'nenhuma fonte ligada',
};

// Uma linha de texto (voz e IA): "PETR4: R$ 38,20, alta de 1,20% (BrAPI, 14:05, atraso de ~30 min)".
export function spokenLine(it, v, now = Date.now()) {
  if (!v || v.price == null) return `${itemTitle(it)}: sem dados agora${v?.error ? ` (${v.error.message})` : ''}`;
  const name = itemTitle(it);
  const val = priceText(it, v);
  let chg = '';
  if (!v.pctIsPoints && v.pct != null) chg = `, ${v.pct >= 0 ? 'alta' : 'queda'} de ${Math.abs(v.pct).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  const unit = it.kind === 'indicator' ? ` ${INDICATORS[it.sym]?.unit.replace('% ', '') || ''}`.replace(' a.a.', ' ao ano') : '';
  return `${name}: ${val}${unit}${chg} (${provenance(v, now)})`;
}

export { itemKey };
