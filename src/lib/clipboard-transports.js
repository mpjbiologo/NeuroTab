// NeuroTab — caminhos do compartilhamento da área de transferência (0.7.7.2).
// Cada caminho tem send(payload) e poll(state) → { items, state }. A rede local (Ponte) fica no background.js,
// porque é uma conexão aberta (native messaging), não uma consulta.
import { driveStore, syncConfig, SYNC_SECRET_KEY } from './sync.js';
import { seal, open } from './sync-crypto.js';
import { CLOUD_FILE, CLOUD_KEEP, cleanPayload, sealNtfy, openNtfy, keyB64 } from './clipboard-share.js';
import { sealBytes, openBytes } from './bytes-crypto.js';
import { cleanMediaPayload, CLOUD_MEDIA_PREFIX } from './media-share.js';
import { dataUrlToBlob } from './clipboard.js';

const RECENT = 10 * 60e3; // na primeira leitura de um caminho, só entram os itens dos últimos 10 min

// ---------- ☁️ Minha nuvem (Google Drive, pasta oculta, chave da sincronização) ----------
export async function cloudReady() {
  const c = await syncConfig();
  if (!c.enabled || !c.accountId) throw Object.assign(new Error('Ligue a sincronização em Configurações → Contas para usar a nuvem.'), { code: 'no_sync' });
  const key = (await chrome.storage.local.get(SYNC_SECRET_KEY))[SYNC_SECRET_KEY] || '';
  if (c.mode === 'key' && !key) throw Object.assign(new Error('Falta a senha de sincronização neste aparelho. Ligue a sincronização de novo.'), { code: 'no_key' });
  return { accountId: c.accountId, key };
}

export function cloudTransport({ accountId, key, fetchFn }) {
  const drive = driveStore(accountId, { fetchFn });
  const find = async () => (await drive.list()).find((f) => f.name === CLOUD_FILE) || null;
  const readAll = async (f) => {
    if (!f) return [];
    const env = await drive.read(f.id);
    if (!env) return [];
    const data = await open(env, key);
    return Array.isArray(data?.items) ? data.items : [];
  };
  return {
    /** Mídias (0.9.3.2): um arquivo por mídia na pasta oculta, cifrado com a chave da sincronização. */
    async putFile(bytes) {
      const f = await drive.createBytes(CLOUD_MEDIA_PREFIX + crypto.randomUUID(), await sealBytes(bytes, key));
      return { drive: f.id, enc: !!key };
    },
    async getFile(f) { const b = await drive.readBytes(f.drive); if (!b) throw new Error('O arquivo já saiu da nuvem.'); return openBytes(b, key); },
    async cleanup(expired) { for (const f of expired) await drive.remove(f.id).catch(() => {}); return expired.length; },
    list: () => drive.list(),
    async send(payload) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const f = await find();
        const items = [payload, ...(await readAll(f)).filter((i) => i.id !== payload.id)].slice(0, CLOUD_KEEP);
        const env = await seal({ items, updatedAt: Date.now() }, key);
        if (!f) { await drive.create(CLOUD_FILE, env); return; }
        if ((await drive.version(f.id)) !== f.version) continue; // outro aparelho gravou no meio: lê de novo
        await drive.update(f.id, env);
        return;
      }
      throw new Error('A nuvem está ocupada. Tento de novo em instantes.');
    },
    async poll(state = {}, now = Date.now()) {
      const f = await find();
      if (!f || f.version === state.version) return { items: [], state };
      const all = await readAll(f);
      const seen = new Set(state.seen || []);
      const items = all.filter((i) => !seen.has(i.id) && (state.version || now - (+i.at || 0) < RECENT));
      return { items, state: { version: f.version, seen: all.map((i) => i.id) } };
    },
  };
}

// ---------- 🔔 ntfy (canal privado; cifrado com a chave que só vai no QR) ----------
export function ntfyTransport(cfg, { fetchFn = fetch, me } = {}) {
  const base = `${String(cfg.server || 'https://ntfy.sh').replace(/\/+$/, '')}/${encodeURIComponent(cfg.topic)}`;
  return {
    images: false,
    /** Mídias (0.9.3.2): anexo cifrado com a chave do canal (o ntfy.sh guarda por 3 horas, até 15 MB). */
    async putFile(bytes) {
      const k = cfg.plain ? '' : keyB64(cfg.key);
      const res = await fetchFn(base, { method: 'PUT', headers: { Filename: 'neurotab.bin', Title: 'NeuroTab', Tags: 'nt-file' }, body: await sealBytes(bytes, k) });
      if (!res.ok) throw new Error(res.status === 413 ? 'ntfy: arquivo grande demais para o servidor.' : `ntfy: erro ${res.status}.`);
      const j = await res.json().catch(() => ({}));
      if (!j.attachment?.url) throw new Error('ntfy: o servidor não aceita anexos.');
      return { ntfy: j.attachment.url, enc: !!k, sentId: j.id || '' };
    },
    async getFile(f) {
      const res = await fetchFn(f.ntfy);
      if (!res.ok) throw new Error(res.status === 404 ? 'O anexo já expirou no ntfy (fica 3 horas).' : `ntfy: erro ${res.status}.`);
      return openBytes(new Uint8Array(await res.arrayBuffer()), cfg.plain ? '' : keyB64(cfg.key));
    },
    async send(payload) {
      if (payload.image) return { skipped: 'image' }; // o ntfy leva só texto
      const body = cfg.plain ? payload.text : await sealNtfy(payload, cfg.key);
      const headers = cfg.plain ? { Title: `📋 ${me?.name || 'NeuroTab'}`, Tags: 'clipboard' } : { Title: 'NeuroTab', Tags: 'lock' };
      const res = await fetchFn(base, { method: 'POST', headers, body });
      if (!res.ok) throw new Error(`ntfy: erro ${res.status}.`);
      const j = await res.json().catch(() => ({}));
      return { id: j.id || '' };
    },
    async poll(state = {}, now = Date.now()) {
      const res = await fetchFn(`${base}/json?poll=1&since=${encodeURIComponent(state.since || '10m')}`);
      if (!res.ok) throw new Error(`ntfy: erro ${res.status}.`);
      const sent = new Set(state.sent || []);
      const items = [];
      let since = state.since || '';
      for (const line of (await res.text()).split('\n')) {
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.event !== 'message') continue;
        since = ev.id || since;
        if (sent.has(ev.id)) continue; // fui eu que mandei
        if ((ev.tags || []).includes('nt-file')) continue; // anexo de uma mídia: vem junto da mensagem dela
        let p = null;
        try {
          const raw = String(ev.message || '').startsWith('NT1:') ? await openNtfy(ev.message, cfg.key) : null;
          p = raw
            ? (raw.kind === 'media' ? cleanMediaPayload(raw) : cleanPayload(raw))
            : cleanPayload({ id: ev.id, at: (ev.time || 0) * 1000 || now, from: { id: 'ntfy', name: ev.title && !/neurotab/i.test(ev.title) ? ev.title : 'ntfy' }, text: ev.message });
        } catch { continue; } // chave diferente: não é para nós
        if (p && p.from.id !== me?.id) items.push(p);
      }
      return { items, state: { ...state, since } };
    },
  };
}

