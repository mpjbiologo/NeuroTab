// Fontes e documentos (0.9.3, #9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanSrc, cleanDate, sourceMeta, isSource, linkedItems, projectsOf, listSources, uncitedLinks,
  findSourceByUrl, makeSourceInput, kindForFile, isPlainText, plainFromFile, fmtSize, MAX_TEXT,
  createSource, updateSource, removeSource,
} from '../../src/lib/sources.js';
import { searchItems, loadItems, loadTrash } from '../../src/lib/brain.js';

const it = (p) => ({ id: p.id, type: 'note', title: '', text: '', url: '', tags: [], createdAt: 1, pinned: false, ...p });

test('metadados limpos e com tamanho limitado', () => {
  assert.equal(cleanDate('2024'), '2024');
  assert.equal(cleanDate('2024-05-17'), '2024-05-17');
  assert.equal(cleanDate('17/05/2024'), '');
  const s = cleanSrc({ kind: 'xyz', author: '  Ana  ', project: 'x'.repeat(200), file: { name: 'a.pdf', size: '1200', pages: 3, mime: 'application/pdf', extra: 'fora' }, lixo: 1 });
  assert.equal(s.kind, 'link');
  assert.equal(s.author, 'Ana');
  assert.equal(s.project.length, 80);
  assert.deepEqual(Object.keys(s.file).filter((k) => s.file[k] !== undefined).sort(), ['mime', 'modified', 'name', 'pages', 'size']);
  assert.equal(s.file.size, 1200);
  assert.equal('lixo' in s, false);
  assert.equal(cleanSrc({ file: { name: '' } }).file, undefined);
});

test('páginas e mídias salvas já são fontes, com tipo e autor deduzidos', () => {
  assert.equal(isSource(it({ type: 'page' })), true);
  assert.equal(isSource(it({ type: 'clip' })), false);
  assert.equal(isSource(it({ type: 'source', deletedAt: 5 })), false);
  assert.equal(sourceMeta(it({ type: 'media', url: 'https://www.youtube.com/watch?v=abc', media: { platform: 'youtube', author: 'Canal X', published: '2025-03-01T10:00' } })).kind, 'video');
  const ig = sourceMeta(it({ type: 'media', url: 'https://www.instagram.com/p/xyz/', media: { platform: 'instagram', author: '@nutri' }, createdAt: 99 }));
  assert.deepEqual([ig.kind, ig.author, ig.capturedAt], ['post', '@nutri', 99]);
  assert.equal(sourceMeta(it({ type: 'page', url: 'https://doi.org/10.1000/xyz' })).kind, 'paper');
  assert.equal(sourceMeta(it({ type: 'page', url: 'https://site.com/manual.pdf' })).kind, 'pdf');
  assert.equal(sourceMeta(it({ type: 'source', src: { kind: 'book', author: 'Autora' } })).kind, 'book');
});

test('trechos e notas ligados pela URL padronizada ou por sourceId', () => {
  const src = it({ id: 's', type: 'page', url: 'https://www.site.com/artigo/?utm_source=x' });
  const items = [
    src,
    it({ id: 'c1', type: 'clip', url: 'https://site.com/artigo' }),
    it({ id: 'c2', type: 'note', sourceId: 's' }),
    it({ id: 'c3', type: 'clip', url: 'https://outro.com/' }),
    it({ id: 'c4', type: 'clip', url: 'https://site.com/artigo', deletedAt: 3 }),
  ];
  assert.deepEqual(linkedItems(src, items).map((x) => x.id), ['c1', 'c2']);
});

