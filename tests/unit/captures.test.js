import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImage, MAX_IMAGE_BYTES } from '../../src/lib/captures.js';

test('validateImage: aceita imagens e normaliza o tipo', () => {
  assert.equal(validateImage(new Blob([new Uint8Array(10)], { type: 'image/PNG; charset=x' })), 'image/png');
  assert.equal(validateImage(new Blob([new Uint8Array(10)]), 'image/jpeg'), 'image/jpeg');
});

test('validateImage: recusa vazio, não-imagem e acima de 12 MB', () => {
  assert.throws(() => validateImage(new Blob([], { type: 'image/png' })), /vazia/);
  assert.throws(() => validateImage(null), /vazia/);
  assert.throws(() => validateImage(new Blob(['<html>'], { type: 'text/html' })), /não é uma imagem/);
  const big = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' });
  assert.throws(() => validateImage(big), /12 MB/);
});
