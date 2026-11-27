// Mídias nos seus aparelhos (0.9.3.2, #80): regras, formato, cifra dos arquivos, anexos do ntfy e da nuvem,
// e a caixa "Do celular" (com fotos entrando na biblioteca).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './setup.js';
import { memory, resetStorage } from './setup.js';

const M = await import('../../src/lib/media-share.js');
const B = await import('../../src/lib/bytes-crypto.js');
const S = await import('../../src/lib/clipboard-share.js');
const Tr = await import('../../src/lib/clipboard-transports.js');

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const post = (id, at, media = {}) => ({ id, type: 'media', createdAt: at, url: 'https://x.com/a/status/1', title: 'Post ' + id, summary: 'Resumo ' + id, media: { platform: 'x', ...media } });
const cap = (id, at, size = 10) => ({ id, capturedAt: at, fileName: 'foto ' + id, pageUrl: 'https://site.test/p', blob: new Blob([new Uint8Array(size)], { type: 'image/png' }) });

test('a página do celular (docs/cola) usa a mesma cifra de arquivos da extensão', () => {
  const a = readFileSync(new URL('../../src/lib/bytes-crypto.js', import.meta.url), 'utf8');
  const b = readFileSync(new URL('../../docs/cola/bytes-crypto.js', import.meta.url), 'utf8');
  assert.equal(b, a, 'rode: cp src/lib/bytes-crypto.js docs/cola/bytes-crypto.js');
});

test('cifra de arquivos: ida e volta, chave errada avisa, sem chave passa direto', async () => {
  const key = S.keyB64(S.newShareKey());
  const data = new TextEncoder().encode('vídeo de teste');
  const sealed = await B.sealBytes(data, key);
  assert.ok(B.isSealed(sealed));
  assert.ok(!new TextDecoder().decode(sealed).includes('vídeo'), 'o servidor só vê bytes embaralhados');
  assert.deepEqual(await B.openBytes(sealed, key), data);
  await assert.rejects(B.openBytes(sealed, S.keyB64(S.newShareKey())), (e) => e.code === 'wrong_key');
  await assert.rejects(B.openBytes(sealed, ''), (e) => e.code === 'wrong_key');
  assert.deepEqual(await B.sealBytes(data, ''), data, 'sincronização sem senha: sem cifra');
  assert.deepEqual(await B.openBytes(data, key), data, 'arquivo sem cifra abre como veio');
});

test('rede local: as 20 mais recentes, mais as mandadas com 📤 (mesmo antigas), do mais antigo ao mais novo', () => {
  const items = Array.from({ length: 25 }, (_, i) => post('p' + i, 1000 + i));
  items.push({ ...post('apagado', 9999), deletedAt: 1 }, { id: 'nota', type: 'note', createdAt: 9999 });
  const caps = [cap('c1', 2000), cap('c2', 500)];
  const list = M.lanMediaEntries(items, caps, { requested: { 'post:p0': { at: 1 } } });
  assert.equal(list.length, 21);
  assert.equal(list.at(-1).id, 'c1', 'imagem nova no fim (mais nova)');
  assert.ok(list.some((e) => e.id === 'p0'), 'pedida com 📤 entra mesmo antiga');
  assert.ok(!list.some((e) => e.id === 'apagado' || e.id === 'nota' || e.id === 'c2'));
  assert.ok(list.every((e, i) => i === 0 || list[i - 1].at <= e.at || e.id === 'p0'));
});

test('arquivos do item: vídeo, áudio e fotos baixados, com tipo pelo nome', () => {
  const it = post('v', 1, { download: { file: '/home/u/Downloads/NeuroTab/Videos/a b.mp4', size: 5 }, audio: { file: 'C:\\Users\\u\\Downloads\\NeuroTab\\Audios\\a.m4a' }, photos: { files: ['/d/1.jpg', '/d/2.webp'] } });
  const fs = M.filesOf(it);
  assert.deepEqual(fs.map((f) => [f.name, f.mime]), [['a b.mp4', 'video/mp4'], ['a.m4a', 'audio/mp4'], ['1.jpg', 'image/jpeg'], ['2.webp', 'image/webp']]);
  assert.equal(fs[0].size, 5);
  assert.deepEqual(M.filesOf({ media: {} }), []);
});

