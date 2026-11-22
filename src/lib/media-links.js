// NeuroTab — links de mídia: extrair, reconhecer a plataforma e padronizar para não salvar duas vezes (#67).
// Adaptado do Kora (MIT) — https://github.com/Joaovitor12j/kora — src/kora/urls.py. Copyright (c) 2026 Joao V Santos.
// Licença completa em THIRD-PARTY-NOTICES.md.

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}»]+$/;

/** Encurtadores que precisam de uma requisição para revelar o destino. */
export const SHORTENERS = new Set(['vt.tiktok.com', 'vm.tiktok.com', 't.co', 'instagr.am', 'bit.ly']);

export const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'igshid', 'igsh', 'si', 'feature', 'ref', 'ref_src', 's', 't', '_r', '_t', 'srtk', 'psln', 'exln', 'is_from_webview']);

/** Plataformas em que a identidade do conteúdo está toda no caminho. */
const PATH_ONLY = new Set(['instagram', 'tiktok', 'x']);

export const PLATFORMS = {
  instagram: { label: 'Instagram', icon: '📸' },
  tiktok: { label: 'TikTok', icon: '🎵' },
  x: { label: 'X', icon: '𝕏' },
  youtube: { label: 'YouTube', icon: '▶️' },
  web: { label: 'Artigo', icon: '📰' },
};

export function extractUrls(text) {
  const seen = new Set();
  for (const m of String(text || '').matchAll(URL_RE)) seen.add(m[0].replace(TRAILING, ''));
  return [...seen];
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, ''); } catch { return ''; }
}

export function platformOf(url) {
  const host = hostOf(url);
  if (host.endsWith('instagram.com') || host === 'instagr.am') return 'instagram';
  if (host.endsWith('tiktok.com')) return 'tiktok';
  if (['x.com', 'twitter.com', 'mobile.twitter.com', 'fxtwitter.com', 'vxtwitter.com'].includes(host)) return 'x';
  if (['youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return 'youtube';
  return 'web';
}

export const needsResolution = (url) => SHORTENERS.has(hostOf(url));

/** É um link que vale salvar como mídia (rede social ou vídeo)? Artigos também servem, mas não são "mídia" óbvia. */
export const isMediaUrl = (url) => platformOf(url) !== 'web';

/** URL estável para deduplicação: sem rastreio, host normalizado, sem fragmento. */
export function canonicalize(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return String(raw || '').trim(); }
  const platform = platformOf(u.href);
  let host = hostOf(u.href);
  let path = u.pathname;

  if (platform === 'youtube') {
    let vid = '';
    if (host === 'youtu.be') vid = path.replace(/^\/+|\/+$/g, '');
    else {
      vid = u.searchParams.get('v') || '';
      if (!vid && /^\/(shorts|live)\//.test(path)) vid = path.split('/')[2] || '';
    }
    if (vid) return `https://www.youtube.com/watch?v=${vid}`;
  }

  if (platform === 'x') host = 'x.com';
  else if (host === 'instagr.am') host = 'www.instagram.com';
  else if (host === 'instagram.com' || host === 'tiktok.com') host = `www.${host}`;
  else if (platform === 'web') {
    host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (u.port) host += `:${u.port}`;
  }

  path = path.replace(/\/{2,}/g, '/');
  if (path !== '/') path = path.replace(/\/+$/, '');
  if (platform === 'instagram') path += '/';

  let query = '';
  if (!PATH_ONLY.has(platform)) {
    const kept = [...u.searchParams.entries()]
      .filter(([k]) => !k.startsWith('utm_') && !TRACKING_PARAMS.has(k))
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    query = new URLSearchParams(kept).toString();
  }
  return `https://${host}${path}${query ? '?' + query : ''}`;
}

/** Usuário e id de um post do X (para o FixTweet). */
export function tweetParts(url) {
  const m = /^\/([^/]+)\/status\/(\d+)/.exec((() => { try { return new URL(url).pathname; } catch { return ''; } })());
  return m ? { user: m[1], id: m[2] } : null;
}