test('lista, filtros, projetos e busca sem IA', () => {
  const items = [
    it({ id: 'a', type: 'source', title: 'Microbiota intestinal', src: { kind: 'paper', author: 'Silva', project: 'Doutorado' }, createdAt: 3 }),
    it({ id: 'b', type: 'source', title: 'Guia alimentar', src: { kind: 'book', project: 'Consultório' }, createdAt: 2 }),
    it({ id: 'c', type: 'page', title: 'Notícia', url: 'https://g1.com/x', createdAt: 5 }),
    it({ id: 'd', type: 'source', title: 'Metagenômica', src: { kind: 'paper', project: 'Doutorado' }, createdAt: 1, pinned: true }),
    it({ id: 'e', type: 'note', title: 'Silva disse' }),
  ];
  assert.deepEqual(listSources(items).map((x) => x.id), ['d', 'c', 'a', 'b'], 'fixadas e depois recentes; nota fica de fora');
  assert.deepEqual(listSources(items, { kind: 'paper' }).map((x) => x.id), ['d', 'a']);
  assert.deepEqual(listSources(items, { project: 'Doutorado' }).map((x) => x.id), ['d', 'a']);
  assert.deepEqual(listSources(items, { project: '-' }).map((x) => x.id), ['c']);
  assert.deepEqual(listSources(items, { q: 'silva' }).map((x) => x.id), ['a'], 'acha pelo autor');
  assert.deepEqual(listSources(items, { q: 'doutorado metagenomica' }).map((x) => x.id), ['d', 'a']);
  assert.deepEqual(projectsOf(items), ['Doutorado', 'Consultório']);
  assert.deepEqual(searchItems(items, 'Silva').map((x) => x.id).sort(), ['a', 'e'], 'busca geral do cérebro também lê os metadados');
});

test('links citados sem fonte e repetidos', () => {
  const items = [
    it({ id: 's', type: 'page', url: 'https://a.com/1' }),
    it({ id: 'c1', type: 'clip', url: 'https://a.com/1?utm_medium=x' }),
    it({ id: 'c2', type: 'clip', url: 'https://b.com/2', pageTitle: 'B', createdAt: 5 }),
    it({ id: 'c3', type: 'note', url: 'https://www.b.com/2' }),
    it({ id: 'c4', type: 'clip', url: 'https://c.com/' }),
  ];
  const u = uncitedLinks(items);
  assert.deepEqual(u.map((x) => [x.count, x.title]), [[2, 'B'], [1, '']]);
  assert.equal(findSourceByUrl(items, 'https://www.a.com/1/')?.id, 's');
  assert.equal(findSourceByUrl(items, 'https://b.com/2'), null);
});

test('arquivos locais: tipo, texto e tamanho', () => {
  assert.equal(kindForFile('Tese.PDF'), 'pdf');
  assert.equal(kindForFile('aula.mp3'), 'audio');
  assert.equal(kindForFile('x.bin', 'video/mp4'), 'video');
  assert.equal(kindForFile('notas.md'), 'doc');
  assert.equal(kindForFile('livro.epub'), 'book');
  assert.equal(kindForFile('x.zip'), 'file');
  assert.equal(isPlainText('a.csv'), true);
  assert.equal(isPlainText('a.pdf', 'application/pdf'), false);
  assert.equal(plainFromFile('a.html', '<p>Oi&nbsp;<b>mundo</b></p><script>x()</script>'), 'Oi mundo');
  assert.equal(plainFromFile('a.txt', 'x'.repeat(MAX_TEXT + 10)).length, MAX_TEXT);
  assert.equal(fmtSize(1536), '1.5 KB');
  assert.equal(fmtSize(3 * 1024 * 1024), '3.0 MB');
  assert.equal(makeSourceInput({ title: 'T', src: { kind: 'book' }, text: 'y'.repeat(MAX_TEXT + 1) }).text.length, MAX_TEXT);
});

test('criar, consultar, atualizar (mesclando) e remover para a lixeira', async () => {
  const a = await createSource({ title: 'Artigo', url: 'https://site.com/a', src: { kind: 'article', author: 'Ana', project: 'P1' } });
  assert.ok(a.item?.id);
  const again = await createSource({ title: 'Outro nome', url: 'https://www.site.com/a/?utm_source=z' });
  assert.equal(again.existing?.id, a.item.id, 'mesmo link: não duplica');
  await updateSource(a.item.id, { src: { project: 'P2' }, title: 'Artigo revisado' });
  let cur = (await loadItems()).find((x) => x.id === a.item.id);
  assert.deepEqual([cur.title, cur.src.author, cur.src.project, cur.src.kind, cur.url], ['Artigo revisado', 'Ana', 'P2', 'article', 'https://site.com/a'], 'metadados que não vieram continuam');
  await updateSource(a.item.id, { src: { file: { name: 'a.pdf', size: 10 } } });
  cur = (await loadItems()).find((x) => x.id === a.item.id);
  assert.equal(cur.src.file.name, 'a.pdf');
  assert.equal(cur.src.author, 'Ana');
  await removeSource(a.item.id);
  assert.equal((await loadItems()).some((x) => x.id === a.item.id), false);
  assert.equal((await loadTrash()).some((x) => x.id === a.item.id), true, 'vai para a lixeira, dá para restaurar');
});
