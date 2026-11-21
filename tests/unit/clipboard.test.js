// Área de transferência (#51, 0.7.7): tipos, proteção de senhas, repetidos, prazos, pausa, sites ignorados e o
// gancho do compartilhamento.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = {};
globalThis.chrome = { storage: { local: {
  get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in db).map((k) => [k, structuredClone(db[k])])),
  set: async (o) => { Object.assign(db, structuredClone(o)); },
} } };
const C = await import('../../src/lib/clipboard.js');
const Share = await import('../../src/lib/clipboard-share.js');
const reset = (cfg = {}) => { for (const k of Object.keys(db)) delete db[k]; db[C.CLIP_CFG_KEY] = { ...C.DEFAULT_CFG, ...cfg }; };

test('tipos', () => {
  const cases = {
    'https://mpjbiologo.github.io/NeuroTab/': 'link', 'www.google.com': 'link', 'ana@gmail.com': 'email',
    '(37) 99833-6210': 'phone', '+55 37 99833-6210': 'phone', '#7c5cff': 'color', 'rgb(10, 20, 30)': 'color',
    'const a = 1;\nconsole.log(a);': 'code', 'def f(x):\n    return x * 2': 'code',
    'Comprar pão amanhã': 'text', 'Linha um\nLinha dois': 'text',
  };
  for (const [s, k] of Object.entries(cases)) assert.equal(C.classify(s), k, s);
});

test('proteção: senhas, códigos, chaves e cartões ficam de fora; texto comum e Pix não', () => {
  for (const s of ['482913', '4111 1111 1111 1111', 'Tr0ca@Senha', 'sk-abcdefghijklmnopqrstu', 'AIzaSyA1234567890abcdefghijk', 'eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'])
    assert.ok(C.looksSensitive(s), `devia barrar: ${s}`);
  for (const s of ['Recebido!', 'Olá,Mundo!', 'Reunião às 15h na sala 2', 'https://exemplo.com/Pagina?Id=3&x=Y', 'ana@gmail.com', 'Bom dia!', '00020126580014BR.GOV.BCB.PIX0136abc', '4111 1111 1111 1112', 'paralelepípedo'])
    assert.equal(C.looksSensitive(s), false, `não devia barrar: ${s}`);
});

test('sites ignorados: domínio e subdomínios', () => {
  assert.ok(C.ignoredSite('https://www.itau.com.br/conta', C.DEFAULT_IGNORE));
  assert.ok(C.ignoredSite('https://internetbanking.caixa.gov.br/x', C.DEFAULT_IGNORE));
  assert.ok(!C.ignoredSite('https://naoeitau.com.br/', C.DEFAULT_IGNORE));
  assert.ok(!C.ignoredSite('https://pt.wikipedia.org/', C.DEFAULT_IGNORE));
});

test('guardar: repetido sobe para o topo, eco do mesmo Ctrl+C conta uma vez, origem e aparelho', async () => {
  reset();
  const a = await C.addClip({ text: 'primeiro', via: 'site', source: { url: 'https://pt.wikipedia.org/wiki/X', title: 'X' }, now: 1000 });
  await C.addClip({ text: 'segundo', via: 'monitor', now: 2000 });
  const again = await C.addClip({ text: 'primeiro', via: 'monitor', now: 3000 }); // o acompanhamento pega o mesmo Ctrl+C
  assert.equal(again.duplicate, true);
  let items = await C.loadClips();
  assert.deepEqual(items.map((x) => x.text), ['primeiro', 'segundo']);
  assert.equal(items[0].count, 1, 'site + acompanhamento quase juntos = uma cópia');
  assert.equal(items[0].source.url, 'https://pt.wikipedia.org/wiki/X');
  assert.ok(items[0].deviceId && items[0].origin === 'local');
  await C.addClip({ text: 'primeiro', via: 'monitor', now: 60_000 }); // copiou de novo depois
  items = await C.loadClips();
  assert.equal(items[0].count, 2);
  assert.equal(a.item.kind, 'text');
});

test('recusas: pausado, site ignorado, senha; colar à mão passa', async () => {
  reset({ paused: true });
  assert.equal((await C.addClip({ text: 'x', via: 'monitor' })).skipped, 'paused');
  assert.equal((await C.addClip({ text: 'x', via: 'site' })).skipped, 'paused');
  assert.ok((await C.addClip({ text: 'colado à mão', via: 'paste' })).item);
  reset();
  assert.equal((await C.addClip({ text: 'x', via: 'site', source: { url: 'https://www.nubank.com.br/' } })).skipped, 'site');
  assert.equal((await C.addClip({ text: '482913', via: 'monitor' })).skipped, 'sensitive');
  assert.ok((await C.addClip({ text: '482913', via: 'manual', force: true })).item, 'a pessoa colou de propósito');
  reset({ protect: false });
  assert.ok((await C.addClip({ text: 'Tr0ca@Senha', via: 'monitor' })).item, 'proteção desligada');
});

