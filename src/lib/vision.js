// NeuroTab — leitura de imagens.
//  • Texto da imagem: lido no próprio computador (Tesseract, em src/vendor/tesseract). Nada é enviado;
//    só o pacote do idioma (≈1,4–3 MB) é baixado uma vez, no primeiro uso, e fica guardado no navegador.
//  • Descrição e perguntas: pela IA que a pessoa configurou. Ollama (ou outro servidor no computador)
//    roda sem perguntar; um serviço na internet só recebe a imagem depois de a pessoa autorizar.
import { complete, parseJson, isConfigured, isLocalAI, aiConfig } from './ai.js';
import { LANG, aiLanguageName } from './i18n.js';
import { findAddress } from './address.js';

const VENDOR = '/src/vendor/tesseract/';
const DATA_VERSION = '1.0.0';
/** Pacotes de idioma do leitor de texto (versão fixa, formato compacto "best_int"). */
export const OCR_DATA = (code) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}@${DATA_VERSION}/4.0.0_best_int`;
export const OCR_LANGS = { pt: 'por', en: 'eng', es: 'spa' };
export const ocrLangFor = (lang = LANG) => OCR_LANGS[String(lang || 'pt').slice(0, 2)] || 'por';
const url = (p) => (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(p.replace(/^\//, '')) : p);

// ---------- Imagem → formato que os leitores aceitam ----------
async function decode(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    // SVG e alguns formatos só abrem por <img>.
    if (typeof Image === 'undefined') throw new Error('Formato de imagem não suportado.');
    const src = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      return img;
    } catch {
      throw new Error('Formato de imagem não suportado.');
    } finally {
      URL.revokeObjectURL(src);
    }
  }
}

/** Redesenha a imagem (no máximo `max` px no lado maior) como JPEG ou PNG. */
export async function normalizeImage(blob, { max = 1600, type = 'image/jpeg', quality = 0.88 } = {}) {
  const bmp = await decode(blob);
  const w0 = bmp.width || bmp.naturalWidth;
  const h0 = bmp.height || bmp.naturalHeight;
  if (!w0 || !h0) throw new Error('Imagem vazia.');
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // transparência vira branco (melhor para ler texto)
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = canvas.convertToBlob ? await canvas.convertToBlob({ type, quality }) : await new Promise((r) => canvas.toBlob(r, type, quality));
  return { blob: out, width: w, height: h };
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- Texto da imagem, no computador ----------
let worker = null;
let workerLang = '';
let starting = null;

async function getWorker(lang, onProgress) {
  if (worker && workerLang === lang) return worker;
  if (starting) await starting.catch(() => {});
  if (worker && workerLang === lang) return worker;
  starting = (async () => {
    await closeReader();
    const { default: Tesseract } = await import('../vendor/tesseract/tesseract.esm.min.js');
    let timer;
    const tooLong = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('o leitor demorou demais para abrir')), 90e3); });
    worker = await Promise.race([tooLong, Tesseract.createWorker(lang, 1 /* LSTM */, {
      workerPath: url(VENDOR + 'worker.min.js'),
      corePath: url(VENDOR + 'tesseract-core-simd-lstm.js'),
      langPath: OCR_DATA(lang),
      workerBlobURL: false, // extensões não aceitam worker de blob
      gzip: true,
      logger: (m) => onProgress?.(m),
      errorHandler: (e) => console.warn('NeuroTab: leitor de texto', e),
    })]).finally(() => clearTimeout(timer));
    workerLang = lang;
    return worker;
  })();
  try {
    return await starting;
  } catch (e) {
    worker = null;
    workerLang = '';
    throw new Error(/fetch|network|traineddata|Failed to load/i.test(String(e?.message || e))
      ? 'Não consegui baixar o pacote do idioma para ler o texto. Verifique a internet e tente de novo.'
      : 'O leitor de texto não abriu neste navegador: ' + (e?.message || e));
  } finally {
    starting = null;
  }
}

/** Fecha o leitor (libera memória). */
export async function closeReader() {
  const w = worker;
  worker = null;
  workerLang = '';
  await w?.terminate().catch(() => {});
}

/** Junta linhas quebradas e tira lixo típico de leitura de imagem. */
export function cleanOcr(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l && /[\p{L}\p{N}]{2,}/u.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lê o texto de uma imagem no próprio computador. Devolve { text, confidence }. */
export async function readText(blob, { lang = ocrLangFor(), onProgress } = {}) {
  const { blob: img } = await normalizeImage(blob, { max: 2400, type: 'image/png' });
  const w = await getWorker(lang, onProgress);
  const { data } = await w.recognize(img);
  const text = cleanOcr(data?.text);
  return { text, confidence: Math.round(data?.confidence || 0) };
}

// ---------- Descrição e perguntas, pela IA configurada ----------
/** A IA configurada aceita imagem? (Para modelos locais, depende do modelo: llava, gemma3, qwen2.5vl…) */
export function visionAvailable(settings) {
  return isConfigured(settings);
}

/** Enviar a imagem precisa de autorização? (IA na internet e a pessoa ainda não liberou.) */
export function visionNeedsConsent(settings) {
  return !isLocalAI(settings) && !settings?.ai?.imagesAllowed;
}

/** Nome do serviço que vai receber a imagem (para a confirmação). */
export const visionTarget = (settings) => aiConfig(settings).p.name;

// ---------- Ollama: só modelos com visão enxergam a imagem ----------
// Um modelo só de texto (ex.: llama3.2, o padrão) recebe a imagem e a ignora sem avisar: a "descrição"
// sairia só do texto lido. Por isso conferimos antes e, se precisar, usamos outro modelo instalado que enxergue.
const VISION_NAME = /llava|bakllava|vision|gemma3|qwen2(\.5)?-?vl|qwen3-?vl|minicpm-v|moondream|granite3\.2-vision|mistral-small3\.[12]|llama4|pixtral/i;
export const VISION_SUGGEST = 'gemma3';

async function ollamaJson(root, path, body) {
  const res = await fetch(root + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** O modelo do Ollama enxerga imagens? (Ollama novo informa "capabilities"; nos antigos, olha a família e o nome.) */
export async function ollamaSees(root, model) {
  try {
    const info = await ollamaJson(root, '/api/show', { model, name: model });
    if (Array.isArray(info?.capabilities)) return info.capabilities.includes('vision');
    const fam = [...(info?.details?.families || []), info?.details?.family].join(' ');
    if (/clip|mllama|vision/i.test(fam) || Object.keys(info?.model_info || {}).some((k) => /vision/.test(k)) || info?.projector_info) return true;
  } catch { /* sem /api/show: decide pelo nome */ }
  return VISION_NAME.test(model);
}

/** Qual modelo usar para imagens no Ollama: o escolhido para imagens, o de texto (se enxergar) ou outro instalado com visão. */
export async function ollamaVisionModel(settings) {
  const c = aiConfig(settings);
  const root = c.base.replace(/\/v1$/, '');
  const chosen = (settings.ai?.visionModel || '').trim();
  if (chosen) return chosen;
  if (await ollamaSees(root, c.model)) return c.model;
  let names = [];
  try { names = ((await ollamaJson(root, '/api/tags'))?.models || []).map((m) => m.name || m.model).filter(Boolean); } catch { /* lista indisponível */ }
  const ranked = [...names.filter((n) => VISION_NAME.test(n)), ...names.filter((n) => !VISION_NAME.test(n))].slice(0, 12);
  for (const n of ranked) if (n !== c.model && await ollamaSees(root, n)) return n;
  const err = new Error(`O modelo ${c.model} só entende texto e não enxerga imagens. Instale um modelo com visão no Ollama (por exemplo: ollama pull ${VISION_SUGGEST}) e tente de novo.`);
  err.code = 'no-vision-model';
  throw err;
}

/**
 * Descreve a imagem e, se houver, responde a uma pergunta sobre ela.
 * Devolve { title, description, text, tags, address, answer }.
 */
export async function describeImage(settings, blob, { question = '', ocrText = '', pageTitle = '' } = {}) {
  if (!visionAvailable(settings)) throw new Error('Configure a IA em Configurações → IA para descrever imagens.');
  const c = aiConfig(settings);
  const model = c.id === 'ollama' ? await ollamaVisionModel(settings) : (settings.ai?.visionModel || '').trim() || '';
  const { blob: img } = await normalizeImage(blob, { max: 1600 });
  const data = await toBase64(img);
  const system = `Você analisa imagens salvas no "segundo cérebro" de uma pessoa. Responda SOMENTE com JSON válido, com os textos em ${aiLanguageName()}.
