// Data Hub (#71): alertas de preço, variação, chuva e temperatura.
// Avisa uma vez quando o valor cruza o limite e só avisa de novo depois que ele volta (histerese).

export const ALERT_LABEL = {
  above: 'Preço acima de', below: 'Preço abaixo de', pct: 'Variação do dia de pelo menos (±%)',
  rain: 'Chance de chuva amanhã a partir de (%)', hot: 'Máxima de amanhã a partir de (°C)', cold: 'Mínima de amanhã até (°C)',
};
export const isWeatherAlert = (a) => ['rain', 'hot', 'cold'].includes(a.type);

// Amanhã a partir da previsão do Open-Meteo (o mesmo formato de getWeather).
export function tomorrowFrom(d) {
  if (!d?.daily?.time?.[1]) return null;
  return { date: d.daily.time[1], rain: d.daily.precipitation_probability_max?.[1] ?? null, max: d.daily.temperature_2m_max?.[1], min: d.daily.temperature_2m_min?.[1] };
}

function met(a, quote, tomorrow) {
  if (isWeatherAlert(a)) {
    if (!tomorrow) return null;
    if (a.type === 'rain') return tomorrow.rain == null ? null : tomorrow.rain >= a.value;
    if (a.type === 'hot') return tomorrow.max == null ? null : tomorrow.max >= a.value;
    return tomorrow.min == null ? null : tomorrow.min <= a.value;
  }
  if (!quote || quote.price == null || quote.stale) return null; // valor velho não dispara
  if (a.type === 'above') return quote.price >= a.value;
  if (a.type === 'below') return quote.price <= a.value;
  return Math.abs(quote.pct || 0) >= Math.abs(a.value);
}

/**
 * alerts: lista do settings.datahub.alerts. quotes: Map(itemKey → valor do hub). tomorrow: tomorrowFrom(...).
 * Devolve { fired: [{ alert, quote }], alerts (com `armed` atualizado), changed }.
 */
export function evaluateAlerts(alerts, quotes = new Map(), tomorrow = null) {
  const fired = [];
  let changed = false;
  const next = alerts.map((a) => {
    const m = met(a, quotes.get(a.item), tomorrow);
    if (m === null) return a;
    if (m && a.armed) { fired.push({ alert: a, quote: quotes.get(a.item) }); changed = true; return { ...a, armed: false }; }
    if (!m && !a.armed) { changed = true; return { ...a, armed: true }; }
    return a;
  });
  return { fired, alerts: next, changed };
}

const num = (v, d = 2) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d });

// Texto da notificação.
export function alertText({ alert: a, quote: q }, tomorrow) {
  const sym = (a.item || '').split(':')[1] || '';
  if (a.type === 'above') return { title: `📈 ${sym} acima de ${num(a.value)}`, message: `Agora: ${num(q.price)} (${q.pct >= 0 ? '+' : ''}${num(q.pct)}%) · fonte ${q.source}` };
  if (a.type === 'below') return { title: `📉 ${sym} abaixo de ${num(a.value)}`, message: `Agora: ${num(q.price)} (${q.pct >= 0 ? '+' : ''}${num(q.pct)}%) · fonte ${q.source}` };
  if (a.type === 'pct') return { title: `${q.pct >= 0 ? '📈' : '📉'} ${sym} ${q.pct >= 0 ? '+' : ''}${num(q.pct)}% hoje`, message: `Agora: ${num(q.price)} · fonte ${q.source}` };
  if (a.type === 'rain') return { title: `🌧️ Chuva amanhã: ${tomorrow.rain}%`, message: `Máxima ${Math.round(tomorrow.max)}° · mínima ${Math.round(tomorrow.min)}°` };
  if (a.type === 'hot') return { title: `🥵 Amanhã chega a ${Math.round(tomorrow.max)}°`, message: `Chance de chuva ${tomorrow.rain ?? 0}%` };
  return { title: `🥶 Amanhã a mínima é ${Math.round(tomorrow.min)}°`, message: `Máxima ${Math.round(tomorrow.max)}°` };
}
