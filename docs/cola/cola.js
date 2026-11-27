// NeuroTab · Área de transferência no celular (0.7.7.2). Sem instalar nada e sem servidor da NeuroTab.
//   #nuvem → entra com a conta Google (pasta oculta do Drive) e a senha da sincronização
//   #ntfy&s=…&t=…&k=…&n=… → canal ntfy pareado pelo QR (a chave fica só aqui, no "#")
import { seal, open, deriveKey, WrongKeyError } from './sync-crypto.js';
import { sealBytes, openBytes } from './bytes-crypto.js';

const MB = 1024 * 1024;

const CLIENT_ID = '913281965961-kon02e6bh3tnfugcci53c65oiqvdpo12.apps.googleusercontent.com';
const HERE = location.origin + location.pathname;
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const META_FILE = 'nt-sync-meta.json';
const CLOUD_FILE = 'nt-clipboard.json';
const CHECK = 'neurotab-sync-ok';
const KEEP = 50;
const LS = { id: 'nt_cola_id', name: 'nt_cola_name', key: 'nt_cola_key', ntfy: 'nt_cola_ntfy', tok: 'nt_cola_token' };

// ---------- textos (pt, en, es) ----------
const lang = (navigator.language || 'pt').slice(0, 2);
const T = {
  en: {
    'Área de transferência': 'Clipboard', 'Escolha como conectar': 'Choose how to connect',
    'Abra esta página pelo QR code que aparece no widget Área de transferência da NeuroTab, no computador (botão 📤).': 'Open this page from the QR code shown in the NeuroTab Clipboard widget on your computer (📤 button).',
    '☁️ Entrar com a conta Google': '☁️ Sign in with Google', 'Senha de sincronização': 'Sync password', 'Lembrar neste celular': 'Remember on this phone', 'Abrir': 'Open',
    'Senha incorreta.': 'Wrong password.', 'Enviar para o computador': 'Send to computer', 'Escreva ou cole aqui…': 'Type or paste here…',
    'Copiar': 'Copy', 'Copiado ✓': 'Copied ✓', 'Enviado ✓': 'Sent ✓', 'Nada por aqui ainda.': 'Nothing here yet.', 'este celular': 'this phone',
    'Atualizando…': 'Updating…', 'Sair': 'Sign out', 'Nome deste celular': 'Name of this phone', '🖼️ Enviar imagem': '🖼️ Send image',
    'A sincronização não está ligada nesta conta. Ligue em Configurações → Contas, no computador.': "Sync isn't turned on for this account. Turn it on in Settings → Accounts, on your computer.",
    'O login expirou.': 'Sign-in expired.', 'Entrar de novo': 'Sign in again', 'Sem conexão. Tentando de novo…': 'No connection. Retrying…',
    'Dica: adicione esta página à tela inicial para abrir como um app.': 'Tip: add this page to your home screen to open it like an app.',
    '📎 Enviar foto, vídeo ou áudio': '📎 Send photo, video or audio', 'Abrir arquivo': 'Open file', 'Baixando…': 'Downloading…', 'Original': 'Original',
    'Grande demais para este caminho (até': 'Too big for this path (up to', 'Pela rede local (NeuroTab Ponte) vai inteiro.': 'Over the local network (NeuroTab Ponte) it goes whole.',
  },
  es: {
    'Área de transferência': 'Portapapeles', 'Escolha como conectar': 'Elige cómo conectar',
    'Abra esta página pelo QR code que aparece no widget Área de transferência da NeuroTab, no computador (botão 📤).': 'Abre esta página desde el código QR del widget Portapapeles de NeuroTab, en la computadora (botón 📤).',
    '☁️ Entrar com a conta Google': '☁️ Entrar con Google', 'Senha de sincronização': 'Contraseña de sincronización', 'Lembrar neste celular': 'Recordar en este celular', 'Abrir': 'Abrir',
    'Senha incorreta.': 'Contraseña incorrecta.', 'Enviar para o computador': 'Enviar a la computadora', 'Escreva ou cole aqui…': 'Escribe o pega aquí…',
    'Copiar': 'Copiar', 'Copiado ✓': 'Copiado ✓', 'Enviado ✓': 'Enviado ✓', 'Nada por aqui ainda.': 'Nada por aquí todavía.', 'este celular': 'este celular',
    'Atualizando…': 'Actualizando…', 'Sair': 'Salir', 'Nome deste celular': 'Nombre de este celular', '🖼️ Enviar imagem': '🖼️ Enviar imagen',
    'A sincronização não está ligada nesta conta. Ligue em Configurações → Contas, no computador.': 'La sincronización no está activada en esta cuenta. Actívala en Configuración → Cuentas, en la computadora.',
    'O login expirou.': 'El inicio de sesión expiró.', 'Entrar de novo': 'Entrar de nuevo', 'Sem conexão. Tentando de novo…': 'Sin conexión. Reintentando…',
    'Dica: adicione esta página à tela inicial para abrir como um app.': 'Consejo: agrega esta página a la pantalla de inicio para abrirla como una app.',
    '📎 Enviar foto, vídeo ou áudio': '📎 Enviar foto, video o audio', 'Abrir arquivo': 'Abrir archivo', 'Baixando…': 'Descargando…', 'Original': 'Original',
    'Grande demais para este caminho (até': 'Demasiado grande para este camino (hasta', 'Pela rede local (NeuroTab Ponte) vai inteiro.': 'Por la red local (NeuroTab Ponte) va entero.',
  },
};
const t = (s) => T[lang]?.[s] || s;
document.documentElement.lang = lang === 'en' ? 'en' : lang === 'es' ? 'es' : 'pt-BR';

