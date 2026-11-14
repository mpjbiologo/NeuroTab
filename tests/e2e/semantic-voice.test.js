// Busca por significado, comandos de voz (pt/en/es), respostas longas e palavra de ativação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const now = Date.now();
const NOTES = [
  { id: 'a', type: 'note', text: 'Dormi mal de novo, acordei às 4h e fiquei cansado o dia todo', tags: [], createdAt: now - 1000 },
  { id: 'b', type: 'task', text: 'Pagar o boleto do condomínio', tags: [], remindAt: now - 3600e3, createdAt: now - 2000 },
  { id: 'c', type: 'note', text: 'Receita de bolo de cenoura', tags: [], createdAt: now - 3000 },
  { id: 'd', type: 'task', text: 'Ideia de app para treinos', tags: [], createdAt: now - 4000 },
];
const LONG = 'Fotossíntese é:\n\n* **Luz** vira energia [1]\n* A planta produz glicose\n\n' + 'Mais detalhes. '.repeat(150);
const ai = (sys) => (sys.includes('interpreta comandos') ? JSON.stringify({ action: 'timer', seconds: 120 }) : sys.includes('NOTAS DO USUÁRIO') ? LONG : null);

async function setup(locale = 'pt-BR') {
  const x = await launch({ locale, voice: true, ai });
  const p = await x.open('src/newtab.html');
  const data = await x.storage(p, 'nt_data');
  data.settings.ai = { ...data.settings.ai, keys: { gemini: 'K' }, autoEnrich: false, semantic: true };
  data.settings.widgets = [{ id: 'brain', w: 6 }, { id: 'capture', w: 6 }];
  await x.seed(p, { nt_data: data, nt_brain: NOTES });
  return { x, p };
}

async function say(p, text) {
  await p.click('#voiceFab');
  await p.waitForTimeout(150);
  await p.evaluate((t) => { window.__lastSR.say(t); window.__lastSR.stop(); }, text);
  await p.waitForTimeout(900);
  return p.textContent('#voiceReply');
}

