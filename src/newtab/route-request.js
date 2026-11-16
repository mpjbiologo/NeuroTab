// NeuroTab — pedido de rota vindo do cérebro ou da voz: mostra o trajeto no widget Trânsito (maximizado),
// sem abrir site externo. Se o widget não estiver na tela, ele é acrescentado e pega o pedido ao montar.
import { S, bus } from './state.js';
import { saveWidgets, autoPlace, addFreeCard } from './free.js';
import { addGridCard } from './grid.js';
import { isFree } from './widgets.js';
import { $ } from '../lib/ui.js';

let pending = null;

/** trip = { from, to, mode } (from/to: local salvo, { name, query } ou null) ou { live: true, to } para o trânsito ao vivo. */
export async function showRoute(trip) {
  if (!trip || (!trip.to && !trip.live)) return false;
  pending = trip;
  const widgets = S.data.settings.widgets;
  if (!widgets.some((w) => w.id === 'traffic')) {
    const nw = { id: 'traffic', w: 6 };
    if (isFree()) Object.assign(nw, autoPlace(nw, $('#widgets')?.clientWidth || innerWidth), { fz: ++S.zTop });
    widgets.push(nw);
    await saveWidgets();
    // Só o widget novo é montado (os outros, como a conversa do cérebro, continuam como estão);
    // ele chama takeRoute() ao montar.
    $('#widgets')?.querySelector(':scope > p.muted')?.remove();
    if (isFree()) addFreeCard(nw, widgets.length - 1);
    else addGridCard(nw, widgets.length - 1);
    return true;
  }
  bus.emit('route.requested', trip);
  return true;
}

/** O widget Trânsito pega (e limpa) o pedido pendente. */
export function takeRoute() {
  const p = pending;
  pending = null;
  return p;
}
