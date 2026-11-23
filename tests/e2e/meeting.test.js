// 📋 Modo reunião (#41): aviso, transcrição com horários, ⭐ (botão e "marca isso"), pausar, encerrar, resumo pela
// IA, nota no cérebro, tarefas; online com áudio da aba (mistura, gravação, compartilhamento caindo); retomada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const SUMMARY = { resumo: 'Combinamos o lançamento da versão nova.', pontos: ['Lançar na sexta'], decisoes: ['Marcos revisa o texto'], tarefas: [{ texto: 'Revisar o texto da loja', responsavel: 'Marcos', prazo: 'amanhã às 9h' }], perguntas: ['Quem avisa os usuários?'] };
const aiMeeting = (sys) => (sys.includes('secretário de uma reunião') ? JSON.stringify(SUMMARY) : undefined);
const say = (p, text) => p.evaluate((t) => window.__lastSR.say(t), text);

/** Microfone e aba "de verdade" (osciladores), para a mistura, o medidor e a gravação funcionarem. */
const realMedia = (p) => p.evaluate(() => {
  const ac = new AudioContext();
  const tone = (f) => { const o = ac.createOscillator(); o.frequency.value = f; const g = ac.createGain(); g.gain.value = 0.5; const d = ac.createMediaStreamDestination(); o.connect(g).connect(d); o.start(); return d.stream; };
  navigator.mediaDevices.getUserMedia = async () => tone(330);
  navigator.mediaDevices.getDisplayMedia = async () => { const s = tone(550); window.__tabTrack = s.getAudioTracks()[0]; return s; };
  window.__srArgs = [];
  const st = window.webkitSpeechRecognition.prototype.start;
  window.webkitSpeechRecognition.prototype.start = function (track) { window.__srArgs.push(track ? track.kind : 'mic'); return st.call(this); };
});

async function items(x, p) { return (await x.storage(p, 'nt_brain')) || []; }
async function waitItem(x, p, fn, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await p.waitForTimeout(200)) { const it = (await items(x, p)).find(fn); if (it) return it; }
  throw new Error('item não encontrado');
}

