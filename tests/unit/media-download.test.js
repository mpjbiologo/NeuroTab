// Baixar vídeos da Mídia (0.7.11): configuração, nomes, YouTube bloqueado, FixTweet, cookies e a busca do vídeo na página.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMediaDl, cleanFolder, isYouTubeUrl, canDownload, dlTarget, pickFxVideo, netscapeCookies, findVideoInPage, DEFAULT_MEDIA_DL } from '../../src/lib/media-download.js';

test('configuração: padrões e valores inválidos', () => {
  assert.deepEqual(sanitizeMediaDl(undefined), DEFAULT_MEDIA_DL);
  const c = sanitizeMediaDl({ auto: 1, engine: 'x', quality: 720, folder: '../../etc/NeuroTab', byCategory: false, cookies: false });
  assert.equal(c.auto, true);
  assert.equal(c.engine, 'auto');
  assert.equal(c.quality, '720');
  assert.equal(c.folder, 'etc/NeuroTab');
  assert.equal(c.byCategory, false);
  assert.equal(c.cookies, false);
  assert.equal(cleanFolder(''), 'NeuroTab');
  assert.equal(cleanFolder('C:\\Users\\a:b'), 'C/Users/a b');
  assert.equal(cleanFolder('a/b/c/d/e'), 'a/b/c');
});

test('YouTube nunca; só Instagram, TikTok e X', () => {
  for (const u of ['https://www.youtube.com/watch?v=1', 'https://youtu.be/1', 'https://m.youtube.com/shorts/1', 'https://rr1.googlevideo.com/v']) assert.ok(isYouTubeUrl(u), u);
  assert.ok(!isYouTubeUrl('https://www.instagram.com/reel/A/'));
  assert.ok(!isYouTubeUrl('nada'));
  const it = (platform, url) => ({ type: 'media', url, media: { platform } });
  assert.ok(canDownload(it('instagram', 'https://www.instagram.com/reel/A/')));
  assert.ok(canDownload(it('tiktok', 'https://www.tiktok.com/@a/video/1')));
  assert.ok(canDownload(it('x', 'https://x.com/a/status/1')));
  assert.ok(!canDownload(it('youtube', 'https://www.youtube.com/watch?v=1')));
  assert.ok(!canDownload(it('instagram', 'https://youtu.be/1')), 'plataforma errada com link do YouTube');
  assert.ok(!canDownload(it('web', 'https://site.com/a')));
  assert.ok(!canDownload({ type: 'note' }));
});

test('pasta e nome do arquivo', () => {
  const it = { title: 'Claude faz: motion/graphics?', createdAt: Date.UTC(2026, 10, 22), media: { platform: 'instagram', category: 'design' } };
  assert.deepEqual(dlTarget(it, { folder: 'NeuroTab' }), { dir: 'NeuroTab/design', name: '2026-11-22 instagram - Claude faz motion graphics' });
  assert.equal(dlTarget(it, { byCategory: false }).dir, 'NeuroTab');
  assert.equal(dlTarget({ ...it, media: { platform: 'x' } }, {}).dir, 'NeuroTab');
});

test('FixTweet: maior .mp4 dentro da qualidade', () => {
  const data = { tweet: { media: { videos: [{ url: 'https://video.twimg.com/a/1280x720/best.mp4', variants: [
    { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/a/640x360/b.mp4' },
    { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/a/1280x720/c.mp4' },
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/a/pl.m3u8' },
  ] }] } } };
  assert.equal(pickFxVideo(data), 'https://video.twimg.com/a/1280x720/best.mp4');
  assert.equal(pickFxVideo(data, '480'), 'https://video.twimg.com/a/640x360/b.mp4');
  assert.equal(pickFxVideo({ tweet: { media: {} } }), '');
  assert.equal(pickFxVideo(null), '');
});

test('cookies no formato Netscape', () => {
  const txt = netscapeCookies([
    { domain: '.instagram.com', hostOnly: false, path: '/', secure: true, httpOnly: true, expirationDate: 1800000000.5, name: 'sessionid', value: 'abc' },
    { domain: 'www.instagram.com', hostOnly: true, path: '/', secure: true, name: 'csrftoken', value: 'x' },
    { domain: '.instagram.com', name: 'mau\tcookie', value: '1' },
  ]);
  const lines = txt.trim().split('\n');
  assert.equal(lines[0], '# Netscape HTTP Cookie File');
  assert.equal(lines[1], '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1800000000\tsessionid\tabc');
  assert.equal(lines[2], 'www.instagram.com\tFALSE\t/\tTRUE\t0\tcsrftoken\tx');
  assert.equal(lines.length, 3, 'cookie com tabulação é ignorado');
  assert.equal(netscapeCookies([]), '');
});

// findVideoInPage roda na página: simulamos o mínimo de DOM.
function withPage(host, path, scripts, videos = []) {
  const g = globalThis;
  const old = { location: g.location, document: g.document };
  g.location = { hostname: host, pathname: path };
  g.document = {
    querySelector: (sel) => (sel === '#__UNIVERSAL_DATA_FOR_REHYDRATION__' ? scripts.tiktok || null : null),
    querySelectorAll: (sel) => (sel === 'video' ? videos : scripts.json || []),
  };
  return () => { g.location = old.location; g.document = old.document; };
}

test('página do TikTok: maior taxa dentro da qualidade', () => {
  const data = { __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { video: {
    playAddr: 'https://v16.tiktokcdn.com/play.mp4',
    bitrateInfo: [
      { Bitrate: 500, PlayAddr: { Height: 540, UrlList: ['https://v16.tiktokcdn.com/540.mp4'] } },
      { Bitrate: 2000, PlayAddr: { Height: 1080, UrlList: ['https://v16.tiktokcdn.com/1080.mp4'] } },
    ],
  } } } } } };
  const undo = withPage('www.tiktok.com', '/@a/video/1', { tiktok: { textContent: JSON.stringify(data) } });
  try {
    assert.equal(findVideoInPage('best').url, 'https://v16.tiktokcdn.com/1080.mp4');
    assert.equal(findVideoInPage('720').url, 'https://v16.tiktokcdn.com/540.mp4');
  } finally { undo(); }
});

test('página do Instagram: video_versions perto do id do post; sem isso, pede a Ponte', () => {
  const other = '"video_versions":[{"height":1920,"url":"https://scontent.cdninstagram.com/outro.mp4"}]';
  const mine = '"code":"ABC123","video_versions":[{"height":640,"url":"https://scontent.cdninstagram.com/p640.mp4"},{"height":1280,"url":"https://scontent.cdninstagram.com/p1280.mp4"}]';
  const json = [{ textContent: '{' + other + ',"x":"' + 'a'.repeat(200000) + '"}' }, { textContent: '{' + mine + '}' }];
  let undo = withPage('www.instagram.com', '/reel/ABC123/', { json });
  try {
    assert.equal(findVideoInPage('best').url, 'https://scontent.cdninstagram.com/p1280.mp4');
    assert.equal(findVideoInPage('720').url, 'https://scontent.cdninstagram.com/p640.mp4');
  } finally { undo(); }
  undo = withPage('www.instagram.com', '/reel/ZZZ/', { json: [] }, [{ currentSrc: 'blob:https://www.instagram.com/1' }]);
  try {
    assert.deepEqual(findVideoInPage(), { url: '', why: 'pedaços' });
  } finally { undo(); }
});
