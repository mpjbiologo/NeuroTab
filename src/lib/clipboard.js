// NeuroTab — Área de transferência (#51, 0.7.7): histórico do que você copia, só neste computador.
//
// Três níveis de captura, todos desligados por padrão (o widget no painel já é o consentimento do nível 1):
//   1. manual / ao colar no widget       (todos os navegadores)
//   2. ao copiar em sites (content script, com o site de origem; pede acesso aos sites)
//   3. monitoramento contínuo (Chrome/Edge: documento oculto lê a cada 1,5 s; Firefox: só com a nova aba aberta)
//
// Nada daqui sincroniza, vai para o backup ou para a IA. Só vira dado do cérebro quando a pessoa converte um item.
// O compartilhamento com outros aparelhos fica preparado em clipboard-share.js (deviceId, origem, alvos).

export const CLIP_KEY = 'nt_clipboard';
export const CLIP_CFG_KEY = 'nt_clipboard_cfg';
export const DEVICE_KEY = 'nt_device';

export const RETENTION = {
  session: { label: 'Ao fechar o navegador ou desligar o computador', ms: null },
  '1h': { label: '1 hora', ms: 3600e3 },
  '1d': { label: '1 dia', ms: 864e5 },
  '7d': { label: '7 dias', ms: 7 * 864e5 },
  '30d': { label: '30 dias', ms: 30 * 864e5 },
  never: { label: 'Nunca (só quando eu apagar)', ms: null },
};

// Sites onde nada é capturado (bancos, gerenciadores de senha e telas de login). A pessoa pode editar.
export const DEFAULT_IGNORE = [
  'bb.com.br', 'itau.com.br', 'bradesco.com.br', 'santander.com.br', 'caixa.gov.br', 'nubank.com.br', 'inter.co',
  'c6bank.com.br', 'sicoob.com.br', 'sicredi.com.br', 'btgpactual.com', 'mercadopago.com.br', 'paypal.com', 'picpay.com',
  '1password.com', 'bitwarden.com', 'lastpass.com', 'dashlane.com', 'accounts.google.com', 'login.live.com',
  'login.microsoftonline.com', 'appleid.apple.com', 'gov.br',
];

export const DEFAULT_CFG = {
  paused: false,
  sites: false, // nível 2
  monitor: false, // nível 3
  retention: 'session',
  max: 200,
  maxImages: 30,
  protect: true, // ignora o que parece senha, código ou cartão
  ignore: DEFAULT_IGNORE,
  share: { enabled: false, targets: [] }, // reservado: compartilhar com outros aparelhos (em breve)
};

export const MAX_TEXT = 100_000; // caracteres por item
export const MAX_IMAGE_SIDE = 1600; // px
export const KINDS = {
  text: { icon: '📄', label: 'Texto' },
  link: { icon: '🔗', label: 'Link' },
  email: { icon: '✉️', label: 'E-mail' },
  phone: { icon: '📞', label: 'Telefone' },
  color: { icon: '🎨', label: 'Cor' },
  code: { icon: '💻', label: 'Código' },
  image: { icon: '🖼️', label: 'Imagem' },
};

const area = () => globalThis.chrome?.storage?.local;

// ---------- Classificação ----------
export function classify(text) {
  const s = String(text || '').trim();
  if (!s) return 'text';
  if (/^(https?:\/\/|www\.)\S+$/i.test(s)) return 'link';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return 'email';
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) || /^(rgb|hsl)a?\(\s*[\d.%\s,/]+\)$/i.test(s)) return 'color';
  const digits = (s.match(/\d/g) || []).length;
  if (/^\+?[\d\s().-]{8,20}$/.test(s) && digits >= 8 && digits <= 15 && (/[\s().+-]/.test(s) || digits >= 10)) return 'phone';
  const lines = s.split('\n');
  if (lines.length >= 2 && (/[{};]\s*$/m.test(s) || (/^\s{2,}\S/m.test(s) && /[=(){}[\]<>]/.test(s)) || /^\s*(import|export|function|const|let|def|class|SELECT|<\w+)[\s(]/m.test(s))) return 'code';
  return 'text';
}