Formato: {"titulo": "até 8 palavras", "descricao": "2 a 4 frases sobre o que aparece e o que importa", "texto": "todo o texto legível na imagem, como está escrito (vazio se não houver)", "tags": ["até 4, minúsculas, sem #"], "endereco": "endereço completo se a imagem mostrar um, senão vazio"${question ? ', "resposta": "resposta direta à pergunta"' : ''}}`;
  const content = [
    { type: 'image', mime: img.type || 'image/jpeg', data },
    { type: 'text', text: [pageTitle && `Página de origem: ${pageTitle}`, ocrText && `Texto já lido no computador (pode ter erros):\n${ocrText.slice(0, 3000)}`, question ? `Pergunta: ${question}` : 'Descreva a imagem.'].filter(Boolean).join('\n\n') },
  ];
  let raw;
  try {
    // Folga de tokens: modelos que "pensam" (Gemini, GPT-5) gastam parte do limite antes de responder.
    raw = await complete(settings, { system, messages: [{ role: 'user', content }], json: true, maxTokens: 4000, model });
  } catch (e) {
    if (/image|vision|multimodal|modalit|does not support/i.test(e?.message || '')) throw new Error('O modelo de IA escolhido não aceita imagens. Escolha um modelo com visão (ex.: gemma3, llava ou qwen2.5vl no Ollama).');
    throw e;
  }
  let out;
  try { out = parseJson(raw); } catch { out = null; }
  if (!out || typeof out !== 'object') throw new Error('A IA não devolveu a descrição no formato esperado. Tente de novo ou escolha outro modelo.');
  if (!out.descricao && !out.texto && !out.resposta) throw new Error('A IA respondeu sem descrever a imagem. Confira se o modelo escolhido aceita imagens.');
  const str = (v, n) => String(v || '').trim().slice(0, n);
  return {
    model: model || c.model,
    title: str(out.titulo, 90),
    description: str(out.descricao, 1500),
    text: str(out.texto, 6000),
    tags: Array.isArray(out.tags) ? out.tags.map((t) => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean).slice(0, 4) : [],
    address: str(out.endereco, 200),
    answer: str(out.resposta, 3000),
  };
}

export { findAddress } from './address.js';