test('limites por caminho e o que não cabe vira link e resumo', () => {
  const share = S.shareConfig({ share: {} });
  assert.equal(M.limitFor('cloud', share), 25 * M.MB, 'padrão: 25 MB');
  assert.equal(M.limitFor('cloud', { media: { cloudMaxMB: 100 } }), 100 * M.MB);
  assert.equal(M.limitFor('ntfy', share), 15 * M.MB);
  assert.equal(M.limitFor('telegram', share), 50 * M.MB);
  assert.deepEqual(M.mediaShareConfig({ media: { cloudMaxMB: 'x', cloudDays: 999 } }), { cloudMaxMB: 25, cloudDays: 7 }, 'valores ruins voltam ao padrão');
  const { fit, skipped } = M.fitFiles([{ name: 'a', size: 10 }, { name: 'grande', size: 30 }, { name: 'sem tamanho', size: 0 }], 20);
  assert.deepEqual(fit.map((f) => f.name), ['a']);
  assert.deepEqual(skipped.map((f) => f.name), ['grande', 'sem tamanho']);
  const p = M.mediaPayload({ kind: 'post', id: 'v', at: 5, item: post('v', 5) }, { id: 'pc', name: 'Notebook' }, [], { skipped });
  assert.equal(p.kind, 'media');
  assert.match(p.text, /^📎 Post v\nhttps:\/\/x\.com/);
  assert.match(p.text, /grandes demais/, 'aparelho antigo vê o aviso no texto');
  assert.equal(p.media.summary, 'Resumo v');
});

test('envelope recebido é validado (nunca confia no formato)', () => {
  assert.equal(M.cleanMediaPayload({ kind: 'text' }), null);
  const p = M.cleanMediaPayload({ kind: 'media', id: 'x', from: { id: 'cel', name: 'Pixel' }, media: { title: 'T', url: 'javascript:alert(1)' }, files: [
    { id: '0', name: 'a.jpg', mime: 'image/jpeg', size: 3, drive: '1AbCdEfGhIjK', ntfy: 'http://inseguro' }, { name: 'sem id' }] });
  assert.equal(p.media.url, '', 'só http(s)');
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0].drive, '1AbCdEfGhIjK');
  assert.equal(p.files[0].ntfy, '', 'anexo só por https');
});

test('nuvem: só apaga as mídias da NeuroTab que passaram do prazo', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const list = [
    { id: '1', name: 'nt-media-a', modifiedTime: '2026-11-10T00:00:00Z' },
    { id: '2', name: 'nt-media-b', modifiedTime: '2026-11-26T00:00:00Z' },
    { id: '3', name: 'nt-clipboard.json', modifiedTime: '2026-01-01T00:00:00Z' },
  ];
  assert.deepEqual(M.expiredCloudFiles(list, 7, now).map((f) => f.id), ['1']);
});

test('🔔 ntfy: anexo cifrado sobe e volta; o anexo não aparece como texto na leitura', async () => {
  const files = new Map();
  const msgs = [];
  let n = 0;
  const fetchFn = async (url, opts = {}) => {
    if (opts.method === 'PUT') {
      const id = 'f' + ++n;
      files.set(id, new Uint8Array(await new Response(opts.body).arrayBuffer()));
      msgs.push({ id, event: 'message', tags: [opts.headers.Tags], message: 'arquivo' });
      return json({ id, attachment: { url: `https://ntfy.test/file/${id}.bin` } });
    }
    if (opts.method === 'POST') { const id = 'm' + ++n; msgs.push({ id, event: 'message', message: opts.body }); return json({ id }); }
    const m = String(url).match(/\/file\/(\w+)\.bin$/);
    if (m) return new Response(files.get(m[1]));
    return new Response(msgs.map((x) => JSON.stringify(x)).join('\n'));
  };
  const key = S.newShareKey();
  const cfg = { server: 'https://ntfy.test', topic: 'nt-x', key };
  const A = Tr.ntfyTransport(cfg, { fetchFn, me: { id: 'pc', name: 'PC' } });
  const Cel = Tr.ntfyTransport(cfg, { fetchFn, me: { id: 'cel', name: 'Cel' } });
  const bytes = new TextEncoder().encode('foto secreta');
  const ref = await A.putFile(bytes);
  assert.ok(ref.ntfy.startsWith('https://') && ref.enc);
  assert.ok(!new TextDecoder().decode(files.get('f1')).includes('secreta'), 'o servidor guarda só bytes cifrados');
  await A.send(M.mediaPayload({ kind: 'image', id: 'c', at: 1, capture: cap('c', 1) }, { id: 'pc', name: 'PC' }, [{ id: '0', name: 'foto.png', mime: 'image/png', size: 12, ...ref }]));
  const got = await Cel.poll({});
  assert.equal(got.items.length, 1, 'o evento do anexo não vira item de texto');
  assert.equal(got.items[0].kind, 'media');
  assert.deepEqual(await Cel.getFile(got.items[0].files[0]), bytes);
});

