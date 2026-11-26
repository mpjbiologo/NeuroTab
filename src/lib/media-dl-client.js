// NeuroTab — pedir um download de mídia a partir de uma página da extensão (0.9.3.1).
// Pede as permissões no clique (um pedido só, para o Firefox não perder o gesto) e manda o fundo baixar.
import { requestAccess } from './permissions.js';
import { sanitizeMediaDl, originsFor } from './media-download.js';
import { dlSiteOf } from './media-sites.js';

const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ error: e.message }));

/** Permissões que cada download precisa (o que vai pelo navegador e o que vai pela Ponte). */
export function permsFor(it, what, mediaDl, via = null) {
  const c = sanitizeMediaDl(mediaDl);
  const s = dlSiteOf(it.url || '');
  const site = originsFor(it.url || '');
  const ponte = (cookies = c.cookies) => ({ permissions: ['nativeMessaging', ...(cookies ? ['cookies'] : [])], origins: cookies ? site : [] });
  if (what === 'photos') return { permissions: ['downloads'], origins: site };
  if (what === 'audio') return s.direct === 'audio' && via !== 'ponte' ? { permissions: ['downloads'], origins: [] } : ponte();
  if (via === 'ponte' || c.engine === 'ponte') return ponte();
  if (c.engine === 'browser' || !s.browser) return { permissions: ['downloads'], origins: s.browser ? site : [] };
  return { permissions: ['downloads'], origins: site };
}

/**
 * Baixa o vídeo, só o áudio ou as fotos de um item Mídia. Chame direto do clique.
 * Devolve a resposta do fundo: { ok, download } | { need: 'ponte' } | { error, code }.
 */
export async function startMediaDownload(it, what, mediaDl, { via = null } = {}) {
  const p = permsFor(it, what, mediaDl, via);
  const ok = await requestAccess(p);
  if (!ok) {
    const c = sanitizeMediaDl(mediaDl);
    // sem a permissão do site dá para tentar assim mesmo (aba aberta, Ponte sem login); sem downloads/Ponte, não
    const needed = p.permissions.includes('downloads') ? ['downloads'] : ['nativeMessaging'];
    if (!(await chrome.permissions.contains({ permissions: needed }).catch(() => false))) {
      return { error: needed[0] === 'downloads' ? 'Sem a permissão de downloads, não dá para baixar.' : 'Sem a permissão, a NeuroTab Ponte não pode baixar.', code: 'permission' };
    }
    if (c.engine === 'browser' && what === 'video') return { error: 'Sem a permissão do site, o navegador não acha o vídeo.', code: 'permission' };
  }
  return send({ type: 'media:download', id: it.id, what, via });
}

export const revealMedia = (id, what = 'video', open = false) => send({ type: 'media:reveal', id, what, open });
export const cancelMedia = (key) => send({ type: 'media:download-cancel', key });
