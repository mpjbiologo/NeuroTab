// Conversa por voz (#40) e visual da voz (#39): saudação antes da escuta, pedidos seguidos, despedida, silêncio,
// visual em cada estado, microfone liberado ao fechar, estilo Clássico e "menos movimento".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, fakeMicWav } from './helpers.js';

async function setup(patch = {}) {
  const x = await launch({ voice: true });
  const p = await x.open('src/newtab.html');
  await x.settings(p, { wakeWord: true, userName: 'Marcos', widgets: [{ id: 'brain', w: 6 }], ...patch });
  // Fala "demora" 600 ms e registra a ordem: fala, fim da fala, microfone aberto.
  await p.evaluate(() => {
    window.__log = [];
    window.speechSynthesis.speak = (u) => {
      window.__spoken = (window.__spoken || []).concat(u.text);
      window.__log.push('speak:' + u.text);
      setTimeout(() => { u.onboundary?.({ name: 'word' }); }, 100);
      setTimeout(() => { window.__log.push('end'); u.onend?.(); }, 600);
    };
    const SR = window.webkitSpeechRecognition;
    const start = SR.prototype.start;
    SR.prototype.start = function () { window.__log.push('mic:' + (this.interimResults ? 'pedido' : 'ativação')); return start.call(this); };
  });
  await p.bringToFront();
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(600);
  return { x, p };
}
const say = (p, text) => p.evaluate((t) => window.__lastSR.say(t), text);
/** Espera uma nota com o texto (waitForFunction não espera Promises). */
async function noteWith(x, p, re, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await p.waitForTimeout(150)) {
    if (((await x.storage(p, 'nt_brain')) || []).some((i) => re.test(i.text))) return true;
  }
  throw new Error('nota não criada: ' + re);
}