test('prazos e limites: tempo, "ao desligar", máximo de itens e de imagens; fixados ficam', async () => {
  const H = 3600e3;
  const mk = (i, over = {}) => ({ id: 'i' + i, key: 'k' + i, kind: 'text', text: 't' + i, pinned: false, createdAt: i, updatedAt: i, ...over });
  const now = 100 * H;
  // 1 hora
  let out = C.pruneList([mk(1, { updatedAt: now - 2 * H }), mk(2, { updatedAt: now - 10 * 60e3 }), mk(3, { updatedAt: now - 5 * H, pinned: true })], { ...C.DEFAULT_CFG, retention: '1h' }, now);
  assert.deepEqual(out.map((x) => x.id).sort(), ['i2', 'i3']);
  // "ao desligar": nada sai durante o uso; ao abrir o navegador, só os fixados ficam
  const list = [mk(1, { updatedAt: now - 50 * H }), mk(2, { updatedAt: now - H, pinned: true })];
  assert.equal(C.pruneList(list, C.DEFAULT_CFG, now).length, 2);
  assert.deepEqual(C.pruneList(list, C.DEFAULT_CFG, now, { startup: true }).map((x) => x.id), ['i2']);
  // "nunca": nem ao abrir
  assert.equal(C.pruneList(list, { ...C.DEFAULT_CFG, retention: 'never' }, now, { startup: true }).length, 2);
  // máximo de itens e de imagens
  const many = Array.from({ length: 10 }, (_, i) => mk(i, { updatedAt: now - i, kind: i % 2 ? 'image' : 'text' }));
  out = C.pruneList(many, { ...C.DEFAULT_CFG, max: 6, maxImages: 2 }, now);
  assert.equal(out.filter((x) => x.kind === 'image').length, 2);
  assert.ok(out.length <= 6);
  assert.deepEqual(out.map((x) => x.updatedAt), [...out.map((x) => x.updatedAt)].sort((a, b) => b - a), 'mais recente primeiro');
  // ao abrir o navegador (padrão)
  reset();
  await C.addClip({ text: 'some', via: 'monitor' });
  const keep = await C.addClip({ text: 'fica', via: 'monitor' });
  await C.updateClip(keep.item.id, { pinned: true });
  assert.deepEqual((await C.pruneClips({ startup: true })).map((x) => x.text), ['fica']);
});

test('limpar tudo mantém os fixados; excluir um', async () => {
  reset();
  const a = await C.addClip({ text: 'a', via: 'manual' });
  await C.addClip({ text: 'b', via: 'manual' });
  await C.updateClip(a.item.id, { pinned: true });
  await C.clearClips();
  assert.deepEqual((await C.loadClips()).map((x) => x.text), ['a']);
  await C.removeClip(a.item.id);
  assert.equal((await C.loadClips()).length, 0);
});

test('pesquisa sem acentos e por tipo', () => {
  const items = [{ kind: 'text', text: 'Reunião amanhã' }, { kind: 'link', text: 'https://site.com/reuniao' }, { kind: 'text', text: 'Outra coisa', source: { title: 'Reunião geral' } }];
  assert.equal(C.searchClips(items, 'reuniao').length, 3);
  assert.equal(C.searchClips(items, 'reuniao', 'link').length, 1);
  assert.equal(C.searchClips(items, '').length, 3);
});

test('compartilhamento preparado: sem alvos não envia nada; com alvo ligado envia; não devolve o que veio de fora', async () => {
  assert.deepEqual(await Share.shareItem({ origin: 'local' }, { share: { enabled: true, targets: ['pc'] } }), []);
  const sent = [];
  const off = Share.registerShareTarget({ id: 'pc', name: 'Outro PC', send: async (it) => { sent.push(it.text); } });
  assert.deepEqual(await Share.shareItem({ origin: 'local', text: 'oi' }, { share: { enabled: true, targets: ['pc'] } }), ['pc']);
  assert.deepEqual(await Share.shareItem({ origin: 'remote', text: 'eco' }, { share: { enabled: true, targets: ['pc'] } }), []);
  assert.deepEqual(await Share.shareItem({ origin: 'local', text: 'desligado' }, { share: { enabled: false, targets: ['pc'] } }), []);
  assert.deepEqual(sent, ['oi']);
  off();
  assert.equal(Share.shareTargets().length, 0);
  // um item de outro aparelho entra marcado como remoto
  reset();
  const r = await C.addClip({ text: 'do celular', via: 'remote' });
  assert.equal(r.item.origin, 'remote');
});
