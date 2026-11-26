// Compartilhar a área de transferência (0.7.7.2): regras, formato, e cada caminho com servidor simulado
// (Drive, ntfy, Telegram), incluindo dois aparelhos conversando e o eco que não pode voltar.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// dois "aparelhos": cada um com seu armazenamento; troca qual está ativo
const stores = { A: {}, B: {} };
let cur = 'A';
const use = (k) => { cur = k; };
globalThis.chrome = { storage: { local: {
  get: async (keys) => { const db = stores[cur]; return Object.fromEntries([].concat(keys).filter((k) => k in db).map((k) => [k, structuredClone(db[k])])); },
  set: async (o) => { Object.assign(stores[cur], structuredClone(o)); },
  remove: async (keys) => { for (const k of [].concat(keys)) delete stores[cur][k]; },
} } };

const S = await import('../../src/lib/clipboard-share.js');
const C = await import('../../src/lib/clipboard.js');
const Tr = await import('../../src/lib/clipboard-transports.js');
const Sync = await import('../../src/lib/clipboard-sync.js');

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const item = (over = {}) => ({ id: 'i1', kind: 'text', text: 'oi', origin: 'local', pinned: false, updatedAt: 1, ...over });

test('regras: o que, imagens, sentido; nunca reenvia o que veio de fora', () => {
  const base = S.shareConfig({ share: { enabled: true, ntfy: { on: true } } });
  assert.equal(S.shouldShare(item(), base), false, 'padrão: só o que eu mandar');
  assert.equal(S.shouldShare(item({ shareRequested: true }), base), true);
  assert.equal(S.shouldShare(item(), { ...base, what: 'all' }), true);
  assert.equal(S.shouldShare(item(), { ...base, what: 'pinned' }), false);
  assert.equal(S.shouldShare(item({ pinned: true }), { ...base, what: 'pinned' }), true);
  assert.equal(S.shouldShare(item({ origin: 'remote', shareRequested: true }), base), false, 'eco');
  assert.equal(S.shouldShare(item({ shareRequested: true, sharedAt: 5 }), base), false, 'já foi');
  assert.equal(S.shouldShare(item({ shareRequested: true }), { ...base, direction: 'receive' }), false);
  const img = (size) => item({ kind: 'image', shareRequested: true, image: { size } });
  assert.equal(S.shouldShare(img(100e3), base), true);
  assert.equal(S.shouldShare(img(900e3), base), false, 'só pequenas');
  assert.equal(S.shouldShare(img(900e3), { ...base, images: 'all' }), true);
  assert.equal(S.shouldShare(img(1), { ...base, images: 'no' }), false);
  assert.equal(S.shouldShare(item({ shareRequested: true }), S.shareConfig({ share: { enabled: true } })), false, 'sem caminho ligado');
  assert.equal(S.canReceive({ ...base, direction: 'send' }), false);
});

test('formato: payload limpo, imagem validada, chave do ntfy só no link', async () => {
  const p = S.toPayload(item({ text: 'texto', updatedAt: 9 }), { id: 'pc', name: 'Notebook' });
  assert.deepEqual([p.v, p.id, p.at, p.from.name, p.text, p.image], [1, 'i1', 9, 'Notebook', 'texto', null]);
  assert.equal(S.cleanPayload({ text: '  ' }), null);
  assert.equal(S.cleanPayload({ image: { data: 'javascript:alert(1)' } }), null, 'imagem estranha não entra');
  assert.ok(S.cleanPayload({ id: 'x', image: { data: 'data:image/png;base64,AAAA', w: 1, h: 1 } }).image.sig);
  const key = S.newShareKey();
  const msg = await S.sealNtfy(p, key);
  assert.match(msg, /^NT1:/);
  assert.ok(!msg.includes('texto'), 'cifrado');
  assert.deepEqual(await S.openNtfy(msg, key), p);
  await assert.rejects(S.openNtfy(msg, S.newShareKey()), 'outra chave não abre');
  const link = S.ntfyPairLink({ name: 'PC', ntfy: { server: 'https://ntfy.sh', topic: 'nt-abc', key } });
  assert.ok(link.startsWith('https://mpjbiologo.github.io/NeuroTab/cola/#ntfy&'));
  assert.ok(new URL(link).hash.includes(key) && !new URL(link).search, 'a chave vai depois do #, nunca na consulta');
});

