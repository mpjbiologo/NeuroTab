// NeuroTab — Modo reunião (0.8.3, #41): transcrição com horários, marcações, resumo pela IA e a nota. Puro.

export const MEETING_LIMIT_CHARS = 12000; // por parte enviada à IA (reuniões longas vão em partes)

export function newMeeting({ source = 'mic', keepAudio = false, lang = 'pt-BR', now = Date.now() } = {}) {
  return {
    id: 'm' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    startedAt: now, endedAt: null, source, keepAudio, lang,
    state: 'recording', elapsed: 0, resumedAt: now,
    segments: [], marks: [], summary: null, noteId: null, audioBytes: 0, audioChunks: 0,
  };
}

/** Tempo de gravação (sem as pausas). */
export const elapsedOf = (m, now = Date.now()) => (m.elapsed || 0) + (m.state === 'recording' && m.resumedAt != null ? now - m.resumedAt : 0);

export function pause(m, now = Date.now()) {
  if (m.state !== 'recording') return m;
  return { ...m, state: 'paused', elapsed: elapsedOf(m, now), resumedAt: null };
}
export function resume(m, now = Date.now()) {
  if (m.state !== 'paused') return m;
  return { ...m, state: 'recording', resumedAt: now };
}
export function finish(m, now = Date.now()) {
  return { ...m, state: 'ended', elapsed: elapsedOf(m, now), resumedAt: null, endedAt: now };
}

const MARK_WORDS = /\b(marca isso|marque isso|marcar isso|marcar ponto|marca esse ponto|ponto importante|mark this|mark that|important point|marca esto|marcar esto|punto importante)\b/i;
/** "marca isso" no meio da fala vira uma marcação. */
export const saysMark = (text) => MARK_WORDS.test(String(text || '').normalize('NFC'));

/** Acrescenta um trecho final (com o tempo da gravação). Texto vazio é ignorado. */
export function addSegment(m, text, now = Date.now()) {
  const tx = String(text || '').replace(/\s+/g, ' ').trim();
  if (!tx) return m;
  const t = elapsedOf(m, now);
  let out = { ...m, segments: [...m.segments, { t, text: tx }] };
  if (saysMark(tx)) out = addMark(out, now, tx, out.segments.length - 1);
  return out;
}

/** ⭐ marca o momento e o trecho (o mais recente, se não for dito qual). O mesmo trecho conta uma vez. */
export function addMark(m, now = Date.now(), note = '', seg = m.segments.length - 1) {
  const t = elapsedOf(m, now);
  if (seg >= 0 && m.marks.some((k) => k.seg === seg)) return m;
  return { ...m, marks: [...m.marks, { t, seg, note: String(note || '').slice(0, 200) }] };
}

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Trechos marcados: o mais próximo de cada marcação (até 20 s antes). */
export function markedSegments(m) {
  const out = new Set();
  for (const k of m.marks) {
    if (Number.isInteger(k.seg) && k.seg >= 0 && k.seg < m.segments.length) { out.add(k.seg); continue; }
    let best = -1;
    m.segments.forEach((s, i) => { if (s.t <= k.t + 1000 && s.t >= k.t - 20000) best = i; });
    if (best < 0 && m.segments.length) best = m.segments.findLastIndex?.((s) => s.t <= k.t) ?? -1;
    if (best >= 0) out.add(best);
  }
  return out;
}

/** "[00:12] texto", com ⭐ nos trechos marcados. */
export function transcriptText(m) {
  const marked = markedSegments(m);
  return m.segments.map((s, i) => `[${clock(s.t)}]${marked.has(i) ? ' ⭐' : ''} ${s.text}`).join('\n');
}

/** Divide a transcrição em partes de até `max` letras, sem quebrar linhas. */
export function chunkTranscript(text, max = MEETING_LIMIT_CHARS) {
  const parts = [];
  let cur = '';
  for (const line of String(text || '').split('\n')) {
    const l = line.length > max ? line.slice(0, max) : line;
    if (cur && cur.length + l.length + 1 > max) { parts.push(cur); cur = ''; }
    cur = cur ? cur + '\n' + l : l;
  }
  if (cur) parts.push(cur);
  return parts;
}

const FORMAT = `Responda só com JSON, neste formato:
{"resumo": "2 a 4 parágrafos curtos", "pontos": ["..."], "decisoes": ["..."], "tarefas": [{"texto": "...", "responsavel": "nome ou vazio", "prazo": "como foi dito ou vazio"}], "perguntas": ["perguntas que ficaram em aberto"]}`;

