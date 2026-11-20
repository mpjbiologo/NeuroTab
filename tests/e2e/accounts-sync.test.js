// Contas e sincronização (#27), com o login do Google e o Drive simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

function fakeGoogle(x) {
  const files = new Map();
  let n = 0;
  const calls = [];
  const cors = { 'access-control-allow-origin': '*' };
  const json = (r, o, status = 200) => r.fulfill({ status, json: o, headers: cors });
  x.ctx.route('https://www.googleapis.com/oauth2/v3/userinfo', (r) => json(r, { sub: '42', email: 'ana@gmail.com', name: 'Ana Souza', picture: '' }));
  x.ctx.route('https://oauth2.googleapis.com/revoke**', (r) => { calls.push('revoke'); json(r, {}); });
  x.ctx.route(/https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\/files.*/, (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const m = req.method();
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    calls.push(`${m} ${u.pathname}`);
    if (!/^Bearer tok-/.test(req.headers().authorization || '')) return json(r, {}, 401);
    if (u.pathname === '/drive/v3/files' && m === 'GET') return json(r, { files: [...files.values()].map(({ id, name, version }) => ({ id, name, version })) });
    let mm = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/);
    if (mm) {
      const f = files.get(mm[1]);
      if (!f) return json(r, {}, 404);
      if (m === 'DELETE') { files.delete(mm[1]); return r.fulfill({ status: 204, headers: cors }); }
      return u.searchParams.get('alt') === 'media' ? r.fulfill({ status: 200, body: f.body, contentType: 'application/json', headers: cors }) : json(r, { version: f.version });
    }
    if (u.pathname === '/upload/drive/v3/files' && m === 'POST') {
      const body = req.postData();
      const parts = body.split(/--nt\w+/).filter((p) => p.includes('{'));
      const meta = JSON.parse(parts[0].slice(parts[0].indexOf('{')).trim());
      const id = 'f' + ++n;
      files.set(id, { id, name: meta.name, version: '1', body: parts[1].slice(parts[1].indexOf('{')).trim() });
      return json(r, { id, version: '1' });
    }
    mm = u.pathname.match(/^\/upload\/drive\/v3\/files\/(\w+)$/);
    if (mm && m === 'PATCH') { const f = files.get(mm[1]); f.body = req.postData(); f.version = String(+f.version + 1); return json(r, { id: f.id, version: f.version }); }
    return json(r, {}, 400);
  });
  return { files, calls };
}

// "Login" do Google: devolve um token com os escopos pedidos (o navegador real abre a janela do Google).
const fakeIdentity = () => {
  if (!globalThis.chrome?.runtime) return;
  chrome.permissions.request = async () => true;
  chrome.permissions.contains = async () => true;
  chrome.identity = {
    getRedirectURL: () => 'https://teste.chromiumapp.org/',
    launchWebAuthFlow: async ({ url }) => {
      const u = new URL(url);
      window.__authUrls = [...(window.__authUrls || []), url];
      return `https://teste.chromiumapp.org/#access_token=tok-${Date.now()}&expires_in=3600&token_type=Bearer&scope=${encodeURIComponent(u.searchParams.get('scope'))}&state=${u.searchParams.get('state')}`;
    },
  };
};

