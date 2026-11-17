// Voz processada no computador (#49): Whisper local (microfone falso do Chrome) e reconhecimento local do navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, fakeMicWav } from './helpers.js';

const CORS = { 'access-control-allow-origin': '*' };

test('Whisper local: grava, separa a fala pelo silêncio, transcreve no localhost e executa o comando', async () => {
  const x = await launch({ fakeMic: fakeMicWav([[0.4, 0], [1.2, 0.5], [3, 0]]) });
  try {
    const sent = [];
    await x.ctx.route('http://127.0.0.1:8080/**', async (r) => {
      const req = r.request();
      sent.push({ url: req.url(), type: req.headers()['content-type'] || '', bytes: req.postDataBuffer()?.length || 0 });
      await r.fulfill({ json: { text: ' Anotar comprar café. ' }, headers: CORS });
    });
    // nenhum reconhecimento do navegador: tudo tem de passar pelo Whisper
    await x.ctx.addInitScript(() => {
      delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(u) { window.__spoken = (window.__spoken || []).concat(u.text); setTimeout(() => u.onend?.(), 0); }, getVoices: () => [] } });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: class { constructor(t) { this.text = t; } } });
    });
    const p = await x.open('src/newtab.html');
    await x.settings(p, { voiceEngine: 'whisper', whisperUrl: 'http://127.0.0.1:8080/inference', voiceLocalOnly: true });
    assert.equal(await p.isVisible('#voiceFab'), true, 'o botão de voz aparece mesmo sem reconhecimento do navegador');
    await p.click('#voiceFab');
    assert.equal(await p.textContent('#voiceWhere'), '🔒');
    await p.waitForFunction(() => /comprar café/.test(document.querySelector('#voiceHeard')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(sent.length >= 1, true);
    assert.match(sent[0].type, /multipart\/form-data/);
    assert.ok(sent[0].bytes > 16000, `áudio enviado: ${sent[0].bytes} bytes`);
    // o comando foi executado: virou uma nota no cérebro
    await p.waitForFunction(async () => ((await chrome.storage.local.get('nt_brain')).nt_brain || []).some((i) => /comprar café/.test(i.text)), null, { timeout: 5000 });
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Whisper fora do ar: o erro diz o que fazer', async () => {
  const x = await launch({ fakeMic: fakeMicWav([[0.3, 0], [1, 0.5], [3, 0]]) });
  try {
    await x.ctx.route('http://127.0.0.1:8080/**', (r) => r.abort('connectionrefused'));
    const p = await x.open('src/newtab.html');
    await x.settings(p, { voiceEngine: 'whisper', whisperUrl: 'http://127.0.0.1:8080/inference' });
    await p.click('#voiceFab');
    await p.waitForFunction(() => /Whisper local/.test(document.querySelector('#voiceReply')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await p.textContent('#voiceReply'), /Não consegui falar com o Whisper local \(http:\/\/127\.0\.0\.1:8080\/inference\)/);
  } finally {
    await x.close();
  }
});

test('reconhecimento do navegador no computador: usa processLocally quando o idioma está baixado; "somente local" nunca usa a nuvem', async () => {
  const x = await launch({ voice: true });
  try {
    await x.ctx.addInitScript(() => {
      const SR = window.SpeechRecognition;
      SR.prototype.processLocally = false;
      SR.available = async ({ langs, processLocally }) => (window.__deviceOk && processLocally && langs[0] === 'pt-BR' ? 'available' : 'downloadable');
      SR.install = async () => true;
    });
    const p = await x.open('src/newtab.html');
    // 1) idioma baixado: fica no computador
    await p.evaluate(() => { window.__deviceOk = true; });
    await x.settings(p, { voiceLang: 'pt-BR' });
    await p.evaluate(() => { window.__deviceOk = true; });
    await p.evaluate(async () => { const m = await import('/src/lib/speech-engine.js'); await m.deviceStatus('pt-BR', { fresh: true }); });
    await p.click('#voiceFab');
    assert.equal(await p.evaluate(() => window.__lastSR.processLocally), true);
    assert.equal(await p.textContent('#voiceWhere'), '🔒');
    await p.keyboard.press('Escape');
    // 2) não baixado + somente local: não abre o reconhecimento da nuvem, avisa
    await x.settings(p, { voiceLocalOnly: true });
    await p.evaluate(() => { window.__lastSR = null; });
    await p.click('#voiceFab');
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => window.__lastSR), null, 'nenhum reconhecimento iniciado');
    assert.match(await p.locator('.toast').last().textContent(), /Voz só local/);
    // 3) sem "somente local": nuvem, com o aviso ☁
    await x.settings(p, { voiceLocalOnly: false });
    await p.click('#voiceFab');
    assert.equal(await p.evaluate(() => window.__lastSR.processLocally), false);
    assert.equal(await p.textContent('#voiceWhere'), '☁');
  } finally {
    await x.close();
  }
});

