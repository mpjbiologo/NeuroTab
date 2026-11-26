// NeuroTab — compartilhar a área de transferência entre aparelhos (0.7.7.2).
//
// Cada pessoa escolhe os caminhos (pode ligar vários) e as regras:
//   📷 QR code       — só na tela (o widget mostra; nada sai do computador)
//   ☁️ Minha nuvem    — arquivo nt-clipboard.json na pasta oculta do Google Drive, com a chave da sincronização
//   🔔 ntfy           — canal privado (tópico aleatório) num servidor ntfy; cifrado com uma chave que só vai no QR
//   ✈️ Telegram       — bot da própria pessoa; o conteúdo passa pelo Telegram (avisado na tela)
//   🏠 Rede local     — programa NeuroTab Ponte no computador (native messaging) serve uma página para o celular
//
// Regras: o que compartilhar (só o que eu mandar / os fixados / tudo), imagens (não / pequenas / todas),
// sentido (enviar e receber / só enviar / só receber) e o nome deste aparelho.
import { seal, open } from './sync-crypto.js';

export const SHARE_DEFAULT = {
  enabled: false,
  what: 'manual', // 'manual' | 'pinned' | 'all'
  images: 'small', // 'no' | 'small' | 'all'
  direction: 'both', // 'both' | 'send' | 'receive'
  name: '',
  cloud: { on: false },
  ntfy: { on: false, server: 'https://ntfy.sh', topic: '', key: '', plain: false },
  telegram: { on: false, token: '', chatId: '', bot: '' },
  lan: { on: false, port: 41414, token: '', mirror: true }, // mirror: o celular vê a área de transferência (0.9.2.4)
};
export const SMALL_IMAGE = 300 * 1024; // bytes
export const CLOUD_FILE = 'nt-clipboard.json';
export const CLOUD_KEEP = 50; // itens no arquivo da nuvem
export const TRANSPORTS = ['cloud', 'ntfy', 'telegram', 'lan'];
export const SHARE_STATE_KEY = 'nt_clipshare_state'; // posição da leitura de cada caminho (só neste aparelho)
export const NATIVE_HOST = 'com.neurotab.ponte';

/** Configuração completa (com os padrões de cada caminho). */
export function shareConfig(cfg) {
  const s = cfg?.share || {};
  const out = { ...SHARE_DEFAULT, ...s };
  for (const t of TRANSPORTS) out[t] = { ...SHARE_DEFAULT[t], ...(s[t] || {}) };
  return out;
}
export const anyTransport = (share) => TRANSPORTS.some((t) => share[t]?.on);

/** Este item deve sair agora? (nunca devolve o que veio de outro aparelho) */
export function shouldShare(item, share) {
  if (!share.enabled || share.direction === 'receive' || !anyTransport(share)) return false;
  if (!item || item.origin === 'remote' || item.sharedAt) return false;
  if (item.kind === 'image') {
    if (share.images === 'no') return false;
    if (share.images === 'small' && (item.image?.size || 0) > SMALL_IMAGE) return false;
  }
  if (item.shareRequested) return true;
  if (share.what === 'all') return true;
  if (share.what === 'pinned') return !!item.pinned;
  return false;
}

/**
 * Rede local (0.9.2.4): o celular vê a área de transferência deste computador, não só o que foi
 * marcado para compartilhar. Devolve os itens mais recentes (do mais antigo para o mais novo),
 * sem os que vieram de outros aparelhos e respeitando a regra de imagens e o "só receber".
 */
export const LAN_MIRROR = 30;
export function lanMirrorItems(clips, share, limit = LAN_MIRROR) {
  if (!share.enabled || !share.lan.on || share.lan.mirror === false || share.direction === 'receive') return [];
  const ok = (it) => {
    if (!it || it.origin === 'remote') return false;
    if (it.kind === 'image') {
      if (!it.image?.data || share.images === 'no') return false;
      if (share.images === 'small' && (it.image.size || 0) > SMALL_IMAGE) return false;
      return true;
    }
    return typeof it.text === 'string' && it.text.trim() !== '';
  };
  return [...clips].filter(ok).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit).reverse();
}
export const canReceive = (share) => share.enabled && share.direction !== 'send' && anyTransport(share);

