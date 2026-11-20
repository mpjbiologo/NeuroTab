// Sincronização (#27): criptografia, mescla de 3 vias, dois aparelhos pelo Google Drive simulado, login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, open, deriveKey, newSalt, WrongKeyError, stableStringify } from '../../src/lib/sync-crypto.js';

// ---------- armazenamento falso: um por "aparelho" ----------
function device() {
  const db = {};
  return {
    db,
    api: {
      get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in db).map((k) => [k, structuredClone(db[k])])),
      set: async (o) => { Object.assign(db, structuredClone(o)); },
      remove: async (keys) => { for (const k of [].concat(keys)) delete db[k]; },
    },
  };
}
function use(dev) { globalThis.chrome = { storage: { local: dev.api } }; }

// ---------- Google Drive falso (pasta do app) ----------
function fakeDrive() {
  const files = new Map();
  let n = 0;
  const calls = [];
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    const m = opts.method || 'GET';
    calls.push(`${m} ${u.pathname}`);
    assert.match(opts.headers?.Authorization || '', /^Bearer tok-/);
    if (u.pathname === '/drive/v3/files' && m === 'GET') {
      assert.equal(u.searchParams.get('spaces'), 'appDataFolder');
      return json({ files: [...files.values()].map(({ id, name, version }) => ({ id, name, version })) });
    }
    let mm = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/);
    if (mm) {
      const f = files.get(mm[1]);
      if (!f) return json({}, 404);
      if (m === 'DELETE') { files.delete(mm[1]); return new Response(null, { status: 204 }); }
      if (u.searchParams.get('alt') === 'media') return json(JSON.parse(f.body));
      return json({ version: f.version });
    }
    if (u.pathname === '/upload/drive/v3/files' && m === 'POST') {
      const parts = opts.body.split(/--nt\w+/).filter((p) => p.includes('{'));
      const meta = JSON.parse(parts[0].slice(parts[0].indexOf('{')).trim());
      assert.deepEqual(meta.parents, ['appDataFolder']);
      const id = 'f' + ++n;
      files.set(id, { id, name: meta.name, version: '1', body: parts[1].slice(parts[1].indexOf('{')).trim() });
      return json({ id, version: '1' });
    }
    mm = u.pathname.match(/^\/upload\/drive\/v3\/files\/(\w+)$/);
    if (mm && m === 'PATCH') {
      const f = files.get(mm[1]);
      f.body = opts.body;
      f.version = String(+f.version + 1);
      return json({ id: f.id, version: f.version });
    }
    throw new Error('rota inesperada ' + m + ' ' + url);
  };
  return { files, fetchFn, calls };
}

// conta Google já conectada (token válido) no aparelho
async function connected(dev) {
  use(dev);
  await dev.api.set({
    nt_accounts: { accounts: [{ id: 'google:1', provider: 'google', email: 'ana@gmail.com', scopes: ['https://www.googleapis.com/auth/drive.appdata'] }] },
    nt_account_tokens: { 'google:1': { accessToken: 'tok-1', expiresAt: Date.now() + 3600e3, scopes: ['https://www.googleapis.com/auth/drive.appdata'] } },
  });
}

const note = (id, text, t, extra = {}) => ({ id, type: 'note', title: text.slice(0, 20), text, tags: [], createdAt: 1, updatedAt: t, ...extra });

test('criptografia: com senha ninguém lê sem a chave; sem senha fica legível; senha errada avisa', async () => {
  const salt = newSalt();
  const key = await deriveKey('cavalo correto bateria', salt, 1000);
  const env = await seal({ texto: 'segredo' }, key);
  assert.equal(env.alg, 'A256GCM');
  assert.ok(!JSON.stringify(env).includes('segredo'));
  assert.deepEqual(await open(env, key), { texto: 'segredo' });
  await assert.rejects(open(env, await deriveKey('outra senha', salt, 1000)), WrongKeyError);
  const plain = await seal({ texto: 'aberto' }, '');
  assert.equal(plain.alg, 'none');
  assert.deepEqual(await open(plain, ''), { texto: 'aberto' });
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
});

