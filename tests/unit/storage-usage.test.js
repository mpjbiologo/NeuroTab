// Armazenamento (#68): categorias, soma, o que cada limpeza apaga, vídeos baixados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyKey, sizeOf, summarize, keysToClear, fmtBytes, downloadedItems, CATEGORIES } from '../../src/lib/storage-usage.js';

test('cada chave cai na categoria certa; notas nunca entram numa limpeza', () => {
  assert.equal(classifyKey('nt_brain'), 'notes');
  assert.equal(classifyKey('nt_trash'), 'trash');
  assert.equal(classifyKey('nt_cache_news'), 'caches');
  assert.equal(classifyKey('nt_wx_lisboa'), 'caches');
  assert.equal(classifyKey('nt_calendar_cache'), 'caches');
  assert.equal(classifyKey('nt_catalog'), 'caches');
  assert.equal(classifyKey('nt_calc_history'), 'history');
  assert.equal(classifyKey('nt_clipboard'), 'history');
  assert.equal(classifyKey('nt_migration_backup'), 'backup');
  for (const k of ['nt_data', 'nt_habits', 'nt_mail', 'nt_net', 'nt_calendar', 'nt_mail_cfg', 'nt_clipboard_cfg', 'outra']) assert.equal(classifyKey(k), 'settings', k);
  const keys = ['nt_brain', 'nt_data', 'nt_cache_quotes', 'nt_wx_x', 'nt_calc_history', 'nt_trash'];
  assert.deepEqual(keysToClear(keys, 'caches'), ['nt_cache_quotes', 'nt_wx_x']);
  assert.deepEqual(keysToClear(keys, 'history'), ['nt_calc_history']);
  assert.ok(!CATEGORIES.find((c) => c.id === 'notes').clear, 'notas não têm botão de limpar');
  assert.ok(!CATEGORIES.find((c) => c.id === 'settings').clear);
});

test('soma por categoria, maiores primeiro', () => {
  const r = summarize({ nt_brain: 5000, nt_cache_news: 2000, nt_wx_a: 1000, nt_data: 300 }, { vectors: 9000, meeting_audio: 40000, meetings: 100 });
  assert.equal(r[0].id, 'meetingAudio');
  assert.equal(r.find((c) => c.id === 'caches').bytes, 3000);
  assert.equal(r.find((c) => c.id === 'vectors').bytes, 9000);
  assert.equal(r.find((c) => c.id === 'trash').bytes, 0);
  assert.equal(r.length, CATEGORIES.length);
});

test('tamanho aproximado e formatação', () => {
  assert.equal(sizeOf('ação'), 6);
  assert.equal(sizeOf(new Float32Array(10)), 40);
  assert.ok(sizeOf({ a: [1, 'xy'] }) > 5);
  assert.equal(sizeOf(null), 0);
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(1536), '1,5 KB');
  assert.equal(fmtBytes(5 * 1048576), '5 MB');
  assert.equal(fmtBytes(3 * 1073741824, 'en-US'), '3 GB');
});

test('vídeos baixados: só itens com download, mais novos primeiro', () => {
  const items = [
    { id: 'a', title: 'A', media: { download: { via: 'browser', downloadId: 3, at: 10 } } },
    { id: 'b', title: 'B', media: { platform: 'tiktok' } },
    { id: 'c', title: 'C', media: { download: { via: 'ponte', file: '/home/x/Downloads/NeuroTab/c.mp4', at: 20, size: 99 } } },
    { id: 'd', title: 'D' },
  ];
  const r = downloadedItems(items);
  assert.deepEqual(r.map((x) => x.id), ['c', 'a']);
  assert.equal(r[0].file, '/home/x/Downloads/NeuroTab/c.mp4');
});
