// NeuroTab — baixar o vídeo de um item "Mídia" para o computador (0.7.11).
// Partes puras (configuração, nomes de arquivo, escolha do vídeo, cookies) e a função que roda dentro da página
// para achar o endereço direto do vídeo. O fluxo com chrome.downloads e a NeuroTab Ponte fica em media-dl-run.js.
// YouTube: nunca. As lojas de extensões não permitem baixar vídeos do YouTube.
import { slug } from './media.js';

export const DEFAULT_MEDIA_DL = {
  auto: false, // baixar junto ao salvar (só com as permissões já dadas)
  engine: 'auto', // auto (navegador e, se não der, a Ponte) | browser | ponte
  quality: 'best', // best | 1080 | 720 | 480
  folder: 'NeuroTab', // pasta dentro de Downloads
  byCategory: true, // uma pasta por categoria
  saveAs: false, // perguntar onde salvar (só pelo navegador)
  cookies: true, // a Ponte usa o seu login no site (Instagram costuma exigir)
};

/** Andamento dos downloads em chrome.storage.session: { [idDoItem]: { state, via, stage, pct, … } }. */
export const DL_STATE_KEY = 'nt_media_dl';

export const DL_PLATFORMS = ['instagram', 'tiktok', 'x'];
export const QUALITIES = ['best', '1080', '720', '480'];
/** Sites cujo login a Ponte pode usar (chrome.cookies) e as origens a pedir. */
export const COOKIE_DOMAINS = { instagram: ['instagram.com'], tiktok: ['tiktok.com'], x: ['x.com', 'twitter.com'] };
// *.site.com cobre o site e os cookies de ".site.com" (o login), que ficam fora de www.site.com.
export const DL_ORIGINS = { instagram: ['https://*.instagram.com/*'], tiktok: ['https://*.tiktok.com/*'], x: ['https://*.x.com/*', 'https://*.twitter.com/*', 'https://api.fxtwitter.com/*'] };

export function sanitizeMediaDl(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    auto: !!r.auto,
    engine: ['auto', 'browser', 'ponte'].includes(r.engine) ? r.engine : DEFAULT_MEDIA_DL.engine,
    quality: QUALITIES.includes(String(r.quality)) ? String(r.quality) : DEFAULT_MEDIA_DL.quality,
    folder: cleanFolder(r.folder ?? DEFAULT_MEDIA_DL.folder),
    byCategory: r.byCategory !== false,
    saveAs: !!r.saveAs,
    cookies: r.cookies !== false,
  };
}

