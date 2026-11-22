// NeuroTab — lê o post, vídeo ou artigo DA PÁGINA ABERTA, com a sessão da própria pessoa (#67).
// Roda dentro da página (chrome.scripting.executeScript, mundo MAIN para enxergar os dados do YouTube e do TikTok),
// por isso precisa ser uma função sem dependências. Ideia dos extratores do Kora (MIT) — Joao V Santos —
// https://github.com/Joaovitor12j/kora (src/kora/extractors), refeita para o navegador.

export async function extractPage(maxChars = 60000) {
  const clip = (s, n = maxChars) => String(s || '').replace(/ /g, ' ').trim().slice(0, n);
  const og = (k) => document.querySelector(`meta[property="og:${k}"], meta[name="og:${k}"]`)?.content?.trim() || '';
  const metaName = (k) => document.querySelector(`meta[name="${k}"]`)?.content?.trim() || '';
  const host = location.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  const out = { url: location.href, platform: 'web', title: og('title') || document.title || '', author: '', caption: og('description') || metaName('description'), published: '', content: '', contentType: '', images: [], duration: 0, note: '' };
  const json = (sel) => { try { return JSON.parse(document.querySelector(sel)?.textContent || 'null'); } catch { return null; } };
  const getText = async (url) => { const r = await fetch(url, { credentials: 'include' }); if (!r.ok) throw new Error(String(r.status)); return r.text(); };
  const vtt = (txt) => txt.split('\n').filter((l) => l.trim() && !/^(WEBVTT|NOTE|\d+$|[\d:.]+\s*-->)/.test(l.trim())).map((l) => l.replace(/<[^>]+>/g, '').trim()).filter((l, i, a) => l && l !== a[i - 1]).join('\n');

  try {
    if (host.endsWith('youtube.com') || host === 'youtu.be') {
      out.platform = 'youtube';
      const p = document.getElementById('movie_player')?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
      const vd = p?.videoDetails;
      if (vd) {
        out.title = vd.title || out.title;
        out.author = vd.author || '';
        out.caption = vd.shortDescription || out.caption;
        out.duration = Number(vd.lengthSeconds) || 0;
      }
      out.published = p?.microformat?.playerMicroformatRenderer?.publishDate?.slice(0, 10) || '';
      const tracks = p?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const lang = (document.documentElement.lang || navigator.language || 'pt').slice(0, 2);
      const rank = (t) => (t.languageCode?.startsWith(lang) ? 0 : t.languageCode?.startsWith('pt') ? 1 : t.languageCode?.startsWith('en') ? 2 : 3) + (t.kind === 'asr' ? 0.5 : 0);
      const track = [...tracks].sort((a, b) => rank(a) - rank(b))[0];
      if (track?.baseUrl) {
        try {
          const j = JSON.parse(await getText(track.baseUrl + (track.baseUrl.includes('fmt=') ? '' : '&fmt=json3')));
          out.content = clip((j.events || []).map((e) => (e.segs || []).map((s) => s.utf8).join('')).join(' ').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' '));
          if (out.content) out.contentType = 'legenda';
        } catch { out.note = 'A legenda do vídeo não abriu.'; }
      }
      if (!out.content) {
        // painel "Mostrar transcrição" já aberto na página
        const segs = [...document.querySelectorAll('ytd-transcript-segment-renderer .segment-text, transcript-segment-view-model .yt-core-attributed-string')].map((x) => x.textContent.trim()).filter(Boolean);
        if (segs.length) { out.content = clip(segs.join(' ')); out.contentType = 'legenda'; }
      }
    } else if (host.endsWith('instagram.com')) {
      out.platform = 'instagram';
      const t = og('title');
      const d = og('description');
      if (t.includes(' on Instagram')) out.author = t.split(' on Instagram')[0].trim();
      for (const s of [t, d]) { const m = s.match(/:\s*"([\s\S]*)"\s*\.?\s*$/); if (m) { out.caption = m[1].trim(); break; } }
      if (!out.author) { const m = d.match(/-\s*([\w.]+)\s+(?:on|em)\s/); if (m) out.author = m[1]; }
      const art = document.querySelector('article');
      const h1 = art?.querySelector('h1');
      if (!out.caption && h1) out.caption = h1.textContent.trim();
      out.title = out.caption ? out.caption.split('\n')[0].slice(0, 90) : out.title;
      const img = og('image');
      if (img && !og('video')) out.images.push(img);
      const time = art?.querySelector('time[datetime]')?.getAttribute('datetime');
      if (time) out.published = time.slice(0, 10);
    } else if (host.endsWith('tiktok.com')) {
      out.platform = 'tiktok';
      const data = json('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
      const it = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
      if (it) {
        out.caption = it.desc || out.caption;
        out.author = it.author?.uniqueId ? '@' + it.author.uniqueId : it.author?.nickname || '';
        out.published = it.createTime ? new Date(Number(it.createTime) * 1000).toISOString().slice(0, 10) : '';
        out.duration = Number(it.video?.duration) || 0;
        for (const im of it.imagePost?.images || []) { const u = im.imageURL?.urlList?.[0]; if (u) out.images.push(u); }
        const subs = it.video?.subtitleInfos || [];
        const sub = subs.find((s) => /^pt/i.test(s.LanguageCodeName || '')) || subs.find((s) => /^en/i.test(s.LanguageCodeName || '')) || subs[0];
        if (sub?.Url) {
          try { out.content = clip(vtt(await getText(sub.Url))); if (out.content) out.contentType = 'legenda'; } catch { out.note = 'A legenda automática do TikTok não abriu.'; }
        }
      } else {
        out.caption = document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]')?.innerText?.trim() || out.caption;
        out.author = document.querySelector('[data-e2e="browse-username"], [data-e2e="video-author-uniqueid"]')?.innerText?.trim() || '';
      }
      out.title = (out.caption || out.title).split('\n')[0].slice(0, 90);
    } else if (['x.com', 'twitter.com'].includes(host)) {
      out.platform = 'x';
      const id = location.pathname.match(/\/status\/(\d+)/)?.[1];
      const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
      const art = arts.find((a) => id && a.querySelector(`a[href*="/status/${id}"] time`)) || arts[0];
      if (art) {
        out.caption = art.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '';
        const names = art.querySelector('[data-testid="User-Name"]')?.innerText?.split('\n') || [];
        out.author = names.find((n) => n.startsWith('@')) || names[0] || '';
        out.published = art.querySelector('time[datetime]')?.getAttribute('datetime')?.slice(0, 10) || '';
        for (const im of art.querySelectorAll('[data-testid="tweetPhoto"] img')) out.images.push(im.src);
        out.title = `${names[0] || ''}: ${out.caption.split('\n')[0].slice(0, 70)}`.replace(/^: /, '');
      }
    } else {
      // Artigo: o bloco com mais parágrafos (article > main > body), sem menus, rodapés e anúncios.
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } }).flat().find((x) => x && /Article|BlogPosting|NewsArticle/.test(x['@type']));
      out.author = (Array.isArray(ld?.author) ? ld.author[0]?.name : ld?.author?.name) || metaName('author') || og('site_name');
      out.published = (ld?.datePublished || document.querySelector('meta[property="article:published_time"]')?.content || '').slice(0, 10);
      const roots = [...document.querySelectorAll('article, [role="main"], main, .post, .entry-content, .article-body')];
      const score = (el) => [...el.querySelectorAll('p')].reduce((n, p) => n + p.innerText.trim().length, 0);
      const root = roots.sort((a, b) => score(b) - score(a))[0] || document.body;
      const paras = [...root.querySelectorAll('h1, h2, h3, p, li, blockquote')]
        .filter((el) => !el.closest('nav, footer, aside, header nav, form, [aria-hidden="true"], .ad, .ads, .share, .related'))
        .map((el) => el.innerText.trim()).filter((t) => t.length > 1);
      const text = [...new Set(paras)].join('\n');
      if (text.length > 400) { out.content = clip(text); out.contentType = 'artigo'; }
    }
  } catch (e) {
    out.note = String(e?.message || e);
  }
  out.title = clip(out.title, 300);
  out.caption = clip(out.caption, 8000);
  out.author = clip(out.author, 120);
  out.images = [...new Set(out.images)].slice(0, 10);
  return out;
}