test('Opções: escolha do motor, servidores conhecidos e teste de conexão do Whisper', async () => {
  const x = await launch();
  try {
    await x.ctx.addInitScript(() => { if (globalThis.chrome?.permissions) { chrome.permissions.contains = async () => true; chrome.permissions.request = async () => true; } });
    let tested = 0;
    await x.ctx.route('http://127.0.0.1:8000/**', (r) => { tested++; r.fulfill({ json: { text: '' }, headers: CORS }); });
    const p = await x.open('src/options.html');
    await p.click('[data-tab="ia"]');
    assert.equal(await p.inputValue('#voiceEngine'), 'auto');
    assert.equal(await p.isVisible('#whisperBox'), false);
    await p.selectOption('#voiceEngine', 'whisper');
    await p.waitForSelector('#whisperBox:not([hidden])');
    await p.click('#whisperPresets .chip:has-text("Speaches")');
    await p.waitForTimeout(300);
    const s = (await x.storage(p, 'nt_data')).settings;
    assert.equal(s.whisperUrl, 'http://127.0.0.1:8000/v1/audio/transcriptions');
    assert.equal(s.voiceEngine, 'whisper');
    await p.click('#whisperTest');
    await p.waitForFunction(() => /respondeu/.test(document.querySelector('#whisperMsg').textContent));
    assert.match(await p.textContent('#whisperMsg'), /✅/);
    assert.equal(tested, 1);
    await p.click('label.sw:has(#voiceLocalOnly)');
    await p.waitForTimeout(300);
    assert.match(await p.textContent('#localAiNote'), /Google Gemini/, 'avisa que a IA ainda é na nuvem');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Opções: navegador sem pt-BR no computador baixa pt-PT; falha explica o motivo e mostra o Whisper', async () => {
  const x = await launch({ voice: true });
  try {
    await x.ctx.addInitScript(() => {
      const SR = window.SpeechRecognition;
      SR.prototype.processLocally = false;
      window.__ok = new Set();
      SR.available = async ({ langs: [l] }) => (window.__ok.has(l) ? 'available' : l === 'pt-PT' ? 'downloadable' : 'unavailable');
      SR.install = async ({ langs: [l] }) => { if (window.__refuse) return false; window.__ok.add(l); return true; };
    });
    const p = await x.open('src/options.html');
    await x.settings(p, { voiceLang: 'pt-BR' });
    await p.click('[data-tab="ia"]');
    await p.waitForFunction(() => /pt-PT/.test(document.querySelector('#deviceStatus').textContent));
    assert.match(await p.textContent('#deviceStatus'), /não tem pt-BR no computador; vamos usar pt-PT/);
    // recusa: motivo na tela e o Whisper aparece como alternativa
    await p.evaluate(() => { window.__refuse = true; });
    await p.click('#deviceInstall');
    await p.waitForFunction(() => /Não foi possível baixar/.test(document.querySelector('#deviceStatus').textContent));
    assert.match(await p.textContent('#deviceStatus'), /recusou o pacote de pt-PT/);
    assert.equal(await p.isVisible('#whisperBox'), true);
    // aceita
    await p.evaluate(() => { window.__refuse = false; });
    await p.click('#deviceInstall');
    await p.waitForFunction(() => /já está no computador/.test(document.querySelector('#deviceStatus').textContent));
    assert.match(await p.textContent('#deviceStatus'), /🔒 O reconhecimento de pt-PT já está no computador/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
