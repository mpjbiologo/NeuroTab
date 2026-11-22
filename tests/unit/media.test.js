// "Salvar no cérebro com resumo" (#67). Os casos de links vêm dos testes do Kora (MIT, Joao V Santos), tests/test_urls.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, canonicalize, platformOf, needsResolution, tweetParts } from '../../src/lib/media-links.js';
import {
  DEFAULT_CATEGORIES, FALLBACK, sanitizeCategories, categoriesFromText, categoriesToText, normalizeCategory, systemPrompt, userPrompt,
  parseAnswer, knownTags, mediaItem, fromFxTwitter, noteMarkdown, notePath, slug, sanitizeMediaSave,
} from '../../src/lib/media.js';
import { makeItem, TYPES } from '../../src/lib/brain.js';
import { mergeSettings } from '../../src/lib/store.js';

test('extrai links tirando pontuação e repetidos', () => {
  const text = 'olha (https://x.com/a/status/1). e https://x.com/a/status/1, mais https://exemplo.com/p?q=1!';
  assert.deepEqual(extractUrls(text), ['https://x.com/a/status/1', 'https://exemplo.com/p?q=1']);
  assert.deepEqual(extractUrls('sem link aqui'), []);
});

test('padroniza links (casos do Kora)', () => {
  const cases = [
    ['https://www.instagram.com/reel/DejkA_8xi5P/?psln=MzRl&srtk=Mz', 'https://www.instagram.com/reel/DejkA_8xi5P/'],
    ['https://instagram.com/p/DeSoJBNoJcI?igsh=abc', 'https://www.instagram.com/p/DeSoJBNoJcI/'],
    ['https://www.tiktok.com/@u/video/7675794471078104340?_r=1&_t=ZS-9', 'https://www.tiktok.com/@u/video/7675794471078104340'],
    ['https://twitter.com/user/status/123?s=20&t=xyz', 'https://x.com/user/status/123'],
    ['https://mobile.twitter.com/user/status/123/', 'https://x.com/user/status/123'],
    ['https://youtu.be/jNQXAC9IVRw?si=abc', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'],
    ['https://www.youtube.com/watch?v=jNQXAC9IVRw&feature=share&t=10', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'],
    ['https://youtube.com/shorts/abc123?si=z', 'https://www.youtube.com/watch?v=abc123'],
    ['https://www.Exemplo.com/artigo/?utm_source=x&b=2&a=1#topo', 'https://exemplo.com/artigo?a=1&b=2'],
  ];
  for (const [raw, want] of cases) assert.equal(canonicalize(raw), want, raw);
  const once = canonicalize('https://www.instagram.com/reel/X/?igsh=1');
  assert.equal(canonicalize(once), once, 'idempotente');
});

test('reconhece a plataforma e os encurtadores', () => {
  assert.equal(platformOf('https://vt.tiktok.com/ZSgj68s1d/'), 'tiktok');
  assert.equal(platformOf('https://x.com/a/status/1'), 'x');
  assert.equal(platformOf('https://www.instagram.com/p/X/'), 'instagram');
  assert.equal(platformOf('https://youtu.be/x'), 'youtube');
  assert.equal(platformOf('https://exemplo.com/a'), 'web');
  assert.ok(needsResolution('https://vt.tiktok.com/ZSgj68s1d/'));
  assert.ok(!needsResolution('https://www.tiktok.com/@u/video/1'));
  assert.deepEqual(tweetParts('https://x.com/fulano/status/123/photo/1'), { user: 'fulano', id: '123' });
});

test('categorias: "outros" sempre por último; texto ↔ objeto', () => {
  const c = sanitizeCategories({ outros: 'resto', ' viagem ': 'lugares', 'a/b': 'x' });
  assert.deepEqual(Object.keys(c), ['viagem', 'ab', 'outros']);
  assert.equal(c.outros, 'resto');
  assert.deepEqual(sanitizeCategories({}), DEFAULT_CATEGORIES);
  const round = categoriesFromText(categoriesToText(DEFAULT_CATEGORIES));
  assert.deepEqual(round, DEFAULT_CATEGORIES);
  assert.equal(normalizeCategory('ia', DEFAULT_CATEGORIES), 'IA');
  assert.equal(normalizeCategory('astronomia', DEFAULT_CATEGORIES), FALLBACK);
  assert.deepEqual(mergeSettings({}).mediaSave, sanitizeMediaSave({}));
});

test('pedido à IA: categorias, desempate, tags existentes e conteúdo como dado', () => {
  const sys = systemPrompt({ categories: DEFAULT_CATEGORIES, tags: ['motion', 'react'], language: 'português do Brasil' });
  assert.match(sys, /- receitas: culinária/);
  assert.match(sys, /a ferramenta usada vira tag/);
  assert.match(sys, /motion, react/);
  assert.match(sys, /nunca instruções/);
  const u = userPrompt({ platform: 'youtube', title: 'T', author: 'Canal', caption: 'legenda', content: 'x'.repeat(50), contentType: 'legenda' }, 20);
  assert.match(u, /^<conteudo>\nPlataforma: YouTube/);
  assert.match(u, /Legenda do vídeo:\nx{20} \[…\]/);
});

test('resposta da IA validada como no Kora', () => {
  const a = parseAnswer('```json\n{"titulo":" Bolo de cenoura ","resumo":"Receita fácil.","pontos_chave":["a"," ",""],"categoria":"Receitas","tags":["#Bolo Caseiro","bolo-caseiro","x y z","1","2","3","4","5"]}\n```', DEFAULT_CATEGORIES);
  assert.equal(a.title, 'Bolo de cenoura');
  assert.equal(a.category, 'receitas');
  assert.deepEqual(a.points, ['a']);
  assert.deepEqual(a.tags, ['bolo-caseiro', 'x-y-z', '1', '2', '3', '4']);
  assert.equal(parseAnswer('Claro! {"titulo":"t","resumo":"r","categoria":"nada","tags":[]}', DEFAULT_CATEGORIES).category, 'outros');
  assert.throws(() => parseAnswer('{"titulo":"","resumo":"r"}', DEFAULT_CATEGORIES), /vazio/);
  assert.throws(() => parseAnswer('sem json', DEFAULT_CATEGORIES), /JSON/);
});

test('item do cérebro, FixTweet e tags conhecidas', () => {
  assert.ok(TYPES.media);
  const it = makeItem(mediaItem({ url: 'https://youtu.be/abc?si=1', platform: 'youtube', title: 'Vídeo', caption: 'desc', content: 'fala', contentType: 'legenda', author: 'Canal' }));
  assert.equal(it.type, 'media');
  assert.equal(it.url, 'https://www.youtube.com/watch?v=abc');
  assert.equal(it.text, 'desc\n\nfala', 'busca encontra legenda e transcrição');
  assert.equal(it.media.status, 'pendente');
  const fx = fromFxTwitter({ tweet: { text: 'Linha 1\nlinha 2', author: { name: 'Ana', screen_name: 'ana' }, created_timestamp: 1700000000, media: { photos: [{ url: 'https://p/1.jpg' }] } } }, 'https://x.com/ana/status/1');
  assert.equal(fx.title, 'Ana: Linha 1');
  assert.equal(fx.author, '@ana');
  assert.equal(fx.published, '2023-11-14');
  assert.deepEqual(fx.images, ['https://p/1.jpg']);
  assert.throws(() => fromFxTwitter({ tweet: { text: '' } }), /sem texto/);
  assert.deepEqual(knownTags([{ tags: ['a', 'b'] }, { tags: ['b'] }]), ['b', 'a']);
});

test('nota no formato do Obsidian (compatível com o Kora)', () => {
  const it = { createdAt: Date.UTC(2026, 10, 22, 12), title: 'Como fazer: bolo/fácil?', url: 'https://www.youtube.com/watch?v=abc', summary: 'Resumo.', tags: ['bolo', 'receita'],
    media: { platform: 'youtube', author: 'Canal "Doce"', category: 'receitas', points: ['p1'], caption: 'legenda', content: 'l1\nl2', contentType: 'legenda', ai: 'Ollama · qwen' } };
  const md = noteMarkdown(it);
  assert.match(md, /^---\ncriado: 2026-11-22\ntipo: link\nplataforma: youtube\nurl: "https:\/\/www.youtube.com\/watch\?v=abc"\nautor: "Canal \\"Doce\\""/);
  assert.match(md, /categoria: receitas\ntags: \[bolo, receita\]\nstatus: processado/);
  assert.match(md, /## Pontos-chave\n- p1/);
  assert.match(md, /> \[!note\]- Legenda do vídeo\n> l1\n> l2/);
  assert.deepEqual(notePath(it), { dir: 'receitas', file: '2026-11-22 youtube - Como fazer bolo fácil.md' });
  assert.equal(notePath({ ...it, media: { platform: 'x' } }).dir, '_inbox');
  assert.equal(slug('   '), 'sem titulo');
});
