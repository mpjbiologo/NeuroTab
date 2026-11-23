// 💬 Modo conversa (#44): liga pelo botão, responde a tudo com o histórico, comandos no meio, "anota isso",
// desliga e salva a conversa como nota. E os botões 💬/📋 não cobrem widgets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const say = (p, text) => p.evaluate((t) => window.__lastSR.say(t), text);
async function waitNote(x, p, re, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await p.waitForTimeout(150)) {
    const it = ((await x.storage(p, 'nt_brain')) || []).find((i) => re.test(i.text));
    if (it) return it;
  }
  throw new Error('nota não criada: ' + re);
}

test('modo conversa: contexto entre falas, comando no meio, "anota isso", salvar a conversa', async () => {
  const seen = [];
  const x = await launch({
    voice: true,
    ai: (sys, body) => {
      if (!sys.includes('segundo cérebro')) return undefined;
      const msgs = body.contents.map((c) => c.parts.map((q) => q.text).join(''));
      seen.push(msgs);
      const last = msgs.at(-1);
      if (/capital da França/.test(last)) return 'A capital da França é Paris.';
      if (/e da Itália/.test(last)) return msgs.some((m) => /Paris/.test(m)) ? 'A da Itália é Roma.' : 'Itália de quê?';
      return 'Certo.';
    },
  });
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { ai: { keys: { gemini: 'K' } }, userName: 'Marcos', widgets: [{ id: 'brain', w: 6 }] });
    await p.evaluate(() => { window.__log = []; const sp = window.speechSynthesis.speak; window.speechSynthesis.speak = (u) => { window.__log.push(u.text); sp(u); }; });
    assert.equal(await p.isVisible('#chatFab'), true);
    assert.equal(await p.isVisible('#meetFab'), true);

    await p.click('#chatFab');
    // primeira vez: aviso de custo e privacidade
    await p.locator('#voiceReply', { hasText: 'chamada à IA' }).waitFor();
    await p.click('#voiceReply button.primary');
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening');
    assert.ok((await p.evaluate(() => window.__log)).includes('Olá, Marcos, em que posso ajudar?'));
    assert.equal(await p.getAttribute('#chatFab', 'aria-pressed'), 'true');
    assert.equal((await x.storage(p, 'nt_data')).settings.voiceChatNoticed, true);

    await say(p, 'qual é a capital da França');
    await p.locator('#voiceReply', { hasText: 'Paris' }).waitFor({ timeout: 8000 });
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening', null, { timeout: 5000 });
    await say(p, 'e da Itália');
    await p.locator('#voiceReply', { hasText: 'Roma' }).waitFor({ timeout: 8000 });
    assert.ok(seen.at(-1).some((m) => /capital da França/.test(m)), 'a 2ª pergunta levou o histórico');

    // comando no meio da conversa continua valendo
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening', null, { timeout: 5000 });
    await say(p, 'timer de 3 minutos');
    await p.waitForFunction(() => (window.__spoken || []).some((s) => /Timer de 03:00/.test(s)), null, { timeout: 8000 });

    // "anota isso" guarda a última resposta
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening', null, { timeout: 5000 });
    await say(p, 'anota isso');
    await waitNote(x, p, /^Timer de 03:00/);

    // desligar pelo botão → oferece salvar a conversa
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening', null, { timeout: 5000 });
    await p.click('#chatFab');
    await p.locator('#chatSave').click();
    const note = await waitNote(x, p, /^Conversa por voz — /);
    assert.match(note.text, /capital da França/);
    assert.match(note.text, /Roma/);
    assert.equal(await p.getAttribute('#chatFab', 'aria-pressed'), 'false');
    await p.locator('#voice[hidden]').waitFor({ state: 'attached', timeout: 4000 });
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('modo conversa por voz ("modo conversa") e sem IA só aceita comandos; esconder os botões', async () => {
  const x = await launch({ voice: true });
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { wakeWord: false, voiceConvButton: true, voiceChatNoticed: true, voiceGreet: false });
    await p.click('#voiceFab');
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening');
    await say(p, 'modo conversa');
    await p.waitForFunction(() => document.querySelector('#voice').classList.contains('chat-mode'), null, { timeout: 6000 });
    await p.waitForFunction(() => document.querySelector('#voice').dataset.state === 'listening', null, { timeout: 5000 });
    await say(p, 'me explica a teoria da relatividade');
    await p.locator('#voiceReply', { hasText: 'só entendo comandos' }).waitFor({ timeout: 6000 });
    await p.keyboard.press('Escape');
    await p.locator('#voiceReply', { hasText: 'Salvar a conversa' }).waitFor();
    await p.keyboard.press('Escape');

    await x.settings(p, { voiceModeButtons: false });
    await p.reload();
    await p.waitForTimeout(600);
    assert.equal(await p.isVisible('#chatFab'), false);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