test('conectar conta Google, ligar sincronização com senha, sincronizar, apagar da nuvem e desconectar', async () => {
  const x = await launch();
  try {
    const g = fakeGoogle(x);
    await x.ctx.addInitScript(fakeIdentity);
    const p = await x.open('src/newtab.html');
    await x.seed(p, { nt_brain: [{ id: 'n1', type: 'note', title: 'Receita de pão', text: 'Farinha, água e sal', tags: [], createdAt: 1, updatedAt: 1 }] });

    const o = await x.open('src/options.html#contas');
    await o.waitForSelector('#tab-contas:not([hidden])');
    // client ID já no código: botão ligado, sem aviso
    assert.equal(await o.isDisabled('button:has-text("Conectar conta Google")'), false);
    assert.doesNotMatch(await o.textContent('#tab-contas'), /ainda está sendo liberado/);
    assert.match(await o.textContent('#redirectUrl'), /teste\.chromiumapp\.org/);
    // com o ID no código, o campo de teste some
    assert.equal(await o.locator('#clientOverride').count(), 0);

    await o.click('button:has-text("Conectar conta Google")');
    await o.waitForSelector('.acc:has-text("ana@gmail.com")');
    const first = new URL((await o.evaluate(() => window.__authUrls))[0]);
    assert.equal(first.searchParams.get('client_id'), '913281965961-kon02e6bh3tnfugcci53c65oiqvdpo12.apps.googleusercontent.com');
    assert.equal(first.searchParams.get('prompt'), 'select_account');
    assert.ok(!first.searchParams.get('scope').includes('drive'), 'no login, só a identidade; o Drive é pedido ao ligar a sincronização');

    // ligar a sincronização com senha
    await o.waitForSelector('input[name="syncMode"][value="key"]');
    await o.fill('.sync-box input[type="password"] >> nth=0', 'senha bem longa 123');
    await o.fill('.sync-box input[type="password"] >> nth=1', 'senha bem longa 123');
    await o.click('button:has-text("Ligar sincronização")');
    // a mensagem final só aparece quando todos os envios terminaram
    await o.waitForSelector('#tab-contas p[role="status"]:has-text("Sincronização ligada:")', { timeout: 30000 });
    const names = [...g.files.values()].map((f) => f.name).sort();
    assert.deepEqual(names, ['nt-agenda.json', 'nt-brain.json', 'nt-habits.json', 'nt-settings.json', 'nt-shortcuts.json', 'nt-sync-meta.json']);
    const brain = [...g.files.values()].find((f) => f.name === 'nt-brain.json').body;
    assert.ok(!brain.includes('Receita') && JSON.parse(brain).alg === 'A256GCM', 'nota criptografada na nuvem');
    const urls = await o.evaluate(() => window.__authUrls);
    assert.ok(urls.some((u) => new URL(u).searchParams.get('scope').includes('drive.appdata')), 'pediu a permissão do Drive ao ligar');
    const cfg = await x.storage(o, 'nt_sync');
    assert.deepEqual([cfg.enabled, cfg.mode, cfg.accountId], [true, 'key', 'google:42']);

    // nova nota → sincronizar agora → vai para a nuvem
    await x.seed(o, { nt_brain: [{ id: 'n1', type: 'note', title: 'Receita de pão', text: 'Farinha, água e sal', tags: [], createdAt: 1, updatedAt: 1 }, { id: 'n2', type: 'note', title: 'Nova', text: 'Nova nota', tags: [], createdAt: 2, updatedAt: 2 }] }, { reload: false });
    const v0 = [...g.files.values()].find((f) => f.name === 'nt-brain.json').version;
    await o.click('button:has-text("Sincronizar agora")');
    await o.waitForSelector('#tab-contas p[role="status"]:has-text("enviado")');
    assert.notEqual([...g.files.values()].find((f) => f.name === 'nt-brain.json').version, v0);

    // apagar da nuvem e desconectar (revoga)
    await o.click('button:has-text("Apagar dados da nuvem")');
    await o.waitForSelector('#tab-contas :text("apagado(s) da nuvem")');
    assert.equal(g.files.size, 0);
    assert.equal((await x.storage(o, 'nt_sync')).enabled, false);
    await o.click('.acc button:has-text("Desconectar")');
    await o.waitForSelector('#tab-contas .empty:has-text("Nenhuma conta")');
    assert.ok(g.calls.includes('revoke'));
    assert.equal(Object.keys((await x.storage(o, 'nt_account_tokens')) || {}).length, 0, 'acesso apagado deste navegador');
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
