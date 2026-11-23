// Armazenamento (#68): categorias com tamanho, limpar caches, esvaziar lixeira, áudio de reunião apagado
// (transcrição fica), vídeo baixado com arquivo ausente, limpeza automática.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

test('Armazenamento: espaço por categoria e limpezas', async () => {
  const x = await launch();
  try {
    const o = await x.open('src/options.html#armazenamento');
    // dados de exemplo: caches, lixeira, histórico, reunião com áudio e um vídeo baixado que sumiu
    await o.evaluate(async () => {
      await chrome.storage.local.set({
        nt_cache_news: { at: 1, rows: 'x'.repeat(5000) }, nt_wx_lisboa: { t: 'y'.repeat(2000) },
        nt_trash: [{ id: 't1', text: 'apagada', deletedAt: Date.now() }],
        nt_calc_history: ['1+1=2'],
      });
      const store = await import('./lib/meeting-store.js');
      await store.saveMeeting({ id: 'm1', startedAt: Date.now() - 60000, endedAt: Date.now(), state: 'ended', elapsed: 60000, segments: [{ t: 0, text: 'oi' }], marks: [], audioChunks: 1, audioBytes: 30000 });
      await store.addAudioChunk('m1', 0, new Blob([new Uint8Array(30000)], { type: 'audio/webm' }));
      const brain = await import('./lib/brain.js');
      await brain.addItem({ type: 'media', text: 'vídeo', title: 'Vídeo do Instagram', media: { platform: 'instagram', download: { via: 'ponte', file: '/nao/existe/video.mp4', at: Date.now(), size: 1234 } } });
    });
    await o.click('#storRefresh');
    await o.locator('.stor-row[data-cat="meetingAudio"] .sz', { hasText: 'KB' }).waitFor();
    assert.match(await o.textContent('#storTotal'), /Total da NeuroTab: /);
    assert.ok(await o.locator('.stor-bar i').count() >= 3);
    assert.equal(await o.locator('.stor-row[data-cat="notes"] button').count(), 0, 'notas não têm limpar');

    // limpar caches
    await o.click('[data-clear="caches"]');
    await o.waitForFunction(async () => !(await chrome.storage.local.get('nt_cache_news')).nt_cache_news);
    assert.equal((await x.storage(o, 'nt_wx_lisboa')), undefined);
    assert.ok(await x.storage(o, 'nt_brain'), 'notas intactas');
    // esvaziar lixeira
    await o.click('[data-clear="trash"]');
    await o.waitForFunction(async () => ((await chrome.storage.local.get('nt_trash')).nt_trash || []).length === 0);
    // áudios das reuniões: some o áudio, fica a transcrição
    await o.click('[data-clear="meeting-audio"]');
    await o.locator('.stor-row[data-cat="meetingAudio"] .sz', { hasText: /^0 B$/ }).waitFor();
    const m = await o.evaluate(async () => (await import('./lib/meeting-store.js')).getMeeting('m1'));
    assert.equal(m.audioBytes, 0);
    assert.equal(m.segments[0].text, 'oi');

    // vídeo baixado: aparece (sem como conferir sem a Ponte); "Tirar da lista" depois de apagar
    await o.locator('.stor-file', { hasText: 'video.mp4' }).waitFor();
    assert.match(await o.textContent('#storDl'), /1 vídeos/);
    assert.match(await o.textContent('#dlFolder'), /Downloads\/NeuroTab/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('limpeza automática: caches a cada 30 dias e áudios antigos', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/options.html');
    const r = await p.evaluate(async () => {
      await chrome.storage.local.set({ nt_cache_news: { a: 1 }, nt_storage_auto: {} });
      const store = await import('./lib/meeting-store.js');
      const old = Date.now() - 40 * 86400000;
      await store.saveMeeting({ id: 'velha', startedAt: old, endedAt: old, state: 'ended', elapsed: 1, segments: [], marks: [], audioChunks: 1, audioBytes: 10 });
      await store.addAudioChunk('velha', 0, new Blob(['abc']));
      const nova = Date.now();
      await store.saveMeeting({ id: 'nova', startedAt: nova, endedAt: nova, state: 'ended', elapsed: 1, segments: [], marks: [], audioChunks: 1, audioBytes: 10 });
      await store.addAudioChunk('nova', 0, new Blob(['abc']));
      const { autoClean } = await import('./lib/storage-usage.js');
      const a = await autoClean({ storageAutoCaches: true, meetingAudioDays: 30 });
      const again = await autoClean({ storageAutoCaches: true, meetingAudioDays: 30 });
      return { a, again, cache: (await chrome.storage.local.get('nt_cache_news')).nt_cache_news, velha: await store.audioSize('velha'), nova: await store.audioSize('nova') };
    });
    assert.equal(r.a.caches, 1);
    assert.equal(r.a.audios, 1);
    assert.equal(r.again.skipped, true, 'no máximo uma vez por dia');
    assert.equal(r.cache, undefined);
    assert.equal(r.velha, 0);
    assert.equal(r.nova, 3);
  } finally {
    await x.close();
  }
});