const luhn = (digits) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};

/** Parece senha, código de verificação, token ou cartão? (só texto curto e sem espaços; erra para o lado seguro) */
export function looksSensitive(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 200) return false;
  const card = s.replace(/[\s-]/g, '');
  if (/^\d{13,19}$/.test(card) && luhn(card)) return 'cartão';
  if (/\s/.test(s)) return false;
  if (/^\d{4,8}$/.test(s)) return 'código';
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(s)) return 'token';
  if (/^(sk-|sk_live_|pk_live_|rk_live_|AIza|ghp_|gho_|github_pat_|xox[abpr]-|AKIA|glpat-|ya29\.)[\w.-]{8,}$/.test(s)) return 'chave';
  if (/^(https?:|www\.)/i.test(s) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false;
  if (/^000201/.test(s)) return false; // Pix copia e cola: é para colar no banco, não é segredo
  if (s.length >= 24 && /^[A-Za-z0-9+/=_-]+$/.test(s) && /\d/.test(s) && /[a-z]/i.test(s)) return 'token';
  if (s.length >= 8 && s.length <= 64) {
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length;
    if (classes >= 3) return 'senha';
  }
  return false;
}

export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
export function ignoredSite(url, list = DEFAULT_IGNORE) {
  const host = hostOf(url);
  if (!host) return false;
  return list.some((d) => { const x = String(d).trim().toLowerCase().replace(/^\*?\.?/, ''); return x && (host === x || host.endsWith('.' + x)); });
}

// ---------- Armazenamento ----------
export async function clipConfig() {
  const r = await area().get(CLIP_CFG_KEY);
  return { ...DEFAULT_CFG, ...(r[CLIP_CFG_KEY] || {}) };
}
export async function setClipConfig(patch) {
  const cfg = { ...(await clipConfig()), ...patch };
  await area().set({ [CLIP_CFG_KEY]: cfg });
  return cfg;
}
export async function loadClips() {
  const r = await area().get(CLIP_KEY);
  return Array.isArray(r[CLIP_KEY]?.items) ? r[CLIP_KEY].items : [];
}
const saveClips = (items) => area().set({ [CLIP_KEY]: { items } });

/** Identidade deste aparelho (para o compartilhamento futuro saber de onde veio cada item). */
export async function deviceId() {
  const r = await area().get([DEVICE_KEY, 'nt_sync']);
  if (r[DEVICE_KEY]?.id) return r[DEVICE_KEY].id;
  const id = r.nt_sync?.deviceId || crypto.randomUUID();
  await area().set({ [DEVICE_KEY]: { id } });
  return id;
}

// Uma gravação de cada vez (a página, o fundo e o documento oculto podem gravar quase juntos).
const locked = (fn) => (globalThis.navigator?.locks ? navigator.locks.request('nt-clip', fn) : fn());