test('☁️ nuvem: arquivo binário cifrado na pasta oculta e leitura de volta', async () => {
  const scopes = ['https://www.googleapis.com/auth/drive.appdata'];
  resetStorage({
    nt_accounts: { accounts: [{ id: 'google:1', provider: 'google', email: 'ana@gmail.com', scopes }] },
    nt_account_tokens: { 'google:1': { accessToken: 'tok', expiresAt: Date.now() + 3600e3, scopes } },
  });
  const store = new Map();
  let n = 0;
  const fetchFn = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('uploadType=multipart')) {
      const raw = new Uint8Array(await new Response(opts.body).arrayBuffer());
      const txt = new TextDecoder('latin1').decode(raw);
      const start = txt.indexOf('application/octet-stream\r\n\r\n') + 'application/octet-stream\r\n\r\n'.length;
      const end = txt.lastIndexOf('\r\n--');
      const id = 'drv' + String(++n).padStart(10, '0');
      store.set(id, { name: JSON.parse(txt.slice(txt.indexOf('{'), txt.indexOf('}') + 1)).name, bytes: raw.slice(start, end) });
      return json({ id, version: '1' });
    }
    const m = u.match(/files\/(drv\d+)\?alt=media/);
    if (m) return new Response(store.get(m[1]).bytes);
    return json({ files: [...store].map(([id, f]) => ({ id, name: f.name, modifiedTime: new Date().toISOString() })) });
  };
  const key = S.keyB64(S.newShareKey());
  const tr = Tr.cloudTransport({ accountId: 'google:1', key, fetchFn });
  const bytes = new TextEncoder().encode('áudio do computador');
  const ref = await tr.putFile(bytes);
  assert.ok(ref.drive && ref.enc);
  const saved = store.get(ref.drive);
  assert.match(saved.name, /^nt-media-/);
  assert.ok(B.isSealed(saved.bytes), 'na nuvem fica cifrado');
  assert.deepEqual(await tr.getFile(ref), bytes);
  assert.equal((await tr.list()).length, 1);
});

test('caixa "Do celular": entrada por arquivo, sem repetir', () => {
  resetStorage({});
  const p = M.cleanMediaPayload({ kind: 'media', id: 'up1', at: 9, from: { id: 'cel', name: 'Pixel' }, media: { title: 'foto.jpg' }, files: [{ id: '0', name: 'foto.jpg', mime: 'image/jpeg', size: 4 }] });
  const [e] = M.inboxEntries(p, 'Rede local', { path: '/home/u/Downloads/NeuroTab/Do celular/foto.jpg' });
  assert.equal(e.id, 'up1:0');
  assert.equal(e.from, 'Pixel');
  assert.ok(e.savedAt, 'pela rede local já chega salvo na pasta');
  const [n] = M.inboxEntries({ ...p, files: [{ ...p.files[0], ntfy: 'https://ntfy.test/f.bin' }] }, 'ntfy');
  assert.equal(n.savedAt, 0, 'pela internet: salvar quando a pessoa pedir');
  assert.ok(memory);
});