// ---------- ✈️ Telegram (bot da própria pessoa) ----------
export function telegramTransport(cfg, { fetchFn = fetch, me } = {}) {
  const api = (m) => `https://api.telegram.org/bot${cfg.token}/${m}`;
  const call = async (m, body) => {
    const res = await fetchFn(api(m), body instanceof FormData ? { method: 'POST', body } : body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(res.status === 401 ? 'Telegram: o token do bot não vale mais.' : `Telegram: ${j.description || 'erro ' + res.status}.`);
    return j.result;
  };
  return {
    images: true,
    getMe: () => call('getMe'),
    /** Depois que a pessoa manda /start para o bot: acha a conversa. */
    async findChat() {
      const ups = await call('getUpdates?timeout=0&allowed_updates=%5B%22message%22%5D');
      const m = [...ups].reverse().find((u) => u.message?.chat?.type === 'private')?.message;
      return m ? { chatId: String(m.chat.id), name: [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username || '', offset: ups.at(-1).update_id + 1 } : null;
    },
    /** Mídias (0.9.3.2): manda o arquivo pelo bot (até 50 MB; o Telegram lê o conteúdo). */
    async sendFiles(payload, files) {
      const caption = payload.text.slice(0, 1024);
      if (!files.length) return call('sendMessage', { chat_id: cfg.chatId, text: payload.text.slice(0, 4096) });
      for (const [i, f] of files.entries()) {
        const fd = new FormData();
        fd.append('chat_id', cfg.chatId);
        if (i === 0) fd.append('caption', caption);
        const kind = /^image\/(jpeg|png|webp)$/.test(f.mime) && f.bytes.length <= 10 * 1024 * 1024 ? 'photo' : /^video\//.test(f.mime) ? 'video' : /^audio\//.test(f.mime) ? 'audio' : 'document';
        fd.append(kind, new Blob([f.bytes], { type: f.mime }), f.name);
        await call({ photo: 'sendPhoto', video: 'sendVideo', audio: 'sendAudio', document: 'sendDocument' }[kind], fd);
      }
      return {};
    },
    async send(payload) {
      if (payload.image) {
        const fd = new FormData();
        fd.append('chat_id', cfg.chatId);
        fd.append('caption', `📋 ${me?.name || 'NeuroTab'}`);
        fd.append('photo', dataUrlToBlob(payload.image.data), 'imagem.' + (payload.image.type.split('/')[1] || 'webp'));
        await call('sendPhoto', fd);
      } else {
        await call('sendMessage', { chat_id: cfg.chatId, text: payload.text.slice(0, 4096), disable_web_page_preview: true });
      }
      return {};
    },
    async poll(state = {}, now = Date.now()) {
      const ups = await call(`getUpdates?timeout=0&offset=${state.offset || 0}&allowed_updates=%5B%22message%22%5D`);
      const items = [];
      let offset = state.offset || 0;
      for (const u of ups) {
        offset = Math.max(offset, u.update_id + 1);
        const m = u.message;
        if (!m || String(m.chat?.id) !== String(cfg.chatId)) continue;
        if (m.text?.startsWith('/')) continue; // comandos (/start)
        const from = { id: 'telegram', name: 'Telegram' };
        if (m.photo?.length) {
          const best = m.photo.at(-1);
          const file = await call(`getFile?file_id=${encodeURIComponent(best.file_id)}`);
          const bytes = new Uint8Array(await (await fetchFn(`https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`)).arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          items.push(cleanPayload({ id: 'tg-' + u.update_id, at: m.date * 1000 || now, from, text: m.caption || '', image: { data: 'data:image/jpeg;base64,' + btoa(bin), w: best.width, h: best.height, type: 'image/jpeg' } }));
        } else if (m.text) {
          items.push(cleanPayload({ id: 'tg-' + u.update_id, at: m.date * 1000 || now, from, text: m.text }));
        }
      }
      return { items: items.filter(Boolean), state: { ...state, offset } };
    },
  };
}