test('reunião presencial: aviso, ⭐, pausar, encerrar → resumo, nota e tarefa', async () => {
  const x = await launch({ voice: true, ai: aiMeeting });
  try {
    const n = await x.open('src/newtab.html');
    await x.settings(n, { ai: { keys: { gemini: 'K' } } });
    const p = await x.open('src/meeting.html');
    await p.locator('#consent:not([hidden])').waitFor();
    assert.equal(await p.isChecked('#srcMic'), true);
    await p.check('#consentSkip');
    await p.click('#start');
    await p.locator('#liveSec:not([hidden])').waitFor();
    assert.equal((await x.storage(p, 'nt_meeting_live')).state, 'recording');
    await say(p, 'bom dia a todos vamos falar do lançamento');
    await p.click('#markBtn');
    await say(p, 'o lançamento fica para sexta marca isso');
    await p.locator('.seg.marked').first().waitFor();
    assert.equal(await p.locator('.seg').count(), 2);
    // pausar e continuar
    await p.click('#pauseBtn');
    assert.equal((await x.storage(p, 'nt_meeting_live')).state, 'paused');
    assert.match(await p.textContent('#liveState'), /Pausada/);
    await p.click('#pauseBtn');
    await p.waitForFunction(() => window.__lastSR?.started);
    await say(p, 'Marcos revisa o texto da loja amanhã às nove');
    // 📋 vermelho na nova aba
    await n.bringToFront();
    await n.locator('#meetFab.on').waitFor({ timeout: 4000 });
    assert.match(await n.textContent('#meetFab .mf-time'), /^\d\d:\d\d$/);
    await p.bringToFront();
    await p.click('#endBtn');
    await p.locator('#doneSec:not([hidden])').waitFor();
    await p.locator('#sumBox', { hasText: 'Combinamos o lançamento' }).waitFor({ timeout: 10000 });
    assert.equal(await x.storage(p, 'nt_meeting_live'), undefined, 'indicador apagado');
    const note = await waitItem(x, p, (i) => /^Reunião — /.test(i.text) && /Combinamos/.test(i.text));
    assert.match(note.text, /## Pontos importantes\n- Lançar na sexta/);
    assert.match(note.text, /## Transcrição\n\[00:\d\d\] ⭐ bom dia/, "botão ⭐ marca o trecho mais recente");
    assert.match(note.text, /⭐ o lançamento fica para sexta/);
    await p.click('[data-task="0"]');
    await waitItem(x, p, (i) => i.type === 'task' && /Revisar o texto da loja \(Marcos\)/.test(i.text) && i.remindAt > Date.now());
    // histórico
    assert.equal(await p.locator('.hist-row').count(), 1);
    assert.equal((await x.storage(p, 'nt_data')).settings.meetingConsentSkip, true);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('reunião online: microfone + áudio da aba, gravação do áudio e compartilhamento caindo', async () => {
  const x = await launch({ voice: true });
  try {
    const p = await x.open('src/meeting.html');
    await realMedia(p);
    await p.check('#srcTab');
    await p.check('#keepAudio');
    await p.click('#start');
    await p.locator('#liveSec:not([hidden])').waitFor();
    assert.equal(await p.isVisible('#mTabW'), true, 'medidor da aba');
    await p.waitForFunction(() => window.__srArgs.length > 0);
    assert.equal(await p.evaluate(() => window.__srArgs[0]), 'audio', 'transcreve a faixa misturada');
    await p.waitForFunction(() => parseFloat(document.querySelector('#mTab').style.width) > 5, null, { timeout: 5000 });
    await say(p, 'a pauta de hoje é o orçamento');
    // a aba parou de compartilhar: segue com o microfone
    await p.evaluate(() => window.__tabTrack.dispatchEvent(new Event('ended')));
    await p.locator('#liveWarn', { hasText: 'só com o microfone' }).waitFor();
    await p.waitForTimeout(800);
    assert.equal(await p.evaluate(() => window.__srArgs.at(-1)), 'mic');
    await say(p, 'sem a IA o resumo fica para depois');
    await p.waitForTimeout(1500);
    await p.click('#endBtn');
    await p.locator('#doneSec:not([hidden])').waitFor();
    await p.locator('#audioBox audio').waitFor({ timeout: 8000 });
    assert.equal(await p.isVisible('#dlAudio'), true);
    assert.match(await p.textContent('#sumBox'), /Configure uma IA/);
    const m = await p.evaluate(async () => (await import('./lib/meeting-store.js')).listMeetings());
    assert.equal(m.length, 1);
    assert.ok(m[0].audioBytes > 0, 'áudio guardado');
    assert.equal(m[0].source, 'tab');
    assert.equal(m[0].segments.length, 2);
    // apagar só o áudio mantém a transcrição
    await p.click('.hist-row button:has-text("Apagar o áudio")');
    await p.waitForFunction(() => !document.querySelector('#audioBox audio'));
    const m2 = await p.evaluate(async () => (await import('./lib/meeting-store.js')).listMeetings());
    assert.equal(m2[0].audioBytes, 0);
    assert.equal(m2[0].segments.length, 2);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('reunião interrompida: a aba fechou no meio → finalizar com o que foi gravado', async () => {
  const x = await launch({ voice: true });
  try {
    let p = await x.open('src/meeting.html');
    await p.click('#start');
    await p.locator('#liveSec:not([hidden])').waitFor();
    await say(p, 'primeiro assunto é o contrato');
    await p.waitForTimeout(700); // salvo
    await p.close({ runBeforeUnload: false });
    p = await x.open('src/meeting.html');
    await p.locator('#resumeSec:not([hidden])').waitFor();
    assert.match(await p.textContent('#resumeInfo'), /1 trechos/);
    await p.click('#resumeEnd');
    await p.locator('#doneSec:not([hidden])').waitFor();
    await waitItem(x, p, (i) => /^Reunião — /.test(i.text) && /primeiro assunto é o contrato/.test(i.text));
    assert.equal(await x.storage(p, 'nt_meeting_live'), undefined);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
