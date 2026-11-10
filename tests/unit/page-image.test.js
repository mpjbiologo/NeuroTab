// Pegar imagem pela página (login, blob:, bloqueio do site) e detectar o tipo pelos bytes.
import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffImageType, cropRect, grabAndSave } from '../../src/lib/page-image.js';

const bytes = (...xs) => new Uint8Array(xs);
const ascii = (s, pad = 16) => new Uint8Array([...s.padEnd(pad, '\0')].map((c) => c.charCodeAt(0)));

test('tipo da imagem pelos primeiros bytes', () => {
  assert.equal(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), 'image/png');
  assert.equal(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(sniffImageType(ascii('GIF89a')), 'image/gif');
  assert.equal(sniffImageType(ascii('RIFF\x10\x00\x00\x00WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImageType(ascii('\x00\x00\x00\x1cftypavif')), 'image/avif');
  assert.equal(sniffImageType(ascii('  <svg xmlns="http://www.w3.org/2000/svg">', 60)), 'image/svg+xml');
  assert.equal(sniffImageType(ascii('<!doctype html><html>', 30)), '');
  assert.equal(sniffImageType(new Uint8Array()), '');
});

test('recorte da captura: escala pela proporção real e limita à tela', () => {
  const vp = { width: 1000, height: 500 };
  const shot = { width: 2000, height: 1000 }; // tela com zoom/escala 2x
  assert.deepEqual(cropRect({ x: 100, y: 50, width: 300, height: 200 }, vp, shot), { x: 200, y: 100, width: 600, height: 400 });
  // parte para fora da tela é cortada
  assert.deepEqual(cropRect({ x: 900, y: -100, width: 300, height: 300 }, vp, shot), { x: 1800, y: 0, width: 200, height: 400 });
  // totalmente fora: nada a recortar
  assert.equal(cropRect({ x: 1200, y: 0, width: 50, height: 50 }, vp, shot), null);
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function deps(result, extra = {}) {
  const calls = { save: [], shot: 0, inject: [] };
  return {
    calls,
    scripting: { executeScript: async (o) => { calls.inject.push(o); if (result instanceof Error) throw result; return [{ result }]; } },
    tabs: { captureVisibleTab: async () => { calls.shot++; return PNG; } },
    cropScreenshot: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
    saveCapture: async (rec) => { calls.save.push(rec); return { id: 'x', ...rec }; },
    ...extra,
  };
}
const where = { tabId: 7, frameId: 0, windowId: 1 };

test('imagem atrás de login: baixada de dentro da página, guarda o endereço original', async () => {
  const d = deps({ via: 'fetch', dataUrl: PNG, type: 'image/png' });
  const src = 'https://chatgpt.com/backend-api/estuary/content?id=file_abc&sig=1';
  await grabAndSave(src, { pageUrl: 'https://chatgpt.com/c/1' }, where, d);
  assert.equal(d.calls.inject[0].target.tabId, 7);
  assert.deepEqual(d.calls.inject[0].args, [src, 12 * 1024 * 1024]);
  assert.equal(d.calls.save[0].url, src);
  assert.equal(d.calls.save[0].type, 'image/png');
  assert.equal(d.calls.shot, 0);
});

test('endereço blob: é salvo sem guardar o endereço (ele só existe na página)', async () => {
  const d = deps({ via: 'canvas', dataUrl: PNG, type: 'image/png' });
  await grabAndSave('blob:https://chatgpt.com/1234', {}, where, d);
  assert.equal(d.calls.save[0].url, '');
  assert.equal(d.calls.save[0].fileName, 'imagem');
});

test('sem download nem canvas: recorta da captura da tela', async () => {
  const d = deps({ rect: { x: 10, y: 10, width: 100, height: 80 }, viewport: { width: 800, height: 600 } });
  await grabAndSave('https://cdn.example.com/a.jpg', {}, where, d);
  assert.equal(d.calls.shot, 1);
  assert.equal(d.calls.save[0].source, 'screenshot');
  assert.equal(d.calls.save[0].type, 'image/png');
});

test('erros: site que bloqueia extensões, imagem grande, iframe', async () => {
  await assert.rejects(grabAndSave('https://x/a.png', {}, where, deps(new Error('Cannot access'))), /não deixa extensões[\s\S]*Copiar imagem/);
  await assert.rejects(grabAndSave('https://x/a.png', {}, where, deps({ tooBig: true })), /12 MB/);
  await assert.rejects(grabAndSave('https://x/a.png', {}, { ...where, frameId: 3 }, deps({ inFrame: true })), /iframe/);
  await assert.rejects(grabAndSave('https://x/a.png', {}, {}, deps({})), /aba da imagem/);
});