export function summaryPrompt(lang = 'pt-BR') {
  return `Você é o secretário de uma reunião. A transcrição foi feita por reconhecimento de voz e pode ter erros; não invente nada que não foi dito.
Linhas com ⭐ foram marcadas como importantes: elas têm de aparecer nos pontos importantes.
Responda no idioma ${lang}. Listas vazias quando não houver nada. Tarefas só com o que alguém se comprometeu a fazer; responsável e prazo só se foram ditos.
${FORMAT}`;
}

/** Para reuniões longas: cada parte vira notas curtas; depois o resumo final usa as notas. */
export function partPrompt(lang = 'pt-BR', i = 1, n = 1) {
  return `Você está resumindo a parte ${i} de ${n} da transcrição de uma reunião (reconhecimento de voz, pode ter erros).
Escreva em ${lang}, em tópicos curtos: o que foi discutido, decisões, tarefas (com responsável e prazo se ditos), perguntas em aberto e tudo que estiver nas linhas com ⭐ (marque com ⭐). Não invente nada.`;
}

const str = (v, n = 600) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const list = (v, n = 30) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, n) : []);

/** Confere a resposta da IA. Lança erro se não der para usar. */
export function parseSummary(raw) {
  let o = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('A IA não devolveu o resumo no formato esperado.');
    try { o = JSON.parse(m[0]); } catch { throw new Error('A IA não devolveu o resumo no formato esperado.'); }
  }
  if (!o || typeof o !== 'object') throw new Error('A IA não devolveu o resumo no formato esperado.');
  const resumo = str(o.resumo || o.summary, 4000);
  const out = {
    resumo,
    pontos: list(o.pontos || o.points),
    decisoes: list(o.decisoes || o.decisions),
    tarefas: (Array.isArray(o.tarefas || o.tasks) ? o.tarefas || o.tasks : []).map((x) => (typeof x === 'string' ? { texto: str(x, 300), responsavel: '', prazo: '' } : { texto: str(x?.texto || x?.text, 300), responsavel: str(x?.responsavel || x?.owner, 80), prazo: str(x?.prazo || x?.due, 80) })).filter((x) => x.texto).slice(0, 40),
    perguntas: list(o.perguntas || o.questions),
  };
  if (!out.resumo && !out.pontos.length && !out.tarefas.length) throw new Error('A IA devolveu um resumo vazio.');
  return out;
}

/** Texto da tarefa criada a partir da ata. */
export const taskText = (x) => [x.texto, x.responsavel && `(${x.responsavel})`, x.prazo && `— ${x.prazo}`].filter(Boolean).join(' ');

/** Nota "Reunião — data e hora" (Markdown). L: rótulos traduzidos. */
export function meetingNote(m, L = {}) {
  const lb = { title: 'Reunião', duration: 'Duração', source: 'Fonte', mic: 'presencial (microfone)', tab: 'online (microfone + áudio da aba)', summary: 'Resumo', points: 'Pontos importantes', decisions: 'Decisões', tasks: 'Tarefas', questions: 'Perguntas em aberto', transcript: 'Transcrição', marked: 'Marcados durante a reunião', noSummary: 'Resumo ainda não gerado (configure a IA e use "Gerar resumo" na página da reunião).', locale: 'pt-BR', ...L };
  const d = new Date(m.startedAt);
  const head = `${lb.title} — ${d.toLocaleDateString(lb.locale)} ${d.toLocaleTimeString(lb.locale, { hour: '2-digit', minute: '2-digit' })}`;
  const out = [head, '', `${lb.duration}: ${clock(m.elapsed || 0)} · ${lb.source}: ${m.source === 'tab' ? lb.tab : lb.mic}`];
  const s = m.summary;
  const sec = (title, items) => { if (items?.length) out.push('', `## ${title}`, ...items.map((x) => `- ${x}`)); };
  if (s) {
    out.push('', `## ${lb.summary}`, s.resumo);
    sec(lb.points, s.pontos);
    sec(lb.decisions, s.decisoes);
    sec(lb.tasks, s.tarefas.map(taskText));
    sec(lb.questions, s.perguntas);
  } else {
    out.push('', lb.noSummary);
    const marked = markedSegments(m);
    sec(lb.marked, [...marked].map((i) => `[${clock(m.segments[i].t)}] ${m.segments[i].text}`));
  }
  out.push('', `## ${lb.transcript}`, transcriptText(m) || '—');
  return out.join('\n');
}

/** Reunião que ficou aberta (aba fechada, navegador caiu): dá para retomar ou finalizar. */
export const isInterrupted = (m, now = Date.now()) => !!m && (m.state === 'recording' || m.state === 'paused') && now - (m.savedAt || m.startedAt) < 7 * 86400000;
