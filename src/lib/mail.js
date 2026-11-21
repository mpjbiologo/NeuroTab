// NeuroTab — E-mail (#20, 0.7.7.4): e-mails novos de várias contas, com avisos.
//
// Arquitetura de adaptadores: cada provedor sabe achar as contas, buscar os não lidos e montar os links.
//   gmail   — feed oficial do próprio Gmail (mail.google.com/mail/u/N/feed/atom), com a sessão já aberta neste
//             navegador. Não pede a permissão "ler e-mails" do Google (que é restrita e exige auditoria paga),
//             não guarda senha nem token: só o remetente, o assunto, o trecho e a hora dos não lidos.
//   outlook — pela conta Microsoft (Microsoft Graph), na 0.7.7.5.
//   iCloud / IMAP — sem caminho oficial para uma extensão (o navegador não fala IMAP); ver docs/dev/EMAIL.md.
//
// Guardado só neste computador (nt_mail / nt_mail_cfg); não sincroniza, não vai para o backup nem para a IA.

export const MAIL_KEY = 'nt_mail';
export const MAIL_CFG_KEY = 'nt_mail_cfg';
export const GMAIL_ORIGIN = 'https://mail.google.com/*';
export const MAX_ACCOUNTS = 6; // sessões do Gmail procuradas (u/0 … u/5)
export const KEEP_SEEN = 300; // ids lembrados por conta, para não avisar duas vezes
export const MAX_POPUPS = 3; // avisos separados por verificação; acima disso, um aviso resumido

export const FILTERS = {
  inbox: { label: 'Caixa de entrada', path: '' },
  important: { label: 'Só os importantes', path: 'important' },
  primary: { label: 'Só a aba Principal', path: '^sq_ig_i_personal' },
};

export const DEFAULT_CFG = {
  enabled: false,
  interval: 5, // minutos
  notify: true,
  muteUntil: 0,
  accounts: {}, // { [key]: { provider, index, email, show, notify, filter } }
};

const area = () => globalThis.chrome?.storage?.local;
export async function mailConfig() {
  const r = await area().get(MAIL_CFG_KEY);
  return { ...DEFAULT_CFG, ...(r[MAIL_CFG_KEY] || {}) };
}
export async function setMailConfig(patch) {
  const cfg = { ...(await mailConfig()), ...patch };
  await area().set({ [MAIL_CFG_KEY]: cfg });
  return cfg;
}
export async function mailCache() {
  const r = await area().get(MAIL_KEY);
  return { byAccount: {}, seen: {}, ...(r[MAIL_KEY] || {}) };
}
const saveCache = (c) => area().set({ [MAIL_KEY]: c });

// ---------- Atom (sem DOMParser: o service worker não tem) ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const unescapeXml = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m));
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? unescapeXml(m[1]).trim() : ''; };

export function parseGmailAtom(xml) {
  if (!/<feed[\s>]/i.test(xml)) return null;
  const title = tag(xml, 'title');
  const email = (title.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || tag(xml, 'tagline').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [''])[0].toLowerCase();
  const unread = +tag(xml, 'fullcount') || 0;
  const entries = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const e = m[1];
    const author = (e.match(/<author>([\s\S]*?)<\/author>/i) || ['', ''])[1];
    const href = (e.match(/<link[^>]*href="([^"]+)"/i) || ['', ''])[1];
    entries.push({
      id: tag(e, 'id') || unescapeXml(href),
      subject: tag(e, 'title') || '(sem assunto)',
      snippet: tag(e, 'summary').slice(0, 200),
      from: tag(author, 'name') || tag(author, 'email'),
      fromEmail: tag(author, 'email').toLowerCase(),
      at: Date.parse(tag(e, 'issued') || tag(e, 'modified')) || 0,
      link: unescapeXml(href),
    });
  }
  return { email, unread, entries };
}

// ---------- Adaptadores ----------
export const ADAPTERS = {
  gmail: {
    id: 'gmail', name: 'Gmail', icon: '✉️', origins: [GMAIL_ORIGIN],
    feedUrl: (index, filter = 'inbox') => `https://mail.google.com/mail/u/${index}/feed/atom/${FILTERS[filter]?.path ?? ''}`,
    openUrl: (acc) => `https://mail.google.com/mail/u/${acc.index}/#inbox`,
    composeUrl: (acc) => `https://mail.google.com/mail/u/${acc.index}/#inbox?compose=new`,
    /** Lê o feed de uma sessão. null = sessão não existe / não está logada. */
    async fetch(index, filter, fetchFn = fetch) {
      let res;
      try { res = await fetchFn(this.feedUrl(index, filter), { credentials: 'include', cache: 'no-store', redirect: 'follow' }); } catch { throw Object.assign(new Error('Sem conexão com o Gmail.'), { code: 'net' }); }
      if (res.status === 401 || res.status === 403 || /accounts\.google\.com|ServiceLogin/.test(res.url || '')) return null;
      if (res.status === 429) throw Object.assign(new Error('O Gmail pediu uma pausa. Tento de novo depois.'), { code: 'rate' });
      if (!res.ok) throw Object.assign(new Error(`Gmail: erro ${res.status}.`), { code: 'http' });
      return parseGmailAtom(await res.text());
    },
    /** Acha as contas abertas neste navegador (u/0, u/1, …), parando quando a sessão se repete. */
    async discover(fetchFn = fetch) {
      const found = [];
      for (let i = 0; i < MAX_ACCOUNTS; i++) {
        let feed;
        try { feed = await this.fetch(i, 'inbox', fetchFn); } catch (e) { if (i === 0) throw e; break; }
        if (!feed?.email || found.some((a) => a.email === feed.email)) break; // o Gmail devolve a u/0 para sessões que não existem
        found.push({ provider: 'gmail', index: i, email: feed.email });
      }
      return found;
    },
  },
  outlook: { id: 'outlook', name: 'Outlook', icon: '📨', soon: '0.7.7.5' },
};

