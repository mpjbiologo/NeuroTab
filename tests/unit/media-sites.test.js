// Sites de mídia, pastas, fotos e áudio (0.9.3.1, #45).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dlSiteOf, directKind, extOf, sitePatterns, safeFileName, DL_SITES } from '../../src/lib/media-sites.js';
import { canDownload, canDownloadAudio, canDownloadPhotos, dlTarget, sanitizeMediaDl, pickFxPhotos, imageExt, originsFor, cookieDomainsFor } from '../../src/lib/media-download.js';
import { readFileSync } from 'node:fs';

test('sites: compatíveis, YouTube nunca, DRM recusado, arquivos diretos', () => {
  assert.equal(dlSiteOf('https://www.instagram.com/reel/ABC/').site, 'instagram');
  assert.equal(dlSiteOf('https://clips.twitch.tv/abc').site, 'twitch');
  assert.equal(dlSiteOf('https://soundcloud.com/a/b').video, false);
  assert.equal(dlSiteOf('https://soundcloud.com/a/b').audio, true);
  assert.equal(dlSiteOf('https://www.youtube.com/watch?v=1').code, 'youtube');
  assert.equal(dlSiteOf('https://music.youtube.com/watch?v=1').code, 'youtube');
  assert.equal(dlSiteOf('https://www.netflix.com/watch/1').code, 'drm');
  assert.equal(dlSiteOf('https://open.spotify.com/track/1').code, 'drm');
  assert.equal(dlSiteOf('https://exemplo.com/artigo').code, 'site');
  assert.equal(dlSiteOf('https://instagram.com.evil.com/x').code, 'site', 'host falso não engana');
  assert.equal(dlSiteOf('nada').code, 'invalid');
  const mp3 = dlSiteOf('https://podcast.org/ep1.mp3');
  assert.deepEqual([mp3.ok, mp3.site, mp3.direct, mp3.audio, mp3.video], [true, 'file', 'audio', true, false]);
  assert.equal(directKind('http://a.com/v.mp4'), '', 'só https');
  assert.equal(directKind('https://a.com/v.MP4?x=1'), 'video');
  assert.equal(extOf('https://a.com/f.jpeg'), 'jpeg');
  assert.ok(sitePatterns().includes('https://*.reddit.com/*'));
});

test('a lista de sites da Ponte (Go) é a mesma da extensão', () => {
  const go = readFileSync(new URL('../../ponte/download.go', import.meta.url), 'utf8');
  const list = go.match(/var dlSites = \[\]string\{([\s\S]*?)\n\}/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1)).sort();
  const js = Object.values(DL_SITES).flatMap((s) => s.hosts).sort();
  assert.deepEqual(list, js);
});

test('nomes de arquivo seguros', () => {
  assert.equal(safeFileName('a/b:c*?"<>|'), 'a b c');
  assert.equal(safeFileName('  ..CON..  '), 'arquivo');
  assert.equal(safeFileName(''), 'arquivo');
  assert.equal(safeFileName('x'.repeat(200)).length, 90);
});

test('item: vídeo, áudio e fotos conforme o site', () => {
  const it = (url, platform = 'web') => ({ type: 'media', url, media: { platform } });
  assert.equal(canDownload(it('https://vimeo.com/1')), true);
  assert.equal(canDownload(it('https://soundcloud.com/a/b')), false, 'SoundCloud é só áudio');
  assert.equal(canDownloadAudio(it('https://soundcloud.com/a/b')), true);
  assert.equal(canDownload(it('https://www.youtube.com/watch?v=1', 'youtube')), false);
  assert.equal(canDownloadAudio(it('https://www.youtube.com/watch?v=1', 'youtube')), false);
  assert.equal(canDownloadPhotos(it('https://www.instagram.com/p/X/', 'instagram')), true);
  assert.equal(canDownloadPhotos(it('https://vimeo.com/1')), false);
  assert.equal(canDownload({ type: 'note', url: 'https://vimeo.com/1' }), false);
  assert.deepEqual(originsFor('https://vimeo.com/1'), ['https://*.vimeo.com/*']);
  assert.deepEqual(cookieDomainsFor('https://x.com/a/status/1'), ['x.com', 'twitter.com']);
});

test('pastas: vídeo, áudio e imagem, cada um na sua, por categoria', () => {
  const cfg = sanitizeMediaDl({ folder: 'Vids', imageFolder: '../Fotos//Posts', audioFolder: '', audioFormat: 'wav' });
  assert.deepEqual([cfg.imageFolder, cfg.audioFolder, cfg.audioFormat], ['Fotos/Posts', 'NeuroTab', 'mp3']);
  assert.equal(sanitizeMediaDl({}).imageFolder, 'NeuroTab/Imagens');
  const it = { createdAt: Date.UTC(2026, 10, 1), title: 'Receita de pão', url: 'https://www.instagram.com/p/X/', media: { platform: 'instagram', category: 'Culinária' } };
  assert.deepEqual(dlTarget(it, cfg, 'image'), { dir: 'Fotos/Posts/Culinária', name: '2026-11-01 instagram - Receita de pão' });
  assert.equal(dlTarget(it, cfg, 'audio').dir, 'NeuroTab/Culinária');
  assert.equal(dlTarget(it, cfg).dir, 'Vids/Culinária');
  assert.equal(dlTarget({ ...it, url: 'https://vimeo.com/1', media: { platform: 'web' } }, { byCategory: false }, 'video').name, '2026-11-01 vimeo - Receita de pão');
});

test('fotos do X pelo FixTweet, na resolução original', () => {
  const data = { tweet: { media: { photos: [{ url: 'https://pbs.twimg.com/media/AAA.jpg' }, { url: 'https://pbs.twimg.com/media/BBB?format=png&name=small' }, { url: 'javascript:x' }] } } };
  assert.deepEqual(pickFxPhotos(data), ['https://pbs.twimg.com/media/AAA.jpg?name=orig', 'https://pbs.twimg.com/media/BBB?format=png&name=small']);
  assert.deepEqual(pickFxPhotos({}), []);
  assert.equal(imageExt('https://pbs.twimg.com/media/BBB?format=png&name=small'), 'png');
  assert.equal(imageExt('https://a.com/x.JPEG'), 'jpg');
  assert.equal(imageExt('https://a.com/x'), 'jpg');
});
