// NeuroTab — coordena o compartilhamento: envia o que deve sair por todos os caminhos ligados e traz o que
// chegou de outros aparelhos. Roda no fundo (background.js); a rede local (Ponte) entra por `lan`.
import { loadClips, clipConfig, addClip, updateClip, deviceId } from './clipboard.js';
import { shareConfig, shouldShare, canReceive, toPayload, SHARE_STATE_KEY } from './clipboard-share.js';
import { cloudReady, cloudTransport, ntfyTransport, telegramTransport } from './clipboard-transports.js';

const area = () => chrome.storage.local;
export async function shareState() { return (await area().get(SHARE_STATE_KEY))[SHARE_STATE_KEY] || {}; }
export async function patchState(t, patch) {
  const s = await shareState();
  s[t] = { ...(s[t] || {}), ...patch };
  await area().set({ [SHARE_STATE_KEY]: s });
  return s[t];
}

export async function me(share) {
  return { id: await deviceId(), name: share.name || 'Computador' };
}

/** Caminhos de consulta ligados (a rede local é por conexão e chega pelo parâmetro lan). */
export async function transports(share, { fetchFn = fetch, who }) {
  const out = {};
  if (share.cloud.on) {
    try { const c = await cloudReady(); out.cloud = cloudTransport({ ...c, fetchFn }); } catch (e) { await patchState('cloud', { error: e.message }); }
  }
  if (share.ntfy.on && share.ntfy.topic) out.ntfy = ntfyTransport(share.ntfy, { fetchFn, me: who });
  if (share.telegram.on && share.telegram.token && share.telegram.chatId) out.telegram = telegramTransport(share.telegram, { fetchFn, me: who });
  return out;
}

let sending = null;
/** Envia os itens que devem sair (e marca cada um com por onde foi). */
export function dispatchShares(opts = {}) {
  if (!sending) sending = doDispatch(opts).finally(() => { sending = null; });
  return sending;
}
async function doDispatch({ fetchFn = fetch, lan = null } = {}) {
  const share = shareConfig(await clipConfig());
  const pending = (await loadClips()).filter((it) => shouldShare(it, share));
  if (!pending.length) return [];
  const who = await me(share);
  const ts = await transports(share, { fetchFn, who });
  if (share.lan.on && lan) ts.lan = lan;
  const done = [];
  for (const it of pending.reverse()) { // do mais antigo para o mais novo
    const payload = toPayload(it, who);
    const via = [];
    const errors = [];
    for (const [name, t] of Object.entries(ts)) {
      if (it.kind === 'image' && t.images === false) continue;
      try {
        const r = await t.send(payload);
        if (r?.skipped) continue;
        via.push(name);
        if (name === 'ntfy' && r?.id) { const s = (await shareState()).ntfy || {}; await patchState('ntfy', { sent: [r.id, ...(s.sent || [])].slice(0, 100) }); }
        await patchState(name, { error: '', lastOk: Date.now() });
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
        await patchState(name, { error: e.message });
      }
    }
    await updateClip(it.id, { sharedAt: Date.now(), sharedVia: via, shareRequested: false, shareError: errors.join(' · ') });
    done.push({ id: it.id, via, errors });
  }
  return done;
}

let mediaReceiver = null;
/** Quem cuida das mídias que chegam (0.9.3.2): o background liga (media-share-run.js). */
export function setMediaReceiver(fn) { mediaReceiver = fn; }

/** Recebe um item de outro aparelho (qualquer caminho). */
export async function receivePayload(p, viaName) {
  if (!p) return null;
  const myId = await deviceId();
  if (p.from?.id && p.from.id === myId) return null; // eco do que eu mesmo mandei
  if (p.kind === 'media') {
    if (mediaReceiver) return mediaReceiver(p, viaName);
    if (!p.text) return null; // sem quem cuide: vira texto (título e link)
  }
  const r = await addClip({ text: p.text, image: p.image, via: 'remote', from: p.from, source: { url: '', title: `${p.from?.name || viaName}` } });
  return r.item || null;
}

let polling = null;
/** Consulta os caminhos ligados e traz o que chegou. */
export function pollShares(opts = {}) {
  if (!polling) polling = doPoll(opts).finally(() => { polling = null; });
  return polling;
}
async function doPoll({ fetchFn = fetch, only = null, now = Date.now() } = {}) {
  const share = shareConfig(await clipConfig());
  if (!canReceive(share)) return [];
  const who = await me(share);
  const ts = await transports(share, { fetchFn, who });
  const got = [];
  for (const [name, t] of Object.entries(ts)) {
    if (only && only !== name) continue;
    try {
      const prev = (await shareState())[name] || {};
      const { items, state } = await t.poll(prev, now);
      for (const p of items) { const it = await receivePayload(p, name); if (it) got.push(it); }
      await patchState(name, { ...state, error: '', lastPoll: now });
    } catch (e) {
      await patchState(name, { error: e.message, lastPoll: now });
    }
  }
  return got;
}