test('busca por significado: "sono" encontra "dormi mal" (✨)', async () => {
  const { x, p } = await setup();
  try {
    await p.waitForTimeout(6500); // indexação automática em segundo plano
    assert.ok(x.calls.embed >= 1, 'gerou o índice');
    await p.fill('.widget[data-id=brain] input[type=search]', 'sono');
    await p.waitForTimeout(1500);
    const rows = await p.$$eval('.widget[data-id=brain] .item', (els) => els.map((e) => (e.querySelector('.sem-hit') ? '✨' : '') + e.querySelector('.tt').textContent));
    assert.ok(rows[0]?.startsWith('✨Dormi mal'), JSON.stringify(rows));
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('voz: tarefas, resposta longa formatada com rolagem e plano B da IA', async () => {
  const { x, p } = await setup();
  try {
    assert.match(await say(p, 'Me diga aí, o que que eu tenho que fazer?'), /^Atrasadas \(1\): Pagar o boleto/);
    await p.waitForTimeout(9000);
    assert.ok(await p.isHidden('#voice'), 'resposta curta fecha sozinha');

    await say(p, 'o que é fotossíntese?');
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => { const el = document.querySelector('#voiceReply'); return { list: !!el.querySelector('ul li b'), stars: el.textContent.includes('*'), scroll: el.scrollHeight > el.clientHeight, card: document.querySelector('.voice-card').getBoundingClientRect().height, vh: innerHeight }; });
    assert.ok(r.list && !r.stars, 'Markdown formatado');
    assert.ok(r.scroll && r.card <= r.vh * 0.75, 'caixa com rolagem dentro da tela');
    await p.waitForTimeout(6000);
    assert.ok(await p.isVisible('#voice'), 'resposta longa fica aberta');
    await p.click('#voiceClose');

    assert.match(await say(p, 'bota aí uns dois minutinhos pro chá'), /Timer de 02:00/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

for (const [locale, said, want] of [['en-US', 'remind me tomorrow at 9am to pay the bill', /^Done\. I'll remind you/], ['es-ES', 'recuérdame mañana a las 9 pagar la cuenta', /recordaré|Hecho|Listo/]]) {
  test(`voz em ${locale}: lembrete e resposta no mesmo idioma`, async () => {
    const { x, p } = await setup(locale);
    try {
      assert.match(await say(p, said), want);
      const brain = await x.storage(p, 'nt_brain');
      assert.ok(brain.some((i) => i.remindAt && /bill|cuenta/.test(i.text)));
      assert.deepEqual(x.errors, []);
    } finally {
      await x.close();
    }
  });
}

test('palavra de ativação: escuta, executa, volta a escutar e pausa', async () => {
  const { x, p } = await setup();
  try {
    await x.settings(p, { wakeWord: true });
    await p.bringToFront();
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await p.waitForTimeout(600);
    assert.match(await p.textContent('#wakePill'), /Ouvindo/);
    await p.evaluate(() => window.__lastSR.say('neuro tab timer de 5 minutos'));
    await p.waitForTimeout(1200);
    assert.match(await p.textContent('#voiceReply'), /Timer de 05:00/);
    assert.equal((await x.storage(p, 'nt_timer')).duration, 300000);
    await p.waitForTimeout(2500);
    assert.ok(await p.evaluate(() => window.__lastSR.started && window.__lastSR.continuous), 'voltou a escutar');
    await p.click('#wakePill');
    await p.waitForTimeout(300);
    assert.match(await p.textContent('#wakePill'), /pausada/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('nome do assistente e frase composta: bipe, estados, cancelar e tempo esgotado (#15)', async () => {
  const { x, p } = await setup();
  try {
    await x.settings(p, { wakeWord: true, assistantName: 'Verônica', wakePhrase: 'Acorde Verônica', wakeCommandSecs: 3 });
    await p.bringToFront();
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    // Conta os bipes trocando o gerador de som por um falso
    await p.evaluate(() => {
      window.__beeps = 0;
      window.AudioContext = class {
        constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
        createOscillator() { return { frequency: {}, connect: (g) => g, start() { window.__beeps += 0.5; }, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d) => d }; }
      };
    });
    await p.waitForTimeout(600);
    assert.equal(await p.getAttribute('#wakePill', 'data-state'), 'waiting');
    assert.match(await p.textContent('#wakePill'), /Ouvindo “Acorde Verônica”/);

    // Só o nome não basta quando a frase é composta
    await p.evaluate(() => window.__lastSR.say('Verônica anotar comprar pão'));
    await p.waitForTimeout(800);
    assert.equal((await x.storage(p, 'nt_brain')).some((i) => /pão/.test(i.text)), false);

    // Com um erro comum do reconhecimento ("acorda Berônica") e o pedido junto: executa direto
    await p.evaluate(() => window.__lastSR.say('acorda Berônica anotar comprar café'));
    await p.waitForTimeout(1500);
    assert.ok((await x.storage(p, 'nt_brain')).some((i) => /comprar café/.test(i.text)), 'nota criada');
    assert.equal(await p.evaluate(() => window.__beeps), 1, 'um bipe');
    await p.waitForTimeout(2500);

    // Só a frase: abre a escuta do comando com o nome; "cancelar" desiste
    await p.evaluate(() => window.__lastSR.say('Acorde Verônica'));
    await p.waitForTimeout(500);
    assert.equal(await p.getAttribute('#wakePill', 'data-state'), 'listening');
    assert.match(await p.textContent('#voiceHeard'), /Verônica: pode falar/);
    await p.evaluate(() => { window.__lastSR.say('cancelar'); window.__lastSR.stop(); });
    await p.waitForTimeout(400);
    assert.match(await p.textContent('#voiceHeard'), /Cancelado/);
    const before = (await x.storage(p, 'nt_brain')).length;
    await p.waitForTimeout(2500);
    assert.equal((await x.storage(p, 'nt_brain')).length, before, 'nada foi criado');

    // Só a frase e silêncio: encerra sozinho depois do tempo configurado (3 s)
    await p.evaluate(() => window.__lastSR.say('Acorde Verônica'));
    await p.waitForTimeout(500);
    assert.equal(await p.isVisible('#voice'), true);
    await p.waitForTimeout(3300);
    assert.equal(await p.isVisible('#voice'), false, 'fechou por tempo esgotado');
    await p.waitForTimeout(1200);
    assert.equal(await p.getAttribute('#wakePill', 'data-state'), 'waiting', 'voltou a aguardar a frase');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
