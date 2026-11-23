// NeuroTab — conversas diretas com o Ollama do computador (0.8.1): estado, baixar modelo com progresso e teste de velocidade.
// Endereço padrão: http://localhost:11434 (a extensão pede a permissão do endereço no clique).

export const OLLAMA_DEFAULT = 'http://localhost:11434';
export const ollamaRoot = (base = OLLAMA_DEFAULT) => String(base || OLLAMA_DEFAULT).replace(/\/+$/, '').replace(/\/v1$/, '');

async function get(root, path, { timeout = 4000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(root + path, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`O Ollama respondeu ${r.status}.`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** { ok, version, models: [{ name, sizeGB }], running: [{ name, gpuPct }] } ou { ok: false, error }. */
export async function ollamaStatus(base) {
  const root = ollamaRoot(base);
  try {
    const v = await get(root, '/api/version');
    const [tags, ps] = await Promise.all([get(root, '/api/tags').catch(() => ({})), get(root, '/api/ps').catch(() => ({}))]);
    return {
      ok: true,
      root,
      version: v?.version || '',
      models: (tags.models || []).map((m) => ({ name: m.name || m.model, sizeGB: Math.round(((m.size || 0) / 1024 ** 3) * 10) / 10 })),
      running: (ps.models || []).map(gpuShare),
    };
  } catch (e) {
    return { ok: false, root, error: e.name === 'AbortError' || /fetch/i.test(e.message) ? 'O Ollama não respondeu neste endereço. Ele está aberto?' : e.message };
  }
}

/** Quanto do modelo carregado está na placa de vídeo (de /api/ps). */
export function gpuShare(m) {
  const size = Number(m?.size) || 0;
  const vram = Number(m?.size_vram) || 0;
  return { name: m?.name || m?.model || '', gpuPct: size ? Math.round((vram / size) * 100) : 0 };
}

/** Lê um corpo NDJSON (uma linha JSON por evento), chamando onLine para cada objeto. */
export async function readNdjson(body, onLine) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { onLine(JSON.parse(line)); } catch { /* linha incompleta */ } }
    }
    if (done) break;
  }
  if (buf.trim()) { try { onLine(JSON.parse(buf)); } catch { /* fim */ } }
}

/** Progresso de uma linha do /api/pull: { status, pct }. */
export function pullProgress(o) {
  const pct = o?.total ? Math.min(100, Math.round(((o.completed || 0) / o.total) * 1000) / 10) : null;
  return { status: String(o?.status || ''), pct, error: o?.error ? String(o.error) : '' };
}

/** Baixa um modelo pelo Ollama (o mesmo que "ollama pull"). onProgress({ status, pct }). Cancelável por signal. */
export async function pullModel(base, model, { onProgress, signal } = {}) {
  const r = await fetch(ollamaRoot(base) + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal });
  if (!r.ok || !r.body) throw new Error(`O Ollama não começou o download (${r.status}).`);
  let last = null;
  await readNdjson(r.body, (o) => {
    last = pullProgress(o);
    if (last.error) throw new Error(last.error);
    onProgress?.(last);
  });
  if (last?.status !== 'success') throw new Error('O download não terminou.');
}

/**
 * Teste prático: gera uma resposta curta e mede a velocidade real.
 * { tokensPerSec, wordsPerSec, seconds, gpuPct, text }
 */
export async function benchmark(base, model, { prompt = 'Explique em três frases curtas o que é fotossíntese.' } = {}) {
  const root = ollamaRoot(base);
  const r = await fetch(root + '/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, think: false, keep_alive: '5m', options: { num_predict: 96 } }),
  });
  if (!r.ok) throw new Error(`O Ollama respondeu ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  const secs = (Number(j.eval_duration) || 0) / 1e9;
  const tps = secs > 0 ? (Number(j.eval_count) || 0) / secs : 0;
  const ps = await get(root, '/api/ps').catch(() => ({}));
  const run = (ps.models || []).map(gpuShare).find((m) => m.name === model || m.name.replace(/:latest$/, '') === model);
  return { tokensPerSec: Math.round(tps * 10) / 10, wordsPerSec: Math.round(tps * 0.7), seconds: Math.round(((Number(j.total_duration) || 0) / 1e9) * 10) / 10, gpuPct: run?.gpuPct ?? null, text: String(j.response || '').trim() };
}

/** Veredito do teste prático, em palavras. */
export function speedVerdict(tps) {
  if (tps >= 25) return { icon: '🟢', text: 'ótimo para conversa' };
  if (tps >= 10) return { icon: '🟡', text: 'bom; respostas longas demoram um pouco' };
  if (tps >= 4) return { icon: '🟠', text: 'lento; prefira um modelo menor para conversar' };
  return { icon: '🔴', text: 'muito lento para uso diário neste computador' };
}
