// Leitura de imagens (#17/#54): endereços, limpeza do texto lido e envio de imagem a cada provedor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAddress, cleanOcr, ocrLangFor, OCR_DATA, visionNeedsConsent } from '../../src/lib/vision.js';
import { complete, isLocalAI } from '../../src/lib/ai.js';

test('findAddress acha endereços em pt, es e en', () => {
  assert.equal(findAddress('Venha nos visitar!\nAv. Afonso Pena, 1500 - Centro, Belo Horizonte\nTel. 3333'), 'Av. Afonso Pena, 1500 - Centro, Belo Horizonte');
  assert.equal(findAddress('Rua da Bahia 1148'), 'Rua da Bahia 1148');
  assert.equal(findAddress('Praça da Liberdade, s/n'), 'Praça da Liberdade, s/n');
  assert.equal(findAddress('Calle de Alcalá, 42, Madrid'), 'Calle de Alcalá, 42, Madrid');
  assert.match(findAddress('Visit us at 221 Baker Street, London'), /^221 Baker Street/);
  assert.equal(findAddress('CEP 30130-110'), '30130-110');
  assert.equal(findAddress('Promoção de verão: tudo 50% off'), null);
  assert.equal(findAddress(''), null);
});

test('cleanOcr tira linhas de lixo e espaços', () => {
  assert.equal(cleanOcr('  Olá   mundo \n|\n~ ;\n\n\n\nSegunda   linha\r\n'), 'Olá mundo\nSegunda linha');
});

test('idioma do leitor e pacote com versão fixa', () => {
  assert.equal(ocrLangFor('pt-BR'), 'por');
  assert.equal(ocrLangFor('en'), 'eng');
  assert.equal(ocrLangFor('es'), 'spa');
  assert.equal(ocrLangFor('fr'), 'por');
  assert.match(OCR_DATA('por'), /@tesseract\.js-data\/por@\d+\.\d+\.\d+\/4\.0\.0_best_int$/);
});

test('consentimento: IA local não pergunta; serviço na internet pergunta até ser liberado', () => {
  const s = (provider, extra = {}) => ({ ai: { provider, keys: { gemini: 'k' }, ...extra } });
  assert.equal(isLocalAI(s('ollama')), true);
  assert.equal(isLocalAI(s('custom', { baseUrls: { custom: 'http://127.0.0.1:1234/v1' } })), true);
  assert.equal(isLocalAI(s('gemini')), false);
  assert.equal(visionNeedsConsent(s('ollama')), false);
  assert.equal(visionNeedsConsent(s('gemini')), true);
  assert.equal(visionNeedsConsent(s('gemini', { imagesAllowed: true })), false);
});

test('imagem vai no formato de cada provedor', async () => {
  const sent = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    sent.push({ u: String(u), body: JSON.parse(o.body) });
    const json = String(u).includes('generateContent') ? { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }
      : String(u).endsWith('/messages') ? { content: [{ type: 'text', text: 'ok' }] }
      : { choices: [{ message: { content: 'ok' } }] };
    return new Response(JSON.stringify(json), { status: 200 });
  };
  try {
    const content = [{ type: 'image', mime: 'image/jpeg', data: 'QUJD' }, { type: 'text', text: 'o que é?' }];
    const run = (provider) => complete({ ai: { provider, keys: { gemini: 'k', anthropic: 'k', openai: 'k' } } }, { messages: [{ role: 'user', content }] });
    await run('gemini');
    await run('anthropic');
    await run('openai');
    await run('ollama');
    assert.deepEqual(sent[0].body.contents[0].parts, [{ inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } }, { text: 'o que é?' }]);
    assert.deepEqual(sent[1].body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
    assert.deepEqual(sent[2].body.messages[0].content[0], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } });
    assert.match(sent[3].u, /localhost:11434/);
    assert.equal(sent[3].body.messages[0].content[1].text, 'o que é?');
    // texto puro continua igual
    await complete({ ai: { provider: 'openai', keys: { openai: 'k' } } }, { messages: [{ role: 'user', content: 'oi' }] });
    assert.equal(sent[4].body.messages[0].content, 'oi');
  } finally {
    globalThis.fetch = orig;
  }
});