/** Item → formato que viaja entre aparelhos. */
export function toPayload(item, me) {
  return {
    v: 1, id: item.id, at: item.updatedAt || Date.now(), from: { id: me.id, name: me.name || 'Computador' },
    kind: item.kind, text: item.kind === 'image' ? '' : item.text,
    image: item.kind === 'image' ? { data: item.image.data, w: item.image.w, h: item.image.h, type: item.image.type } : null,
  };
}
/** Valida um payload recebido (nunca confia no formato). */
export function cleanPayload(p) {
  if (!p || typeof p !== 'object') return null;
  const text = typeof p.text === 'string' ? p.text.slice(0, 100_000) : '';
  const img = p.image && typeof p.image.data === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(p.image.data) && p.image.data.length < 8_000_000
    ? { data: p.image.data, w: +p.image.w || 0, h: +p.image.h || 0, type: String(p.image.type || 'image/webp'), size: Math.round(p.image.data.length * 0.75), sig: 'r-' + String(p.id || p.image.data.length) }
    : null;
  if (!text.trim() && !img) return null;
  return { id: String(p.id || crypto.randomUUID()).slice(0, 80), at: +p.at || Date.now(), from: { id: String(p.from?.id || '').slice(0, 80), name: String(p.from?.name || '').slice(0, 60) }, text, image: img };
}

// ---------- Chave do ntfy (vai só no link/QR de pareamento, nunca para o servidor) ----------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const newShareKey = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const newTopic = () => 'nt-' + b64url(crypto.getRandomValues(new Uint8Array(18)));
export const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(24)));
/** chave base64url → base64 (formato do sync-crypto) */
export const keyB64 = (k) => { const s = k.replace(/-/g, '+').replace(/_/g, '/'); return s + '='.repeat((4 - (s.length % 4)) % 4); };

export async function sealNtfy(payload, key) { return 'NT1:' + btoa(unescape(encodeURIComponent(JSON.stringify(await seal(payload, keyB64(key)))))); }
export async function openNtfy(message, key) {
  if (!message.startsWith('NT1:')) return null;
  const env = JSON.parse(decodeURIComponent(escape(atob(message.slice(4)))));
  return open(env, keyB64(key));
}

/** Link (e QR) que o celular abre para entrar no canal do ntfy. A chave vai no "#", que não sai do celular. */
export function ntfyPairLink(share, base = 'https://mpjbiologo.github.io/NeuroTab/cola/') {
  const q = new URLSearchParams({ s: share.ntfy.server, t: share.ntfy.topic, k: share.ntfy.key, n: share.name || '' });
  return `${base}#ntfy&${q}`;
}

// ---------- Registro de alvos extras (para quem quiser acrescentar caminhos sem mexer no widget) ----------
const targets = new Map();
export function registerShareTarget(t) {
  if (!t?.id || typeof t.send !== 'function') throw new Error('alvo inválido');
  targets.set(t.id, t);
  return () => targets.delete(t.id);
}
export const shareTargets = () => [...targets.values()];

/** Envia um item para os alvos extras ligados. Nunca envia o que veio de outro aparelho de volta. */
export async function shareItem(item, cfg) {
  if (!cfg?.share?.enabled || item.origin === 'remote') return [];
  const on = new Set(cfg.share.targets || []);
  const out = [];
  for (const t of shareTargets()) if (on.has(t.id)) out.push(await t.send(item).then(() => t.id, () => null));
  return out.filter(Boolean);
}

/**
 * Endereços da Ponte para o celular (0.9.2.2), o melhor primeiro. A Ponte nova manda `addrs` já
 * ordenados (Wi-Fi/Ethernet antes de VPN e adaptadores virtuais); a antiga só `urls`, então
 * ordenamos pelo IP: 192.168.x, depois 10.x, por último 172.16–31 (Docker, WSL, Cloudflare WARP…).
 * Devolve [{ url, ip, iface, virtual, publicNet, best }] com o token no `#`.
 */
export function lanTargets(st = {}, token = '') {
  const withTok = (u) => `${String(u).replace(/\/+$/, '')}/#t=${encodeURIComponent(token)}`;
  const ipOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
  let list = Array.isArray(st.addrs) && st.addrs.length
    ? st.addrs.filter((a) => a && a.url).map((a) => ({ url: a.url, ip: a.ip || ipOf(a.url), iface: a.iface || '', virtual: !!a.virtual, publicNet: !!a.publicNet }))
    : (st.urls || []).map((u) => ({ url: u, ip: ipOf(u), iface: '', virtual: /^172\.(1[6-9]|2\d|3[01])\./.test(ipOf(u)), publicNet: false }));
  if (!(Array.isArray(st.addrs) && st.addrs.length)) {
    const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
    list = list.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x.ip) - rank(b.x.ip) || a.i - b.i).map((o) => o.x);
  }
  return list.map((a, i) => ({ ...a, url: withTok(a.url), best: i === 0 }));
}
