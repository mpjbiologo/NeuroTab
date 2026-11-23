// Modo reunião (#41): tempo sem pausas, trechos, ⭐, divisão, JSON da IA, nota e retomada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMeeting, elapsedOf, pause, resume, finish, addSegment, addMark, clock, markedSegments, transcriptText, chunkTranscript, parseSummary, meetingNote, taskText, isInterrupted, saysMark } from '../../src/lib/meeting.js';
import { mixGains, canRecognizeTrack } from '../../src/lib/audio-mix.js';

test('tempo de gravação desconta as pausas', () => {
  let m = newMeeting({ now: 0 });
  assert.equal(elapsedOf(m, 60000), 60000);
  m = pause(m, 60000);
  assert.equal(elapsedOf(m, 600000), 60000);
  m = resume(m, 600000);
  assert.equal(elapsedOf(m, 630000), 90000);
  m = finish(m, 630000);
  assert.equal(m.elapsed, 90000);
  assert.equal(m.state, 'ended');
  assert.equal(clock(90000), '01:30');
  assert.equal(clock(3723000), '1:02:03');
});

test('trechos com horário, ⭐ pelo botão e por "marca isso"', () => {
  let m = newMeeting({ now: 0 });
  m = addSegment(m, '  bom   dia ', 5000);
  m = addSegment(m, '', 6000);
  assert.equal(m.segments.length, 1);
  assert.deepEqual(m.segments[0], { t: 5000, text: 'bom dia' });
  m = addMark(m, 7000);
  m = addMark(m, 7500); // mesmo trecho: conta uma vez
  assert.equal(m.marks.length, 1);
  m = addSegment(m, 'o prazo é sexta, marca isso', 12000);
  assert.equal(m.marks.length, 2);
  assert.deepEqual([...markedSegments(m)], [0, 1]);
  assert.equal(transcriptText(m), '[00:05] ⭐ bom dia\n[00:12] ⭐ o prazo é sexta, marca isso');
  for (const s of ['marca isso', 'isso é um ponto importante', 'mark this', 'marca esto']) assert.ok(saysMark(s), s);
  assert.equal(saysMark('marcar reunião'), false);
});

test('reuniões longas são divididas sem quebrar linhas', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `[00:${String(i).padStart(2, '0')}] ${'palavra '.repeat(20)}`);
  const parts = chunkTranscript(lines.join('\n'), 2000);
  assert.ok(parts.length > 5);
  assert.ok(parts.every((p) => p.length <= 2000));
  assert.equal(parts.join('\n'), lines.join('\n'));
  assert.deepEqual(chunkTranscript(''), []);
});

test('JSON da IA: válido, com texto em volta, em inglês, quebrado e vazio', () => {
  const ok = parseSummary('Aqui está:\n```json\n{"resumo":"R","pontos":["a",""],"decisoes":[],"tarefas":[{"texto":"T","responsavel":"Ana","prazo":"sexta"},"Ligar"],"perguntas":["?"]}\n```');
  assert.equal(ok.resumo, 'R');
  assert.deepEqual(ok.pontos, ['a']);
  assert.deepEqual(ok.tarefas, [{ texto: 'T', responsavel: 'Ana', prazo: 'sexta' }, { texto: 'Ligar', responsavel: '', prazo: '' }]);
  const en = parseSummary({ summary: 'S', points: ['p'], tasks: [{ text: 'x', owner: 'Bob', due: 'Monday' }] });
  assert.deepEqual(en.tarefas[0], { texto: 'x', responsavel: 'Bob', prazo: 'Monday' });
  assert.throws(() => parseSummary('não sei'), /formato/);
  assert.throws(() => parseSummary('{"resumo": '), /formato/);
  assert.throws(() => parseSummary('{"resumo":"","pontos":[],"tarefas":[]}'), /vazio/);
  assert.equal(taskText({ texto: 'Revisar', responsavel: 'Ana', prazo: 'sexta' }), 'Revisar (Ana) — sexta');
  assert.equal(taskText({ texto: 'Revisar' }), 'Revisar');
});

test('nota da reunião, com e sem resumo', () => {
  let m = newMeeting({ now: Date.UTC(2026, 10, 23, 14, 0), source: 'tab' });
  m = addSegment(m, 'decidimos lançar sexta', m.startedAt + 61000);
  m = addMark(m, m.startedAt + 62000);
  m = finish(m, m.startedAt + 120000);
  const sem = meetingNote(m);
  assert.match(sem, /^Reunião — /);
  assert.match(sem, /Duração: 02:00 · Fonte: online/);
  assert.match(sem, /Resumo ainda não gerado/);
  assert.match(sem, /## Marcados durante a reunião\n- \[01:01\] decidimos lançar sexta/);
  const com = meetingNote({ ...m, summary: parseSummary({ resumo: 'R', tarefas: [{ texto: 'T', responsavel: 'Ana' }] }) });
  assert.match(com, /## Resumo\nR/);
  assert.match(com, /## Tarefas\n- T \(Ana\)/);
  assert.match(com, /## Transcrição\n\[01:01\] ⭐ decidimos lançar sexta/);
  assert.doesNotMatch(com, /## Decisões/);
});

test('retomada: reunião aberta há pouco tempo', () => {
  const m = newMeeting({ now: 1000 });
  assert.ok(isInterrupted({ ...m, savedAt: 5000 }, 10000));
  assert.equal(isInterrupted({ ...m, state: 'ended' }, 10000), false);
  assert.equal(isInterrupted({ ...m, savedAt: 0 }, 8 * 86400000), false);
  assert.equal(isInterrupted(null), false);
});

test('mistura de áudio e suporte do navegador', () => {
  assert.deepEqual(mixGains(1), [1]);
  const g = mixGains(2);
  assert.equal(g.length, 2);
  assert.ok(g.reduce((a, b) => a + b) <= 1.5, 'não estoura');
  assert.equal(canRecognizeTrack({ brands: [{ brand: 'Google Chrome', version: '140' }] }), true);
  assert.equal(canRecognizeTrack({ brands: [{ brand: 'Microsoft Edge', version: '134' }] }), false);
  assert.equal(canRecognizeTrack(null, 'Mozilla/5.0 Chrome/136.0.0.0 Safari/537.36'), true);
  assert.equal(canRecognizeTrack(null, 'Mozilla/5.0 Firefox/150.0'), false);
});