// ---------- utilidades ----------
const $ = (s) => document.querySelector(s);
const app = $('#app');
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
let statusTimer;
function say(msg, ms = 2500) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(statusTimer);
  if (ms) statusTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const myId = () => localStorage.getItem(LS.id) || (localStorage.setItem(LS.id, 'cel-' + crypto.randomUUID()), localStorage.getItem(LS.id));
const myName = () => localStorage.getItem(LS.name) || 'Celular';
const when = (ts) => new Date(ts).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s) => decodeURIComponent(escape(atob(s)));
const keyB64 = (k) => { const s = k.replace(/-/g, '+').replace(/_/g, '/'); return s + '='.repeat((4 - (s.length % 4)) % 4); };

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', {}, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  say(t('Copiado ✓'));
}

async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = h('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { data: c.toDataURL('image/webp', 0.85), w: c.width, h: c.height, type: 'image/webp' };
}

// ---------- tela comum: lista + enviar ----------
let media = null; // { fetchFile(f) → bytes, upload(file), max } do caminho atual (0.9.3.2)
const sizeTxt = (n) => (n > MB ? (n / MB).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function screen({ title, list, send, images, logout }) {
  const box = h('textarea', { placeholder: t('Escreva ou cole aqui…'), 'aria-label': t('Escreva ou cole aqui…') });
  const nameIn = h('input', { value: myName(), maxlength: 30, onchange: () => localStorage.setItem(LS.name, nameIn.value.trim() || 'Celular') });
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    const f = fileIn.files[0];
    if (!f) return;
    say(t('Atualizando…'), 0);
    await send({ image: await shrink(f) });
    fileIn.value = '';
    say(t('Enviado ✓'));
    refresh();
  } });
  const mediaIn = h('input', { type: 'file', accept: 'image/*,video/*,audio/*', hidden: true, onchange: async () => {
    const f = mediaIn.files[0];
    mediaIn.value = '';
    if (!f) return;
    if (f.size > media.max) { say(`⚠️ ${t('Grande demais para este caminho (até')} ${media.max / MB} MB). ${t('Pela rede local (NeuroTab Ponte) vai inteiro.')}`, 7000); return; }
    say(t('Atualizando…'), 0);
    try { await media.upload(f); say(t('Enviado ✓')); refresh(); } catch (e) { say('⚠️ ' + e.message, 6000); }
  } });
  const listEl = h('div', { class: 'list', style: 'display:grid;gap:10px' });
  app.replaceChildren(
    h('section', { class: 'card compose' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h1', {}, '📋 ' + t('Área de transferência')), logout ? h('button', { class: 'btn', onclick: logout }, t('Sair')) : null),
      h('p', { class: 'muted' }, title),
      box,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn primary', onclick: async () => {
          const text = box.value.trim();
          if (!text) return;
          say(t('Atualizando…'), 0);
          try { await send({ text }); box.value = ''; say(t('Enviado ✓')); refresh(); } catch (e) { say('⚠️ ' + e.message, 5000); }
        } }, '📤 ' + t('Enviar para o computador')),
        images ? h('button', { class: 'btn', onclick: () => fileIn.click() }, t('🖼️ Enviar imagem')) : null, fileIn,
        media ? h('button', { class: 'btn', onclick: () => mediaIn.click() }, t('📎 Enviar foto, vídeo ou áudio')) : null, mediaIn),
      h('details', { style: 'margin-top:8px' }, h('summary', { class: 'muted' }, t('Nome deste celular')), nameIn)),
    listEl,
    h('p', { class: 'muted', style: 'text-align:center' }, t('Dica: adicione esta página à tela inicial para abrir como um app.')));
  async function refresh() {
    try {
      const items = await list();
      listEl.replaceChildren(...(items.length ? items.map(card) : [h('p', { class: 'card muted' }, t('Nada por aqui ainda.'))]));
    } catch (e) { say('⚠️ ' + e.message, 5000); if (e.code === 'auth') logout?.(); }
  }
  return refresh;
}
function mediaCard(p, mine) {
  const m = p.media || {};
  const files = (Array.isArray(p.files) ? p.files : []).filter((f) => f && (f.drive || f.ntfy));
  return h('article', { class: 'card item' + (mine ? ' mine' : '') },
    h('b', {}, '📎 ' + (m.title || 'Mídia')),
    m.summary ? h('div', { class: 'txt muted' }, m.summary) : null,
    ...files.map((f) => {
      const box = h('div', { class: 'row' });
      const go = h('button', { class: 'btn', onclick: async () => {
        go.disabled = true;
        say(t('Baixando…'), 0);
        try {
          const bytes = await media.fetchFile(f);
          const url = URL.createObjectURL(new Blob([bytes], { type: f.mime || 'application/octet-stream' }));
          const mt = String(f.mime || '');
          const view = /^image\//.test(mt) ? h('img', { src: url, alt: '' }) : /^video\//.test(mt) ? h('video', { src: url, controls: true, playsinline: true, style: 'width:100%' }) : /^audio\//.test(mt) ? h('audio', { src: url, controls: true, style: 'width:100%' }) : null;
          box.replaceChildren(...[view, h('a', { class: 'btn', href: url, download: f.name || 'arquivo' }, '⬇️ ' + (f.name || ''))].filter(Boolean));
          say('✓', 800);
        } catch (e) { go.disabled = false; say('⚠️ ' + e.message, 6000); }
      } }, `${/^image/.test(f.mime) ? '🖼️' : /^video/.test(f.mime) ? '🎬' : /^audio/.test(f.mime) ? '🎧' : '📄'} ${t('Abrir arquivo')} · ${sizeTxt(f.size || 0)}`);
      box.append(go);
      return box;
    }),
    !files.length && p.text ? h('div', { class: 'txt' }, p.text) : null,
    h('div', { class: 'meta' },
      h('small', { class: 'muted' }, `${mine ? t('este celular') : p.from?.name || ''} · ${when(p.at)}`),
      /^https?:\/\//.test(m.url || '') ? h('a', { class: 'btn', href: m.url, target: '_blank', rel: 'noopener noreferrer' }, '🔗 ' + t('Original')) : null));
}
function card(p) {
  const mine = p.from?.id === myId();
  if (p.kind === 'media' && media) return mediaCard(p, mine);
  return h('article', { class: 'card item' + (mine ? ' mine' : '') },
    p.image ? h('img', { src: p.image.data, alt: '' }) : null,
    p.text ? h('div', { class: 'txt' }, p.text) : null,
    h('div', { class: 'meta' },
      h('small', { class: 'muted' }, `${mine ? t('este celular') : p.from?.name || ''} · ${when(p.at)}`),
      p.text ? h('button', { class: 'btn', onclick: () => copy(p.text) }, t('Copiar')) : h('a', { class: 'btn', href: p.image.data, download: 'imagem.webp' }, '⬇️')));
}
const payload = ({ text = '', image = null }) => ({ v: 1, id: crypto.randomUUID(), at: Date.now(), from: { id: myId(), name: myName() }, kind: image ? 'image' : 'text', text, image });
/** Envelope de uma mídia que sai do celular (mesmo formato do computador). */
const mediaPayloadOf = (file, ref) => ({ v: 1, id: crypto.randomUUID(), at: Date.now(), from: { id: myId(), name: myName() }, kind: 'media', text: '📎 ' + (file.name || 'arquivo'), media: { title: file.name || 'arquivo', url: '', platform: 'phone', summary: '' }, files: [{ id: '0', name: file.name || 'arquivo', mime: file.type || 'application/octet-stream', size: file.size, ...ref }] });

// ---------- ☁️ nuvem (Google Drive) ----------
function googleLogin(prompt = 'select_account') {
  const state = crypto.randomUUID();
  sessionStorage.setItem('nt_cola_state', state);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({ client_id: CLIENT_ID, redirect_uri: HERE, response_type: 'token', scope: 'https://www.googleapis.com/auth/drive.appdata', include_granted_scopes: 'true', prompt, state }).forEach(([k, v]) => u.searchParams.set(k, v));
  location.assign(u.href);
}
function tokenFromHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (!q.get('access_token')) return null;
  if (q.get('state') !== sessionStorage.getItem('nt_cola_state')) return null;
  const tok = { v: q.get('access_token'), exp: Date.now() + (+q.get('expires_in') || 3600) * 1000 - 60e3 };
  sessionStorage.setItem(LS.tok, JSON.stringify(tok));
  history.replaceState(null, '', HERE + '#nuvem');
  return tok;
}
function cloud() {
  const tok = tokenFromHash() || JSON.parse(sessionStorage.getItem(LS.tok) || 'null');
  if (!tok || tok.exp < Date.now()) {
    app.replaceChildren(h('section', { class: 'card choose' },
      h('h1', {}, '☁️ ' + t('Área de transferência')),
      tok ? h('p', { class: 'muted' }, t('O login expirou.')) : null,
      h('button', { class: 'btn primary', onclick: () => googleLogin(tok ? 'none' : 'select_account') }, tok ? t('Entrar de novo') : t('☁️ Entrar com a conta Google'))));
    return;
  }
  const call = async (url, opts = {}) => {
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${tok.v}` } });
    if (r.status === 401) { sessionStorage.removeItem(LS.tok); throw Object.assign(new Error(t('O login expirou.')), { code: 'auth' }); }
    if (!r.ok) throw new Error(`Google Drive: ${r.status}`);
    return r;
  };
  const files = async () => (await (await call(`${DRIVE}/files?spaces=appDataFolder&pageSize=1000&fields=files(id,name,version)`)).json()).files || [];
  const read = async (id) => (await call(`${DRIVE}/files/${id}?alt=media`)).json();
  let key = localStorage.getItem(LS.key) || '';
  async function unlock() {
    const meta = (await files()).find((f) => f.name === META_FILE);
    if (!meta) { app.replaceChildren(h('p', { class: 'card' }, t('A sincronização não está ligada nesta conta. Ligue em Configurações → Contas, no computador.'))); return false; }
    const m = await read(meta.id);
    if (m.mode !== 'key') { key = ''; return true; }
    if (key) { try { if ((await open(m.check, key)) === CHECK) return true; } catch { /* senha mudou */ } }
    return new Promise((resolve) => {
      const pass = h('input', { type: 'password', autocomplete: 'current-password' });
      const keep = h('input', { type: 'checkbox', checked: true, style: 'width:auto' });
      const go = h('button', { class: 'btn primary', onclick: async () => {
        go.disabled = true;
        say(t('Atualizando…'), 0);
        try {
          const k = await deriveKey(pass.value, m.salt, m.iterations);
          if ((await open(m.check, k)) !== CHECK) throw new WrongKeyError();
          key = k;
          if (keep.checked) localStorage.setItem(LS.key, k); else localStorage.removeItem(LS.key);
          say('✓', 800);
          resolve(true);
        } catch { say(t('Senha incorreta.'), 3000); go.disabled = false; }
      } }, t('Abrir'));
      app.replaceChildren(h('section', { class: 'card choose' }, h('h1', {}, '🔒 ' + t('Senha de sincronização')), pass, h('label', { class: 'row' }, keep, t('Lembrar neste celular')), go));
      pass.focus();
    });
  }
  async function load() {
    const f = (await files()).find((x) => x.name === CLOUD_FILE);
    if (!f) return { f: null, items: [] };
    const data = await open(await read(f.id), key);
    return { f, items: Array.isArray(data?.items) ? data.items : [] };
  }
  async function addEnvelope(p) {
    const { f, items } = await load();
    const env = await seal({ items: [p, ...items].slice(0, KEEP), updatedAt: Date.now() }, key);
    if (f) await call(`${UPLOAD}/files/${f.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env) });
    else {
      const bnd = 'nt' + Math.random().toString(36).slice(2);
      const body = `--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: CLOUD_FILE, parents: ['appDataFolder'] })}\r\n--${bnd}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(env)}\r\n--${bnd}--`;
      await call(`${UPLOAD}/files?uploadType=multipart`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${bnd}` }, body });
    }
  }
  unlock().then((ok) => {
    if (!ok) return;
    media = {
      max: 25 * MB,
      fetchFile: async (f) => openBytes(new Uint8Array(await (await call(`${DRIVE}/files/${encodeURIComponent(f.drive)}?alt=media`)).arrayBuffer()), key),
      upload: async (file) => {
        const bnd = 'nt' + Math.random().toString(36).slice(2);
        const head = `--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: 'nt-media-' + crypto.randomUUID(), parents: ['appDataFolder'] })}\r\n--${bnd}\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const body = new Blob([head, await sealBytes(new Uint8Array(await file.arrayBuffer()), key), `\r\n--${bnd}--`]);
        const r = await (await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${bnd}` }, body })).json();
        await addEnvelope(mediaPayloadOf(file, { drive: r.id, enc: !!key }));
      },
    };
    const refresh = screen({
      title: '☁️ Google Drive',
      images: true,
      logout: () => { sessionStorage.removeItem(LS.tok); localStorage.removeItem(LS.key); location.hash = 'nuvem'; location.reload(); },
      list: async () => (await load()).items,
      send: async (part) => addEnvelope(payload(part)),
    });
    refresh();
    setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15_000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  }).catch((e) => say('⚠️ ' + e.message, 6000));
}

// ---------- 🔔 ntfy ----------
function ntfy() {
  const fromHash = new URLSearchParams(location.hash.replace(/^#ntfy&?/, ''));
  if (fromHash.get('t')) {
    localStorage.setItem(LS.ntfy, JSON.stringify({ s: fromHash.get('s') || 'https://ntfy.sh', t: fromHash.get('t'), k: fromHash.get('k'), n: fromHash.get('n') || '' }));
    history.replaceState(null, '', HERE + '#ntfy');
  }
  const c = JSON.parse(localStorage.getItem(LS.ntfy) || 'null');
  if (!c) return choose();
  const base = `${c.s.replace(/\/+$/, '')}/${encodeURIComponent(c.t)}`;
  const key = keyB64(c.k);
  const seen = new Map();
  async function decode(ev) {
    if (ev.event !== 'message') return null;
    if ((ev.tags || []).includes('nt-file')) return null; // anexo de uma mídia (vem junto da mensagem dela)
    const m = String(ev.message || '');
    if (m.startsWith('NT1:')) { try { return await open(JSON.parse(unb64(m.slice(4))), key); } catch { return null; } }
    return { id: ev.id, at: (ev.time || 0) * 1000, from: { name: 'ntfy' }, text: m };
  }
  const publish = async (p) => {
    const r = await fetch(base, { method: 'POST', headers: { Title: 'NeuroTab', Tags: 'lock' }, body: 'NT1:' + b64(JSON.stringify(await seal(p, key))) });
    if (!r.ok) throw new Error(`ntfy: ${r.status}`);
  };
  media = {
    max: 15 * MB,
    fetchFile: async (f) => {
      const r = await fetch(f.ntfy);
      if (!r.ok) throw new Error(r.status === 404 ? 'O anexo já expirou (o ntfy guarda por 3 horas).' : `ntfy: ${r.status}`);
      return openBytes(new Uint8Array(await r.arrayBuffer()), key);
    },
    upload: async (file) => {
      const r = await fetch(base, { method: 'PUT', headers: { Filename: 'neurotab.bin', Title: 'NeuroTab', Tags: 'nt-file' }, body: await sealBytes(new Uint8Array(await file.arrayBuffer()), key) });
      if (!r.ok) throw new Error(`ntfy: ${r.status}`);
      const j = await r.json();
      if (!j.attachment?.url) throw new Error('ntfy: o servidor não aceita anexos.');
      await publish(mediaPayloadOf(file, { ntfy: j.attachment.url, enc: true }));
    },
  };
  const refresh = screen({
    title: `🔔 ntfy${c.n ? ' · ' + c.n : ''}`,
    images: false,
    logout: () => { localStorage.removeItem(LS.ntfy); location.hash = ''; location.reload(); },
    list: async () => {
      const r = await fetch(`${base}/json?poll=1&since=24h`);
      if (!r.ok) throw new Error(t('Sem conexão. Tentando de novo…'));
      for (const line of (await r.text()).split('\n')) {
        if (!line.trim()) continue;
        const p = await decode(JSON.parse(line));
        if (p?.id) seen.set(p.id, p);
      }
      return [...seen.values()].sort((a, b) => b.at - a.at).slice(0, KEEP);
    },
    send: async ({ text }) => publish(payload({ text })),
  });
  refresh();
  try { const es = new EventSource(`${base}/sse`); es.onmessage = () => refresh(); } catch { setInterval(refresh, 10_000); }
}

// ---------- início ----------
function choose() {
  app.replaceChildren(h('section', { class: 'card choose' },
    h('h1', {}, '📋 ' + t('Área de transferência')),
    h('p', { class: 'muted' }, t('Abra esta página pelo QR code que aparece no widget Área de transferência da NeuroTab, no computador (botão 📤).')),
    h('button', { class: 'btn primary', onclick: () => { location.hash = 'nuvem'; cloud(); } }, t('☁️ Entrar com a conta Google'))));
}
$('#who').textContent = myName();
if (location.hash.startsWith('#ntfy') || (!location.hash && localStorage.getItem(LS.ntfy))) ntfy();
else if (location.hash.startsWith('#nuvem') || location.hash.includes('access_token') || sessionStorage.getItem(LS.tok)) cloud();
else choose();