test('mescla de 3 vias: só um lado mudou, exclusões, conflito vira cópia, excluir x editar fica o editado', async () => {
  use(device());
  const { merge } = await import('../../src/lib/sync.js');
  const { digest } = await import('../../src/lib/sync-crypto.js');
  const a0 = note('a', 'original', 1); const b0 = note('b', 'nota b', 1); const c0 = note('c', 'nota c', 1); const d0 = note('d', 'nota d', 1);
  const base = { a: await digest(a0), b: await digest(b0), c: await digest(c0), d: await digest(d0) };
  const rec = async (v, t) => ({ h: await digest(v), t, v });
  const local = { a: note('a', 'editada aqui', 50), b: b0, d: note('d', 'editada aqui', 30), n: note('n', 'nova aqui', 40) }; // c excluída aqui
  const remote = { a: await rec(note('a', 'editada lá', 60), 60), b: await rec(note('b', 'nota b mudou lá', 20), 20), c: await rec(c0, 1), d: { d: 1, t: 25 } };
  const m = await merge('brain', local, remote, base, 100);
  assert.equal(m.local.b.text, 'nota b mudou lá', 'só o remoto mudou → vem de lá');
  assert.equal(m.local.c, undefined, 'excluída aqui → sai');
  assert.equal(m.remote.c.d, 1, 'e vira marca de exclusão lá');
  assert.equal(m.local.d.text, 'editada aqui', 'excluída lá, editada aqui → fica');
  assert.equal(m.local.n.text, 'nova aqui');
  assert.equal(m.local.a.text, 'editada lá', 'conflito: vale a mais recente');
  const copy = Object.values(m.local).find((x) => x.conflict);
  assert.equal(copy.text, 'editada aqui', 'e a outra versão fica como cópia');
  assert.match(copy.title, /^⚠️/);
  assert.equal(m.conflicts, 1);
  assert.ok(m.changedLocal && m.changedRemote);
  // nada mudou: nada a fazer
  const again = await merge('brain', m.local, m.remote, m.base, 200);
  assert.ok(!again.changedLocal && !again.changedRemote);
});

test('dois aparelhos pelo Drive: liga com senha, o 2º entra com a senha, notas e atalhos vão e voltam; chaves de API não saem', async () => {
  const drive = fakeDrive();
  const pc = device(); const note2 = device();
  // aparelho 1
  await connected(pc);
  await pc.api.set({
    nt_brain: [note('n1', 'Comprar café', 10)],
    nt_data: { groups: [{ id: 'g', name: 'Principal' }], links: [{ id: 'l1', groupId: 'g', title: 'Gmail', url: 'https://mail.google.com/' }], settings: { userName: 'Ana', ai: { provider: 'gemini', keys: { gemini: 'SEGREDO-API' } } } },
  });
  const S = await import('../../src/lib/sync.js');
  await assert.rejects(S.enableSync({ accountId: 'google:1', mode: 'key', passphrase: 'curta', fetchFn: drive.fetchFn }), /8 caracteres/);
  const r1 = await S.enableSync({ accountId: 'google:1', mode: 'key', passphrase: 'minha senha longa', categories: ['brain', 'shortcuts', 'settings'], fetchFn: drive.fetchFn });
  assert.equal(r1.up, 3);
  const all = [...drive.files.values()].map((f) => f.body).join('');
  assert.ok(!all.includes('Comprar café') && !all.includes('Gmail'), 'na nuvem só há dados cifrados');
  assert.ok(!all.includes('SEGREDO-API'));

  // aparelho 2: sem senha não entra; com senha errada não entra; com a certa, recebe tudo
  await connected(note2);
  await note2.api.set({ nt_data: { groups: [{ id: 'g2', name: 'Principal' }], links: [], settings: { userName: '', ai: { provider: 'gemini', keys: { gemini: 'CHAVE-DO-NOTE' } } } } });
  const info = await S.remoteInfo('google:1', { fetchFn: drive.fetchFn });
  assert.deepEqual([info.exists, info.mode], [true, 'key']);
  await assert.rejects(S.enableSync({ accountId: 'google:1', mode: 'none', fetchFn: drive.fetchFn }), /Digite a senha/);
  await assert.rejects(S.enableSync({ accountId: 'google:1', mode: 'key', passphrase: 'senha errada!!', fetchFn: drive.fetchFn }), WrongKeyError);
  const r2 = await S.enableSync({ accountId: 'google:1', mode: 'key', passphrase: 'minha senha longa', categories: ['brain', 'shortcuts', 'settings'], fetchFn: drive.fetchFn });
  assert.ok(r2.down >= 2);
  assert.equal(note2.db.nt_brain[0].text, 'Comprar café');
  assert.equal(note2.db.nt_data.links[0].title, 'Gmail');
  assert.deepEqual(note2.db.nt_data.groups.map((g) => g.id), ['g'], 'o grupo vazio do aparelho novo não duplica');
  assert.equal(note2.db.nt_data.settings.userName, 'Ana');
  assert.equal(note2.db.nt_data.settings.ai.keys.gemini, 'CHAVE-DO-NOTE', 'a chave de API de cada aparelho fica');

  // edita no 2º, exclui no 1º; sincroniza os dois
  note2.db.nt_brain.push(note('n2', 'Ideia do notebook', 50));
  await S.syncNow({ fetchFn: drive.fetchFn });
  use(pc);
  pc.db.nt_data.links = [];
  await S.syncNow({ fetchFn: drive.fetchFn });
  assert.deepEqual(pc.db.nt_brain.map((i) => i.id).sort(), ['n1', 'n2']);
  use(note2);
  await S.syncNow({ fetchFn: drive.fetchFn });
  assert.equal(note2.db.nt_data.links.length, 0, 'exclusão chegou');
  // sem mudanças: não baixa nem envia de novo
  const before = drive.calls.length;
  const r3 = await S.syncNow({ fetchFn: drive.fetchFn });
  assert.deepEqual([r3.up, r3.down], [0, 0]);
  assert.ok(drive.calls.slice(before).every((c) => c === 'GET /drive/v3/files'), 'só listou os arquivos');
  assert.match(String(note2.db.nt_sync.lastSync), /^\d+$/);

  // apagar da nuvem
  assert.equal(await S.wipeRemote({ fetchFn: drive.fetchFn }), 4);
  assert.equal(drive.files.size, 0);
  assert.equal(note2.db.nt_sync.enabled, false);
});