test('conversa: chamado → saudação falada → ouve → dois pedidos → "obrigado" encerra', async () => {
  const { x, p } = await setup({ voiceViz: 'bars' });
  try {
    await say(p, 'neuro tab');
    await p.locator('#voice:not([hidden])').waitFor();
    await p.waitForFunction(() => window.__log.includes('mic:pedido'));
    const log = await p.evaluate(() => window.__log);
    const g = log.indexOf('speak:Olá, Marcos, em que posso ajudar?');
    assert.ok(g >= 0, 'falou a saudação: ' + log.join(' | '));
    assert.ok(log.indexOf('end', g) < log.indexOf('mic:pedido', g), 'o microfone só abre depois da fala');
    assert.equal(await p.getAttribute('#voice', 'data-state'), 'listening');
    assert.equal(await p.textContent('#voiceState'), 'Ouvindo');
    assert.equal(await p.getAttribute('#voice canvas.voice-viz', 'data-style'), 'bars');
    assert.equal(await p.getAttribute('#wakePill', 'data-state'), 'listening');

    // 1º pedido
    await say(p, 'timer de 5 minutos');
    await p.waitForFunction(() => (window.__spoken || []).some((s) => /Timer de 05:00/.test(s)), null, { timeout: 8000 });
    assert.equal((await x.storage(p, 'nt_timer')).duration, 300000);
    // volta a ouvir sozinho, depois da resposta falada
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening', null, { timeout: 5000 });
    // 2º pedido
    await say(p, 'anotar comprar café');
    await noteWith(x, p, /comprar café$/);
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening', null, { timeout: 5000 });
    // despedida
    await say(p, 'obrigado');
    await p.locator('#voiceHeard', { hasText: 'Até mais!' }).waitFor({ timeout: 5000 });
    await p.locator('#voice[hidden]').waitFor({ state: 'attached', timeout: 4000 });
    assert.equal(await p.locator('#voice canvas.voice-viz').count(), 0, 'visual (e microfone dele) liberado ao fechar');
    await p.waitForFunction(() => document.querySelector('#wakePill').dataset.state === 'waiting', null, { timeout: 5000 });
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('conversa: pedido junto executa sem saudação; silêncio encerra; Esc fecha', async () => {
  const { x, p } = await setup({ voiceSilenceSecs: 15, voiceViz: 'orb' });
  try {
    await say(p, 'neurotab anotar ligar para o banco');
    await noteWith(x, p, /ligar para o banco/);
    assert.equal((await p.evaluate(() => window.__spoken || [])).some((s) => /^Olá/.test(s)), false, 'sem saudação');
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening', null, { timeout: 5000 });
    // silêncio: encerra sozinho após 15 s (com "Até mais!")
    await p.locator('#voiceHeard', { hasText: 'Até mais!' }).waitFor({ timeout: 19000 });
    await p.locator('#voice[hidden]').waitFor({ state: 'attached', timeout: 4000 });

    // Esc fecha na hora
    await p.waitForFunction(() => document.querySelector('#wakePill').dataset.state === 'waiting', null, { timeout: 5000 });
    await say(p, 'neuro tab');
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening', null, { timeout: 5000 });
    await p.keyboard.press('Escape');
    await p.locator('#voice[hidden]').waitFor({ state: 'attached', timeout: 3000 });
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('botão 🎙: um pedido só por padrão; conversa se escolhido; Clássico e "menos movimento"', async () => {
  const { x, p } = await setup({ wakeWord: false, voiceViz: 'classic' });
  try {
    await p.click('#voiceFab');
    await p.waitForTimeout(300);
    assert.equal(await p.locator('#voice canvas.voice-viz').count(), 0, 'Clássico: sem canvas');
    assert.equal(await p.evaluate(() => document.querySelector('#voice .voice-orb').classList.contains('viz')), false);
    await p.evaluate(() => { window.__lastSR.say('timer de 1 minuto'); window.__lastSR.stop(); });
    await p.waitForFunction(() => (window.__spoken || []).some((s) => /Timer de 01:00/.test(s)), null, { timeout: 6000 });
    await p.waitForTimeout(1200);
    assert.equal(await p.evaluate(() => window.__log.filter((l) => l === 'mic:pedido').length), 1, 'não voltou a ouvir');
    await p.keyboard.press('Escape');

    await p.emulateMedia({ reducedMotion: 'reduce' });
    await x.settings(p, { wakeWord: false, voiceViz: 'particles', voiceConvButton: true });
    await p.evaluate(() => { window.__log = []; window.speechSynthesis.speak = (u) => { window.__log.push('speak:' + u.text); setTimeout(() => u.onend?.(), 50); }; });
    await p.click('#voiceFab');
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening');
    assert.equal(await p.locator('#voice canvas.voice-viz').count(), 1);
    assert.equal(await p.evaluate(() => document.querySelector('#voice').classList.contains('conversation')), true, 'conversa pelo botão');
    assert.equal((await p.evaluate(() => window.__log)).some((l) => l.startsWith('speak:')), false, 'botão não cumprimenta');
    await p.evaluate(() => window.__lastSR.say('tchau'));
    await p.locator('#voice[hidden]').waitFor({ state: 'attached', timeout: 5000 });
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('visual: microfone falso do Chromium move as ondas e é liberado ao fechar', async () => {
  const x = await launch({ fakeMic: fakeMicWav([[1.5, 0.6], [1.5, 0]]) });
  try {
    const p = await x.open('src/newtab.html');
    const r = await p.evaluate(async () => {
      const { openMeter } = await import('./lib/voice-viz.js');
      let track;
      const m = await openMeter({ getUserMedia: async (c) => { const s = await navigator.mediaDevices.getUserMedia(c); [track] = s.getAudioTracks(); return s; } });
      if (!m) return { ok: false };
      const levels = [];
      for (let i = 0; i < 40; i++) { levels.push(m.level()); await new Promise((res) => setTimeout(res, 75)); }
      const bands = m.bands(8);
      m.close();
      return { ok: true, max: Math.max(...levels), min: Math.min(...levels), bands: bands.length, state: track.readyState };
    });
    assert.ok(r.ok, 'abriu o microfone');
    assert.ok(r.max > 0.2, `som alto mexe as ondas (${r.max})`);
    assert.ok(r.min < 0.05, `silêncio fica parado (${r.min})`);
    assert.equal(r.bands, 8);
    assert.equal(r.state, 'ended', 'microfone liberado');
  } finally {
    await x.close();
  }
});

/** Vozes que só "chegam" 500 ms depois de a página abrir, como no navegador de verdade. */
const lateVoices = (p) => p.evaluate(() => {
  const voices = [{ name: 'Robô', voiceURI: 'v-robo', lang: 'pt-BR', localService: true }, { name: 'Boa', voiceURI: 'v-boa', lang: 'pt-BR', localService: true }];
  let ready = false;
  setTimeout(() => { ready = true; }, 500);
  window.__used = [];
  Object.assign(window.speechSynthesis, {
    getVoices: () => (ready ? voices : []),
    speak(u) { window.__used.push([u.text, u.voice?.voiceURI || 'padrão do sistema']); setTimeout(() => u.onend?.(), 50); },
  });
});
async function greetOnce(p) {
  await p.bringToFront();
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(400);
  await p.evaluate(() => window.__lastSR.say('neuro tab'));
  await p.waitForFunction(() => window.__used?.length > 0, null, { timeout: 5000 });
  return p.evaluate(() => window.__used[0]);
}

test('voz da saudação (#70): espera as vozes carregarem e usa a escolhida (ou a própria da saudação)', async () => {
  const x = await launch({ voice: true });
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { wakeWord: true, userName: 'Marcos', ttsVoice: 'v-boa' });
    await lateVoices(p);
    assert.deepEqual(await greetOnce(p), ['Olá, Marcos, em que posso ajudar?', 'v-boa']);
    await p.keyboard.press('Escape');
    // voz própria para a saudação
    await x.settings(p, { wakeWord: true, userName: 'Marcos', ttsVoice: 'v-boa', voiceGreetVoice: 'v-robo' });
    await lateVoices(p);
    assert.deepEqual(await greetOnce(p), ['Olá, Marcos, em que posso ajudar?', 'v-robo']);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