export const accountKey = (a) => `${a.provider}:${a.email}`;

/** Junta as contas achadas com as escolhas já feitas (as novas entram ligadas). */
export function mergeAccounts(existing, found) {
  const out = {};
  for (const a of found) {
    const k = accountKey(a);
    out[k] = { show: true, notify: true, filter: 'inbox', ...(existing[k] || {}), ...a };
  }
  // contas que sumiram (deslogadas) ficam guardadas, marcadas como ausentes, até a pessoa remover
  for (const [k, a] of Object.entries(existing)) if (!out[k]) out[k] = { ...a, missing: true };
  return out;
}

/** O que é novo desde a última vez (por id), sem repetir aviso. A primeira leitura de uma conta não avisa. */
export function diffNew(entries, seenList) {
  if (!seenList) return { fresh: [], seen: entries.map((e) => e.id).slice(0, KEEP_SEEN) };
  const seen = new Set(seenList);
  const fresh = entries.filter((e) => !seen.has(e.id));
  return { fresh, seen: [...entries.map((e) => e.id), ...seenList.filter((id) => !entries.some((e) => e.id === id))].slice(0, KEEP_SEEN) };
}

let running = null;
/** Verifica todas as contas ligadas, guarda o resultado e devolve os e-mails novos (para avisar). */
export function checkMail(opts = {}) {
  if (!running) running = doCheck(opts).finally(() => { running = null; });
  return running;
}
async function doCheck({ fetchFn = fetch, now = Date.now(), rediscover = false } = {}) {
  let cfg = await mailConfig();
  if (!cfg.enabled) return { fresh: [], cfg };
  if (rediscover || !Object.keys(cfg.accounts).length) {
    try {
      const found = await ADAPTERS.gmail.discover(fetchFn);
      cfg = await setMailConfig({ accounts: mergeAccounts(cfg.accounts, found) });
    } catch { /* sem conexão: tenta com o que já conhece */ }
  }
  const cache = await mailCache();
  const fresh = [];
  for (const [k, acc] of Object.entries(cfg.accounts)) {
    if (acc.missing || !acc.show) continue;
    const ad = ADAPTERS[acc.provider];
    if (!ad?.fetch) continue;
    try {
      const feed = await ad.fetch(acc.index, acc.filter, fetchFn);
      if (!feed || (feed.email && feed.email !== acc.email)) {
        cache.byAccount[k] = { ...(cache.byAccount[k] || {}), error: 'Esta conta não está mais aberta neste navegador. Entre no Gmail com ela e clique em ↻.', fetchedAt: now };
        continue;
      }
      const d = diffNew(feed.entries, cache.seen[k]);
      cache.seen[k] = d.seen;
      cache.byAccount[k] = { unread: feed.unread, entries: feed.entries, fetchedAt: now, error: '' };
      if (acc.notify !== false) fresh.push(...d.fresh.map((e) => ({ ...e, account: k, email: acc.email, provider: acc.provider })));
    } catch (e) {
      cache.byAccount[k] = { ...(cache.byAccount[k] || {}), error: e.message, fetchedAt: now };
    }
  }
  cache.checkedAt = now;
  await saveCache(cache);
  return { fresh, cfg };
}

/** Lista única (mais novos primeiro) das contas visíveis. */
export function allEntries(cfg, cache, onlyAccount = '') {
  const out = [];
  for (const [k, acc] of Object.entries(cfg.accounts)) {
    if (acc.missing || !acc.show || (onlyAccount && onlyAccount !== k)) continue;
    for (const e of cache.byAccount[k]?.entries || []) out.push({ ...e, account: k, email: acc.email, provider: acc.provider, index: acc.index });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Textos dos avisos: até 3 separados; mais que isso, um resumo. */
export function notificationsFor(fresh, cfg, now = Date.now()) {
  if (!cfg.notify || (cfg.muteUntil && now < cfg.muteUntil) || !fresh.length) return [];
  if (fresh.length > MAX_POPUPS) {
    const per = {};
    for (const f of fresh) per[f.email] = (per[f.email] || 0) + 1;
    return [{ id: 'mail:many', title: `✉️ ${fresh.length} e-mails novos`, message: Object.entries(per).map(([e, n]) => `${e}: ${n}`).join(' · '), url: '' }];
  }
  return fresh.map((f) => ({ id: 'mail:' + f.id.slice(-60), title: `✉️ ${f.from || f.fromEmail}`, message: f.subject + (f.snippet ? ` — ${f.snippet.slice(0, 90)}` : ''), context: f.email, url: f.link }));
}

/** Desconectar: apaga as contas e tudo o que foi guardado. */
export async function forgetMail() {
  await area().remove([MAIL_KEY, MAIL_CFG_KEY]);
}