/** Drive falso (pasta oculta). */
function fakeDrive() {
  const files = {};
  let n = 0;
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname === '/drive/v3/files' && (opts.method || 'GET') === 'GET') return json({ files: Object.values(files).map(({ id, name, version }) => ({ id, name, version })) });
    if (u.pathname === '/upload/drive/v3/files' && opts.method === 'POST') {
      const meta = JSON.parse(opts.body.split('\r\n\r\n')[1].split('\r\n')[0]);
      const body = JSON.parse(opts.body.split('\r\n\r\n')[2].split('\r\n--')[0]);
      const id = 'f' + ++n;
      files[id] = { id, name: meta.name, version: '1', body };
      return json({ id, version: '1' });
    }
    const m = u.pathname.match(/files\/([^/]+)$/);
    const f = m && files[m[1]];
    if (!f) return json({}, 404);
    if (opts.method === 'PATCH') { f.body = JSON.parse(opts.body); f.version = String(+f.version + 1); return json({ id: f.id, version: f.version }); }
    if (u.searchParams.get('alt') === 'media') return json(f.body);
    return json({ version: f.version });
  };
  return { files, fetchFn };
}
function login(store) {
  stores[store].nt_accounts = { accounts: [{ id: 'google:1', provider: 'google', email: 'ana@gmail.com', scopes: ['https://www.googleapis.com/auth/drive.appdata'] }] };
  stores[store].nt_account_tokens = { 'google:1': { accessToken: 'tok', expiresAt: Date.now() + 3600e3, scopes: ['https://www.googleapis.com/auth/drive.appdata'] } };
}

test('☁️ nuvem: dois computadores trocam itens cifrados; o eco não volta; primeira leitura só traz o recente', async () => {
  const D = fakeDrive();
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  for (const s of ['A', 'B']) {
    stores[s] = {};
    login(s);
    stores[s].nt_sync = { enabled: true, accountId: 'google:1', mode: 'key' };
    stores[s].nt_sync_key = key;
    stores[s][C.CLIP_CFG_KEY] = { ...C.DEFAULT_CFG, share: { enabled: true, what: 'all', name: s === 'A' ? 'Notebook' : 'Desktop', cloud: { on: true } } };
  }
  // A copia algo e envia
  use('A');
  await C.addClip({ text: 'Endereço: Rua das Flores, 120', via: 'manual' });
  const sent = await Sync.dispatchShares({ fetchFn: D.fetchFn });
  assert.deepEqual(sent[0].via, ['cloud']);
  const file = Object.values(D.files).find((f) => f.name === S.CLOUD_FILE);
  assert.equal(file.body.alg, 'A256GCM', 'cifrado na nuvem');
  assert.ok(!JSON.stringify(file.body).includes('Flores'));
  assert.ok((await C.loadClips())[0].sharedAt, 'marcado como enviado');
  // B recebe
  use('B');
  const got = await Sync.pollShares({ fetchFn: D.fetchFn });
  assert.equal(got.length, 1);
  const recv = (await C.loadClips())[0];
  assert.deepEqual([recv.text, recv.origin, recv.from.name], ['Endereço: Rua das Flores, 120', 'remote', 'Notebook']);
  // nada novo: não traz de novo
  assert.equal((await Sync.pollShares({ fetchFn: D.fetchFn })).length, 0);
  // B não reenvia o que recebeu (eco)
  assert.equal((await Sync.dispatchShares({ fetchFn: D.fetchFn })).length, 0);
  // B manda uma resposta; A recebe, mas não recebe o próprio item de volta
  await C.addClip({ text: 'Recebido!', via: 'manual' });
  await Sync.dispatchShares({ fetchFn: D.fetchFn });
  use('A');
  const back = await Sync.pollShares({ fetchFn: D.fetchFn });
  assert.deepEqual(back.map((i) => i.text), ['Recebido!']);
  // sincronização desligada: erro claro no estado, sem quebrar
  stores.A.nt_sync.enabled = false;
  await Sync.pollShares({ fetchFn: D.fetchFn });
  assert.match((await Sync.shareState()).cloud.error, /Ligue a sincronização/);
});

test('☁️ nuvem: primeira leitura num aparelho novo ignora o histórico antigo', async () => {
  const D = fakeDrive();
  const tr = Tr.cloudTransport({ accountId: 'google:1', key: '', fetchFn: D.fetchFn });
  use('A');
  login('A');
  const now = Date.now();
  await tr.send({ v: 1, id: 'velho', at: now - 3600e3, from: { id: 'x', name: 'X' }, text: 'antigo' });
  await tr.send({ v: 1, id: 'novo', at: now - 60e3, from: { id: 'x', name: 'X' }, text: 'recente' });
  const r = await tr.poll({}, now);
  assert.deepEqual(r.items.map((i) => i.id), ['novo']);
  assert.deepEqual((await tr.poll(r.state, now)).items, []);
});

