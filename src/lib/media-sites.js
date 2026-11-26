// NeuroTab — de quais sites dá para baixar mídia (0.9.3.1, #45). Levantamento em docs/dev/MIDIA-SITES.md.
//
// Regras: só o que o site entrega sem proteção. YouTube nunca (política das lojas de extensões).
// Serviços com DRM (streaming de filmes e música) são recusados com aviso: a NeuroTab não contorna DRM,
// paywall nem login de outra pessoa. Arquivos diretos (.mp4, .mp3…) em qualquer site https vão pelo navegador.

/** Sites com download pela NeuroTab Ponte (yt-dlp). `browser`: o navegador também acha o arquivo direto. */
export const DL_SITES = {
  instagram: { label: 'Instagram', hosts: ['instagram.com', 'instagr.am'], video: true, photos: true, audio: true, browser: true },
  tiktok: { label: 'TikTok', hosts: ['tiktok.com'], video: true, photos: true, audio: true, browser: true },
  x: { label: 'X (Twitter)', hosts: ['x.com', 'twitter.com'], video: true, photos: true, audio: true, browser: true },
  reddit: { label: 'Reddit', hosts: ['reddit.com', 'redd.it'], video: true, audio: true },
  facebook: { label: 'Facebook', hosts: ['facebook.com', 'fb.watch'], video: true, audio: true },
  threads: { label: 'Threads', hosts: ['threads.net', 'threads.com'], video: true, audio: true },
  bluesky: { label: 'Bluesky', hosts: ['bsky.app'], video: true, audio: true },
  vimeo: { label: 'Vimeo', hosts: ['vimeo.com'], video: true, audio: true },
  dailymotion: { label: 'Dailymotion', hosts: ['dailymotion.com', 'dai.ly'], video: true, audio: true },
  twitch: { label: 'Twitch (clipes e vídeos)', hosts: ['twitch.tv'], video: true, audio: true },
  kwai: { label: 'Kwai', hosts: ['kwai.com'], video: true, audio: true },
  pinterest: { label: 'Pinterest', hosts: ['pinterest.com', 'pin.it'], video: true, audio: true },
  linkedin: { label: 'LinkedIn', hosts: ['linkedin.com'], video: true, audio: true },
  rumble: { label: 'Rumble', hosts: ['rumble.com'], video: true, audio: true },
  soundcloud: { label: 'SoundCloud', hosts: ['soundcloud.com'], video: false, audio: true },
};

/** Streaming com DRM: recusado, com aviso claro. */
export const DRM_HOSTS = [
  'netflix.com', 'primevideo.com', 'disneyplus.com', 'max.com', 'hbomax.com', 'globoplay.globo.com', 'spotify.com',
  'deezer.com', 'music.apple.com', 'tv.apple.com', 'tidal.com', 'crunchyroll.com', 'paramountplus.com', 'starplus.com',
  'music.amazon.com', 'music.amazon.com.br', 'mubi.com', 'telecineplay.com.br', 'pluto.tv',
];

export const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'music.youtube.com'];

export const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'];
export const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba'];
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'bmp', 'svg'];

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const match = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));

/** Extensão do arquivo pelo caminho da URL ("" se não houver). */
export function extOf(url) {
  try { return (new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase(); } catch { return ''; }
}

/** Arquivo de mídia direto (o navegador baixa sem ajuda): 'video' | 'audio' | 'image' | ''. */
export function directKind(url) {
  if (!/^https:\/\//i.test(url || '')) return '';
  const e = extOf(url);
  if (VIDEO_EXT.includes(e)) return 'video';
  if (AUDIO_EXT.includes(e)) return 'audio';
  if (IMAGE_EXT.includes(e)) return 'image';
  return '';
}

/**
 * O que dá para baixar deste link.
 * { ok, code, site, label, video, audio, photos, browser, direct }
 * code: '' (pode) | 'youtube' | 'drm' | 'site' (não compatível) | 'invalid'
 */
export function dlSiteOf(url) {
  const host = hostOf(url);
  if (!host) return { ok: false, code: 'invalid' };
  if (match(host, YOUTUBE_HOSTS)) return { ok: false, code: 'youtube', site: 'youtube', label: 'YouTube' };
  if (match(host, DRM_HOSTS)) return { ok: false, code: 'drm', label: host };
  for (const [site, s] of Object.entries(DL_SITES)) {
    if (match(host, s.hosts)) return { ok: true, code: '', site, label: s.label, video: s.video, audio: s.audio, photos: !!s.photos, browser: !!s.browser, direct: '' };
  }
  const d = directKind(url);
  if (d) return { ok: true, code: '', site: 'file', label: host, video: d === 'video', audio: d === 'audio' || d === 'video', photos: d === 'image', browser: true, direct: d };
  return { ok: false, code: 'site', label: host };
}

/** Padrões para o menu do botão direito ("Baixar o vídeo") e para pedir acesso aos sites. */
export function sitePatterns(sites = Object.keys(DL_SITES)) {
  const out = [];
  for (const s of sites) for (const h of DL_SITES[s]?.hosts || []) out.push(`https://${h}/*`, `https://*.${h}/*`);
  return out;
}

/** Nome seguro para arquivo (Windows, macOS e Linux), sem a extensão. */
export function safeFileName(s, max = 90) {
  const clean = String(s || '')
    .replace(/[<>:"/\\|?*#%\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[ .]+|[ .]+$/g, '')
    .slice(0, max)
    .trim();
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  return !clean || reserved.test(clean) ? 'arquivo' : clean;
}
