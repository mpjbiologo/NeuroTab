// Modo conversa (#44): histórico, resumo do começo, "anota isso" e troca de modo por voz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newHistory, addTurn, historyMessages, conversationNote, isSaveThat, modeRequest } from '../../src/lib/chat-history.js';

test('histórico: últimas trocas inteiras e resumo curto do começo', () => {
  let h = newHistory();
  for (let i = 1; i <= 9; i++) h = addTurn(h, `pergunta ${i}`, `**resposta** ${i}`, { keep: 6 });
  assert.equal(h.turns.length, 6);
  assert.equal(h.turns[0].user, 'pergunta 4');
  assert.equal(h.turns[0].assistant, 'resposta 4', 'sem Markdown');
  assert.match(h.summary, /pergunta 1 → resposta 1/);
  assert.match(h.summary, /pergunta 3 → resposta 3/);
  assert.equal(h.all.length, 9, 'guarda tudo para a nota');
  const m = historyMessages(h);
  assert.equal(m.length, 2 + 12);
  assert.equal(m[0].role, 'user');
  assert.match(m[0].content, /Resumo do começo/);
  assert.deepEqual(m.at(-1), { role: 'assistant', content: 'resposta 9' });
  assert.deepEqual(historyMessages(newHistory()), []);
});

test('histórico: textos longos são cortados e o resumo não cresce sem fim', () => {
  let h = newHistory();
  for (let i = 0; i < 80; i++) h = addTurn(h, 'x'.repeat(2000), 'y'.repeat(3000), { keep: 2, maxSummary: 600 });
  assert.ok(h.turns.every((t) => t.user.length <= 800 && t.assistant.length <= 1200));
  assert.ok(h.summary.length <= 600, h.summary.length);
});

test('nota da conversa em Markdown', () => {
  let h = { ...newHistory(), startedAt: Date.UTC(2026, 10, 23, 15, 0) };
  h = addTurn(h, 'quanto é 2+2', '4');
  const n = conversationNote(h, { you: 'Você', assistant: 'Lia' });
  assert.match(n, /^Conversa por voz — /);
  assert.match(n, /\*\*Você:\*\* quanto é 2\+2/);
  assert.match(n, /\*\*Lia:\*\* 4/);
});

test('"anota isso" e troca de modo por voz', () => {
  for (const s of ['anota isso', 'Anote isso!', 'salva essa resposta', 'guarda isso nas notas', 'save that', 'apunta esto']) assert.ok(isSaveThat(s), s);
  for (const s of ['anotar comprar café', 'anota isso e aquilo amanhã', '']) assert.equal(isSaveThat(s), false, s);
  for (const s of ['modo conversa', 'ligar o modo conversa', 'conversation mode', 'modo conversación']) assert.equal(modeRequest(s), 'chat', s);
  for (const s of ['iniciar reunião', 'modo reunião', 'começar a reunião', 'start meeting', 'meeting mode', 'iniciar reunión']) assert.equal(modeRequest(s), 'meeting', s);
  for (const s of ['marcar reunião amanhã às 9h', 'o que decidimos na reunião', 'conversa com a Ana']) assert.equal(modeRequest(s), null, s);
});