/** ntfy falso. */
function fakeNtfy() {
  const msgs = [];
  let n = 0;
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    if (opts.method === 'POST') { const id = 'm' + ++n; msgs.push({ id, time: Math.floor(Date.now() / 1000), event: 'message', title: opts.headers?.Title, message: opts.body }); return json({ id }); }
    assert.equal(u.searchParams.get('poll'), '1');
    const since = u.searchParams.get('since');
    const i = msgs.findIndex((m) => m.id === since);
    const list = i >= 0 ? msgs.slice(i + 1) : msgs;
    return new Response([{ event: 'open' }, ...list].map((m) => JSON.stringify(m)).join('\n') + '\n');
  };
  return { msgs, fetchFn };
}

test('🔔 ntfy: cifrado, ignora o que eu mandei e o que outra chave cifrou; texto aberto do app ntfy entra', async () => {
  const N = fakeNtfy();
  const key = S.newShareKey();
  const cfg = { server: 'https://ntfy.test', topic: 'nt-x', key, plain: false };
  const A = Tr.ntfyTransport(cfg, { fetchFn: N.fetchFn, me: { id: 'pcA', name: 'Notebook' } });
  const B = Tr.ntfyTransport(cfg, { fetchFn: N.fetchFn, me: { id: 'cel', name: 'Celular' } });
  const r = await A.send({ v: 1, id: 'a1', at: 1, from: { id: 'pcA', name: 'Notebook' }, text: 'segredo do PC' });
  assert.ok(r.id);
  assert.ok(!N.msgs[0].message.includes('segredo'), 'o servidor só vê texto embaralhado');
  assert.equal(N.msgs[0].title, 'NeuroTab');
  assert.deepEqual((await A.send({ image: { data: 'x' } })).skipped, 'image', 'ntfy não leva imagem');
  // outro canal com outra chave escrevendo no mesmo tópico: ignorado
  N.msgs.push({ id: 'zz', event: 'message', message: await S.sealNtfy({ v: 1, id: 'z', text: 'intruso' }, S.newShareKey()) });
  // o app ntfy manda texto aberto
  N.msgs.push({ id: 'p1', event: 'message', time: 100, title: 'Pixel', message: 'do app ntfy' });
  const got = await B.poll({});
  assert.deepEqual(got.items.map((i) => i.text), ['segredo do PC', 'do app ntfy']);
  assert.equal(got.items[1].from.name, 'Pixel');
  assert.equal(got.state.since, 'p1');
  // A não recebe o próprio item (pelo id enviado e pelo aparelho)
  const own = await A.poll({ sent: [r.id] });
  assert.deepEqual(own.items.map((i) => i.text), ['do app ntfy']);
  // modo aberto: título com o nome
  const P = Tr.ntfyTransport({ ...cfg, plain: true }, { fetchFn: N.fetchFn, me: { id: 'pcA', name: 'Notebook' } });
  await P.send({ v: 1, id: 'a2', from: { id: 'pcA' }, text: 'aberto' });
  assert.deepEqual([N.msgs.at(-1).message, N.msgs.at(-1).title], ['aberto', '📋 Notebook']);
});