/** "NeuroTab/vídeos" → caminho relativo seguro (sem "..", até 3 pastas). Vazio → "NeuroTab". */
export function cleanFolder(s) {
  const parts = String(s || '').split(/[\\/]+/).map((p) => p.replace(/[<>:"|?*#%\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[ .]+|[ .]+$/g, '').slice(0, 60)).filter((p) => p && p !== '.' && p !== '..');
  return parts.slice(0, 3).join('/') || 'NeuroTab';
}

export function isYouTubeUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com'].some((d) => h === d || h.endsWith('.' + d));
  } catch { return false; }
}

/** Dá para baixar o vídeo deste item? */
export function canDownload(it) {
  return it?.type === 'media' && DL_PLATFORMS.includes(it.media?.platform) && !isYouTubeUrl(it.url || '');
}

/** Pasta relativa (dentro de Downloads) e nome do arquivo, sem extensão. */
export function dlTarget(it, cfg) {
  const c = sanitizeMediaDl(cfg);
  const m = it.media || {};
  const cat = c.byCategory && m.category ? slug(m.category, 40) : '';
  const created = new Date(it.createdAt || Date.now()).toISOString().slice(0, 10);
  return { dir: [c.folder, cat].filter(Boolean).join('/'), name: `${created} ${m.platform || 'video'} - ${slug(it.title || it.pageTitle || m.caption || 'video', 80)}` };
}

/** Do JSON do FixTweet: o .mp4 de maior qualidade (respeitando a altura máxima, se houver). */
export function pickFxVideo(data, quality = 'best') {
  const vids = data?.tweet?.media?.videos || data?.tweet?.media?.all?.filter((x) => x.type === 'video' || x.type === 'gif') || [];
  const max = Number(quality) || Infinity;
  const cands = [];
  for (const v of vids) {
    for (const x of v.variants || []) if (/mp4/.test(x.content_type || x.url || '')) cands.push({ url: x.url, rate: Number(x.bitrate) || 0, h: Number(String(x.url).match(/\/\d+x(\d+)\//)?.[1]) || 0 });
    if (v.url && /\.mp4/.test(v.url)) cands.push({ url: v.url, rate: 1e12, h: Number(v.height) || Number(String(v.url).match(/\/\d+x(\d+)\//)?.[1]) || 0 });
  }
  const ok = cands.filter((c) => !c.h || c.h <= max);
  const best = (ok.length ? ok : cands).sort((a, b) => b.rate - a.rate)[0];
  return best?.url || '';
}

/** Cookies do navegador no formato que o yt-dlp lê (Netscape). Só os do site do vídeo. */
export function netscapeCookies(cookies) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies || []) {
    if (!c?.name || /[\t\n\r]/.test(`${c.name}${c.value}${c.domain}${c.path}`)) continue;
    const domain = c.hostOnly ? c.domain : c.domain.startsWith('.') ? c.domain : '.' + c.domain;
    lines.push([(c.httpOnly ? '#HttpOnly_' : '') + domain, c.hostOnly ? 'FALSE' : 'TRUE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', Math.floor(c.expirationDate || 0), c.name, c.value ?? ''].join('\t'));
  }
  return lines.length > 1 ? lines.join('\n') + '\n' : '';
}

/** Mensagem para cada código de erro da Ponte. */
export const DL_ERRORS = {
  youtube: 'O YouTube não permite baixar vídeos por extensões. Assista no próprio YouTube.',
  site: 'Só dá para baixar vídeos do Instagram, do TikTok e do X.',
  notools: 'Falta o yt-dlp na NeuroTab Ponte. Instale em Configurações → Mídia → Baixar vídeos.',
  login: 'O site pediu login. Entre na sua conta nele, deixe ligado "Usar o meu login" em Configurações → Mídia e tente de novo.',
  canceled: 'Download cancelado.',
  missing: 'A NeuroTab Ponte não está instalada neste computador.',
  old: 'A NeuroTab Ponte deste computador é antiga. Baixe a versão nova para baixar vídeos.',
  permission: 'Sem permissão para falar com a NeuroTab Ponte.',
};

/**
 * Roda DENTRO da página (mundo MAIN): procura o endereço direto do vídeo (.mp4 com áudio).
 * Devolve { url } ou { url: '', why } quando o site só entrega o vídeo em pedaços (aí a Ponte resolve).
 */
export function findVideoInPage(quality = 'best') {
  const max = Number(quality) || Infinity;
  const host = location.hostname.toLowerCase();
  const ok = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
  try {
    if (host.endsWith('tiktok.com')) {
      const data = JSON.parse(document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || 'null');
      const v = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct?.video;
      if (v) {
        const rates = (v.bitrateInfo || []).map((b) => ({ url: b.PlayAddr?.UrlList?.find(ok), h: Number(b.PlayAddr?.Height) || 0, rate: Number(b.Bitrate) || 0 })).filter((b) => b.url);
        const fit = rates.filter((b) => !b.h || b.h <= max).sort((a, b) => b.rate - a.rate)[0] || rates.sort((a, b) => b.rate - a.rate)[0];
        const url = fit?.url || (ok(v.playAddr) ? v.playAddr : '') || (ok(v.downloadAddr) ? v.downloadAddr : '');
        if (url) return { url };
      }
    }
    if (host.endsWith('instagram.com')) {
      const id = location.pathname.match(/\/(?:reel|reels|p|tv)\/([\w-]+)/)?.[1] || '';
      const blocks = []; // cada lista "video_versions", com a distância até o id do post na página
      for (const s of document.querySelectorAll('script[type="application/json"]')) {
        const txt = s.textContent || '';
        if (!txt.includes('video_versions')) continue;
        const near = id ? txt.indexOf(id) : -1;
        for (const m of txt.matchAll(/"video_versions"\s*:\s*(\[[^\]]*\])/g)) {
          try { blocks.push({ list: JSON.parse(m[1]).filter((x) => ok(x?.url)), dist: near >= 0 ? Math.abs(m.index - near) : id ? Infinity : 0 }); } catch { /* ignora */ }
        }
      }
      const block = blocks.filter((b) => b.list.length).sort((a, b) => a.dist - b.dist)[0];
      const sorted = (block?.list || []).map((x) => ({ url: x.url, h: Number(x.height) || 0 })).sort((a, b) => b.h - a.h);
      const best = sorted.find((x) => !x.h || x.h <= max) || sorted[sorted.length - 1];
      if (best) return { url: best.url };
    }
    const v = [...document.querySelectorAll('video')].map((x) => x.currentSrc || x.src).find((u) => ok(u) && !u.startsWith('blob:'));
    if (v) return { url: v };
  } catch (e) {
    return { url: '', why: String(e?.message || e) };
  }
  return { url: '', why: 'pedaços' };
}