/** Tira o que passou do prazo e o que excede os limites. Fixados (⭐) nunca saem sozinhos. */
export function pruneList(items, cfg, now = Date.now(), { startup = false } = {}) {
  const ms = RETENTION[cfg.retention]?.ms;
  let out = items.filter((it) => it.pinned || ((!ms || now - it.updatedAt < ms) && !(startup && cfg.retention === 'session')));
  const pinned = out.filter((it) => it.pinned);
  const rest = out.filter((it) => !it.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
  let imgs = 0;
  const kept = [];
  for (const it of rest) {
    if (kept.length + pinned.length >= cfg.max) break;
    if (it.kind === 'image' && ++imgs > cfg.maxImages) continue;
    kept.push(it);
  }
  return [...pinned, ...kept].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function pruneClips({ startup = false, now = Date.now() } = {}) {
  return locked(async () => {
    const [items, cfg] = await Promise.all([loadClips(), clipConfig()]);
    const next = pruneList(items, cfg, now, { startup });
    if (next.length !== items.length) await saveClips(next);
    return next;
  });
}

/**
 * Guarda um item. Recusa (devolve { skipped }) se estiver pausado, se o site for ignorado ou se parecer senha.
 * via: 'manual' | 'paste' | 'site' | 'monitor' | 'remote' (outro aparelho, no futuro)
 */
export async function addClip({ text = '', image = null, via = 'manual', source = null, force = false, now = Date.now() }) {
  const cfg = await clipConfig();
  if (!force && cfg.paused && via !== 'manual' && via !== 'paste') return { skipped: 'paused' };
  if (source?.url && ignoredSite(source.url, cfg.ignore)) return { skipped: 'site' };
  const body = String(text || '').replace(/\r\n/g, '\n');
  if (!image && !body.trim()) return { skipped: 'empty' };
  if (!image && cfg.protect && !force) { const why = looksSensitive(body); if (why) return { skipped: 'sensitive', why }; }
  const dev = await deviceId();
  return locked(async () => {
    const items = await loadClips();
    const key = image ? 'img:' + image.sig : 'txt:' + body.trim();
    const same = items.find((it) => it.key === key);
    let item;
    if (same) {
      // o mesmo Ctrl+C chega pelo site e pelo acompanhamento quase juntos: conta uma vez só
      const echo = now - same.updatedAt < 4000 && same.via !== via;
      item = { ...same, updatedAt: now, count: (same.count || 1) + (echo ? 0 : 1), source: source || same.source, via: echo ? same.via : via };
    } else {
      item = {
        id: crypto.randomUUID(), key, kind: image ? 'image' : classify(body),
        text: image ? '' : body.slice(0, MAX_TEXT), truncated: body.length > MAX_TEXT,
        image: image ? { data: image.data, w: image.w, h: image.h, type: image.type || 'image/webp', size: image.size || 0 } : null,
        source: source && (source.url || source.title) ? { url: source.url || '', title: (source.title || '').slice(0, 200) } : null,
        via, deviceId: dev, origin: via === 'remote' ? 'remote' : 'local', pinned: false, count: 1, createdAt: now, updatedAt: now,
      };
    }
    const next = pruneList([item, ...items.filter((it) => it.id !== item.id)], cfg, now);
    await saveClips(next);
    return { item, duplicate: !!same };
  });
}

export async function updateClip(id, patch) {
  return locked(async () => {
    const items = await loadClips();
    const i = items.findIndex((it) => it.id === id);
    if (i < 0) return null;
    items[i] = { ...items[i], ...patch };
    await saveClips(items);
    return items[i];
  });
}
export async function removeClip(id) {
  return locked(async () => saveClips((await loadClips()).filter((it) => it.id !== id)));
}
export async function clearClips({ keepPinned = true } = {}) {
  return locked(async () => saveClips(keepPinned ? (await loadClips()).filter((it) => it.pinned) : []));
}

/** Pesquisa simples, sem acentos. */
export function searchClips(items, q, kind = '') {
  const fold = (x) => String(x || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const fq = fold(q.trim());
  return items.filter((it) => (!kind || it.kind === kind) && (!fq || fold(`${it.text} ${it.source?.title || ''} ${it.source?.url || ''}`).includes(fq)));
}

// ---------- Imagens ----------
/** Reduz a imagem (lado maior até 1600 px), converte para WebP e devolve { data, w, h, size, sig }. */
export async function shrinkImage(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const hgt = Math.max(1, Math.round(bmp.height * k));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, hgt) : Object.assign(document.createElement('canvas'), { width: w, height: hgt });
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  bmp.close?.();
  const out = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 }) : await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
  const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(out); });
  return { data, w, h: hgt, size: out.size, type: out.type, sig: await imageSig(blob) };
}

/** Impressão curta da imagem original (para não guardar a mesma duas vezes). */
export async function imageSig(blob) {
  const buf = await blob.slice(0, 65536).arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return `${blob.size}-` + [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function dataUrlToBlob(data) {
  const [head, b64] = data.split(',');
  const type = head.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