test('✈️ Telegram: conectar o bot, enviar texto e imagem, receber texto e foto, ignorar outras conversas e comandos', async () => {
  const sentTo = [];
  let updates = [];
  const tiny = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/file/')) return new Response(Uint8Array.from(atob(tiny), (c) => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/png' } });
    const m = u.pathname.split('/').pop();
    if (m === 'getMe') return json({ ok: true, result: { username: 'meu_neurotab_bot' } });
    if (m === 'getUpdates') { const off = +u.searchParams.get('offset') || 0; return json({ ok: true, result: updates.filter((x) => x.update_id >= off) }); }
    if (m === 'getFile') return json({ ok: true, result: { file_path: 'photos/a.jpg' } });
    if (m === 'sendMessage') { sentTo.push(['text', JSON.parse(opts.body)]); return json({ ok: true, result: {} }); }
    if (m === 'sendPhoto') { sentTo.push(['photo', opts.body.get('chat_id')]); return json({ ok: true, result: {} }); }
    return json({ ok: false, description: 'Not Found' }, 404);
  };
  const tg = Tr.telegramTransport({ token: '1:AA', chatId: '' }, { fetchFn });
  assert.equal((await tg.getMe()).username, 'meu_neurotab_bot');
  assert.equal(await tg.findChat(), null, 'ainda sem /start');
  updates = [{ update_id: 10, message: { chat: { id: 555, type: 'private', first_name: 'Ana' }, text: '/start', date: 1 } }];
  const chat = await tg.findChat();
  assert.deepEqual([chat.chatId, chat.name, chat.offset], ['555', 'Ana', 11]);
  const T = Tr.telegramTransport({ token: '1:AA', chatId: '555' }, { fetchFn, me: { name: 'Notebook' } });
  await T.send({ text: 'para o celular' });
  await T.send({ image: { data: 'data:image/png;base64,' + tiny, type: 'image/png' } });
  assert.deepEqual(sentTo.map((x) => x[0]), ['text', 'photo']);
  assert.equal(sentTo[0][1].chat_id, '555');
  updates.push(
    { update_id: 11, message: { chat: { id: 555 }, text: 'do celular', date: 2 } },
    { update_id: 12, message: { chat: { id: 999 }, text: 'de outra pessoa', date: 2 } },
    { update_id: 13, message: { chat: { id: 555 }, photo: [{ file_id: 'p', width: 1, height: 1 }], caption: 'foto', date: 3 } },
  );
  const got = await T.poll({ offset: 11 });
  assert.deepEqual(got.items.map((i) => i.text), ['do celular', 'foto']);
  assert.match(got.items[1].image.data, /^data:image\/jpeg;base64,/);
  assert.equal(got.state.offset, 14);
  assert.deepEqual((await T.poll(got.state)).items, []);
  const bad = Tr.telegramTransport({ token: 'x', chatId: '1' }, { fetchFn: async () => json({ ok: false }, 401) });
  await assert.rejects(bad.send({ text: 'x' }), /token do bot/);
});

test('enviar de novo pelo botão e falha registrada no item', async () => {
  use('A');
  stores.A = {};
  stores.A[C.CLIP_CFG_KEY] = { ...C.DEFAULT_CFG, share: { enabled: true, what: 'manual', ntfy: { on: true, server: 'https://ntfy.test', topic: 't', key: S.newShareKey() } } };
  const r = await C.addClip({ text: 'manual', via: 'manual' });
  assert.equal((await Sync.dispatchShares({ fetchFn: async () => json({}) })).length, 0, 'manual: espera o botão');
  await C.updateClip(r.item.id, { shareRequested: true });
  const out = await Sync.dispatchShares({ fetchFn: async () => new Response('x', { status: 500 }) });
  assert.match(out[0].errors[0], /ntfy: erro 500/);
  const it = (await C.loadClips())[0];
  assert.ok(it.shareError && it.sharedAt && !it.shareRequested);
});

test('a página do celular usa a mesma criptografia da extensão (cópia idêntica)', async () => {
  const { readFileSync } = await import('node:fs');
  const a = readFileSync(new URL('../../src/lib/sync-crypto.js', import.meta.url), 'utf8');
  const b = readFileSync(new URL('../../docs/cola/sync-crypto.js', import.meta.url), 'utf8');
  assert.equal(b, a, 'rode: cp src/lib/sync-crypto.js docs/cola/sync-crypto.js');
});

test('rede local: o QR usa o Wi-Fi, não a VPN nem o adaptador virtual (0.9.2.2)', async () => {
  const { lanTargets } = await import('../../src/lib/clipboard-share.js');
  // Ponte antiga: só urls, na ordem das placas de rede
  const old = lanTargets({ urls: ['http://172.16.0.2:41414', 'http://192.168.1.2:41414'] }, 'abc');
  assert.equal(old[0].url, 'http://192.168.1.2:41414/#t=abc');
  assert.equal(old[0].best, true);
  assert.equal(old[1].virtual, true);
  // Ponte nova: endereços já ordenados, com o nome da placa e o perfil da rede
  const now = lanTargets({ addrs: [{ url: 'http://192.168.1.2:41414', ip: '192.168.1.2', iface: 'Wi-Fi', publicNet: true }, { url: 'http://172.16.0.2:41414', ip: '172.16.0.2', iface: 'CloudflareWARP', virtual: true }] }, 'a b');
  assert.deepEqual(now.map((a) => a.iface), ['Wi-Fi', 'CloudflareWARP']);
  assert.equal(now[0].url, 'http://192.168.1.2:41414/#t=a%20b');
  assert.equal(now[0].publicNet, true);
  assert.deepEqual(lanTargets({}, 'x'), []);
});