test('sem senha: os dados ficam legíveis para o Drive (a pessoa escolheu); outro aparelho entra sem senha', async () => {
  const drive = fakeDrive();
  const a = device(); const b = device();
  await connected(a);
  await a.api.set({ nt_habits: { habits: [{ id: 'agua', name: 'Água', target: 8 }], log: { '2026-11-20': { agua: 5 } } } });
  const S = await import('../../src/lib/sync.js');
  await S.enableSync({ accountId: 'google:1', mode: 'none', categories: ['habits'], fetchFn: drive.fetchFn });
  assert.ok([...drive.files.values()].some((f) => f.body.includes('Água')));
  await connected(b);
  await S.enableSync({ accountId: 'google:1', mode: 'key', passphrase: 'qualquer coisa', categories: ['habits'], fetchFn: drive.fetchFn });
  assert.equal(b.db.nt_sync.mode, 'none', 'segue o modo que já está na nuvem');
  assert.equal(b.db.nt_habits.log['2026-11-20'].agua, 5);
});

test('login Google: monta o endereço certo e lê a resposta; erros claros', async () => {
  use(device());
  globalThis.chrome.identity = { getRedirectURL: () => 'https://abc.chromiumapp.org/' };
  const A = await import('../../src/lib/accounts.js');
  const { OAUTH } = await import('../../src/lib/oauth-config.js');
  OAUTH.google.clientId = 'cliente.apps.googleusercontent.com';
  const u = new URL(A.googleAuthUrl({ scopes: ['https://www.googleapis.com/auth/drive.appdata'], state: 'xyz', prompt: 'select_account' }));
  assert.equal(u.searchParams.get('response_type'), 'token');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://abc.chromiumapp.org/');
  assert.equal(u.searchParams.get('include_granted_scopes'), 'true');
  assert.match(u.searchParams.get('scope'), /^openid email profile https:\/\/www\.googleapis\.com\/auth\/drive\.appdata$/);
  const ok = A.parseAuthResponse('https://abc.chromiumapp.org/#state=xyz&access_token=T&expires_in=3599&scope=email%20https://www.googleapis.com/auth/drive.appdata', 'xyz');
  assert.equal(ok.accessToken, 'T');
  assert.ok(ok.scopes.includes('https://www.googleapis.com/auth/drive.appdata'));
  assert.throws(() => A.parseAuthResponse('https://abc.chromiumapp.org/#state=outro&access_token=T', 'xyz'), /inválida/);
  assert.throws(() => A.parseAuthResponse('https://abc.chromiumapp.org/#error=access_denied&state=xyz', 'xyz'), /não autorizou/);
  OAUTH.google.clientId = '';
  await assert.rejects(A.connectGoogle(), /ainda não foi configurado/);
});
