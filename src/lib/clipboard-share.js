// NeuroTab — compartilhar a área de transferência com outros aparelhos (preparado; ainda sem alvos).
//
// Cada item já nasce com deviceId e origin ('local' | 'remote'), e addClip aceita via: 'remote'.
// Um alvo é registrado com registerShareTarget({ id, name, send(item), pull?() }) e passa a aparecer
// nas configurações do widget. Planejado (docs/dev/AREA-DE-TRANSFERENCIA.md):
//   - outros computadores: arquivo criptografado na pasta oculta do Drive/OneDrive, com a chave da sincronização;
//   - celular: página do site que entra na mesma conta, digita a senha da sincronização e lê/envia itens,
//     sem servidor da NeuroTab no meio.
const targets = new Map();

export function registerShareTarget(t) {
  if (!t?.id || typeof t.send !== 'function') throw new Error('alvo inválido');
  targets.set(t.id, t);
  return () => targets.delete(t.id);
}
export const shareTargets = () => [...targets.values()];

/** Envia um item para os alvos ligados (nenhum por enquanto). Nunca envia o que veio de outro aparelho de volta. */
export async function shareItem(item, cfg) {
  if (!cfg?.share?.enabled || item.origin === 'remote') return [];
  const on = new Set(cfg.share.targets || []);
  const out = [];
  for (const t of shareTargets()) if (on.has(t.id)) out.push(await t.send(item).then(() => t.id, () => null));
  return out.filter(Boolean);
}
