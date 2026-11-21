// E-mail (#20, 0.7.7.4): feed do Gmail, contas abertas no navegador, novos sem repetir aviso, filtros,
// silenciar e desconectar.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = {};
globalThis.chrome = { storage: { local: {
  get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in db).map((k) => [k, structuredClone(db[k])])),
  set: async (o) => { Object.assign(db, structuredClone(o)); },
  remove: async (keys) => { for (const k of [].concat(keys)) delete db[k]; },
} } };
const M = await import('../../src/lib/mail.js');
import { atom } from '../fixtures/gmail-atom.js';

/** Gmail falso: sessões u/0 e u/1; u/2 em diante devolve a u/0 (como o Gmail faz). */
function fakeGmail(sessions) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const m = url.match(/\/mail\/u\/(\d+)\/feed\/atom\/?(.*)$/);
    if (!sessions.length) return { status: 200, ok: true, url: 'https://accounts.google.com/ServiceLogin?x', text: async () => '<html>login</html>' };
    const s = sessions[+m[1]] || sessions[0];
    const list = m[2] === 'important' ? s.entries.filter((e) => e.important) : s.entries;
    return { status: 200, ok: true, url, text: async () => atom(s.email, list, list.length) };
  };
  return { fetchFn, calls };
}
const mk = (id, subject, from, min = 0, extra = {}) => ({ id, subject, from, fromEmail: from.toLowerCase().replace(/\s/g, '') + '@x.com', snippet: 'trecho ' + id, at: new Date(Date.UTC(2026, 10, 21, 12, min)).toISOString(), ...extra });

test('feed do Gmail: conta, não lidos, remetente, assunto, trecho, hora, link (com acentos e entidades)', () => {
  const f = M.parseGmailAtom(atom('Ana@Gmail.com', [mk('1', 'Consulta &amp; retorno — sexta', 'Clínica Harmonize'), mk('2', '<![CDATA[Fatura <março>]]>', 'Banco', 5)], 12));
  assert.equal(f.email, 'ana@gmail.com');
  assert.equal(f.unread, 12);
  assert.deepEqual(f.entries.map((e) => e.subject), ['Consulta & retorno — sexta', 'Fatura <março>']);
  assert.equal(f.entries[0].from, 'Clínica Harmonize');
  assert.equal(f.entries[0].snippet, 'trecho 1');
  assert.equal(f.entries[0].at, Date.UTC(2026, 10, 21, 12, 0));
  assert.match(f.entries[0].link, /message_id=1&view=conv$/);
  assert.equal(M.parseGmailAtom('<html>login</html>'), null);
});

test('acha as contas abertas no navegador e para quando o Gmail repete a u/0; sem sessão = nenhuma', async () => {
  const G = fakeGmail([{ email: 'ana@gmail.com', entries: [] }, { email: 'ana.trabalho@empresa.com', entries: [] }]);
  const found = await M.ADAPTERS.gmail.discover(G.fetchFn);
  assert.deepEqual(found.map((a) => [a.email, a.index]), [['ana@gmail.com', 0], ['ana.trabalho@empresa.com', 1]]);
  assert.equal(G.calls.length, 3, 'u/2 devolveu a u/0: parou');
  assert.deepEqual(await M.ADAPTERS.gmail.discover(fakeGmail([]).fetchFn), []);
  assert.equal(M.ADAPTERS.gmail.feedUrl(1, 'primary'), 'https://mail.google.com/mail/u/1/feed/atom/^sq_ig_i_personal');
  assert.equal(M.ADAPTERS.gmail.composeUrl({ index: 1 }), 'https://mail.google.com/mail/u/1/#inbox?compose=new');
});

test('contas: novas entram ligadas, escolhas ficam, quem saiu fica marcado', () => {
  const merged = M.mergeAccounts({ 'gmail:a@x.com': { provider: 'gmail', email: 'a@x.com', index: 0, show: true, notify: false, filter: 'important' }, 'gmail:velha@x.com': { provider: 'gmail', email: 'velha@x.com', index: 1 } },
    [{ provider: 'gmail', email: 'a@x.com', index: 0 }, { provider: 'gmail', email: 'b@x.com', index: 1 }]);
  assert.deepEqual([merged['gmail:a@x.com'].notify, merged['gmail:a@x.com'].filter], [false, 'important'], 'escolhas ficam');
  assert.deepEqual([merged['gmail:b@x.com'].show, merged['gmail:b@x.com'].notify], [true, true]);
  assert.equal(merged['gmail:velha@x.com'].missing, true);
});

test('verificar: a primeira vez não avisa; depois, só o que é novo; sem repetir; conta que saiu vira aviso no widget', async () => {
  for (const k of Object.keys(db)) delete db[k];
  const sessions = [{ email: 'ana@gmail.com', entries: [mk('1', 'Antigo', 'Fulano')] }, { email: 'ana@empresa.com', entries: [mk('9', 'Reunião', 'Chefe', 1)] }];
  const G = fakeGmail(sessions);
  await M.setMailConfig({ enabled: true });
  let r = await M.checkMail({ fetchFn: G.fetchFn });
  assert.equal(r.fresh.length, 0, 'primeira leitura não avisa o que já estava lá');
  assert.equal(Object.keys(r.cfg.accounts).length, 2);
  sessions[0].entries.unshift(mk('2', 'Consulta confirmada', 'Clínica', 10));
  sessions[1].entries.unshift(mk('10', 'Relatório', 'Equipe', 11));
  r = await M.checkMail({ fetchFn: G.fetchFn });
  assert.deepEqual(r.fresh.map((f) => [f.subject, f.email]).sort(), [['Consulta confirmada', 'ana@gmail.com'], ['Relatório', 'ana@empresa.com']]);
  assert.equal((await M.checkMail({ fetchFn: G.fetchFn })).fresh.length, 0, 'não repete');
  // a lista junta as duas contas, mais novo primeiro
  const cache = await M.mailCache();
  const all = M.allEntries(await M.mailConfig(), cache);
  assert.deepEqual(all.map((e) => e.subject), ['Relatório', 'Consulta confirmada', 'Reunião', 'Antigo']);
  assert.deepEqual(M.allEntries(await M.mailConfig(), cache, 'gmail:ana@empresa.com').map((e) => e.subject), ['Relatório', 'Reunião']);
  // não avisar uma conta
  const cfg = await M.mailConfig();
  cfg.accounts['gmail:ana@empresa.com'].notify = false;
  await M.setMailConfig({ accounts: cfg.accounts });
  sessions[1].entries.unshift(mk('11', 'Spam do trabalho', 'X', 12));
  assert.equal((await M.checkMail({ fetchFn: G.fetchFn })).fresh.length, 0);
  // filtro "só importantes" muda o endereço lido
  cfg.accounts['gmail:ana@gmail.com'].filter = 'important';
  await M.setMailConfig({ accounts: cfg.accounts });
  await M.checkMail({ fetchFn: G.fetchFn });
  assert.equal((await M.mailCache()).byAccount['gmail:ana@gmail.com'].entries.length, 0);
  // a pessoa saiu da conta no Gmail: a u/1 agora devolve outra conta
  sessions.splice(1, 1);
  await M.checkMail({ fetchFn: G.fetchFn });
  assert.match((await M.mailCache()).byAccount['gmail:ana@empresa.com'].error, /não está mais aberta/);
  // desconectar apaga tudo
  await M.forgetMail();
  assert.equal(db.nt_mail, undefined);
  assert.equal(db.nt_mail_cfg, undefined);
});

test('avisos: até 3 separados, mais que isso um resumo; silenciar; desligar', () => {
  const f = (i, email = 'a@x.com') => ({ id: 'id' + i, from: 'Fulano', subject: 'Assunto ' + i, snippet: 'texto', email, link: 'https://mail.google.com/x' + i });
  const cfg = { notify: true, muteUntil: 0 };
  const two = M.notificationsFor([f(1), f(2)], cfg);
  assert.deepEqual(two.map((n) => [n.id.startsWith('mail:'), n.title, n.url]), [[true, '✉️ Fulano', 'https://mail.google.com/x1'], [true, '✉️ Fulano', 'https://mail.google.com/x2']]);
  assert.match(two[0].message, /Assunto 1 — texto/);
  const many = M.notificationsFor([f(1), f(2), f(3), f(4, 'b@x.com')], cfg);
  assert.equal(many.length, 1);
  assert.match(many[0].title, /4 e-mails novos/);
  assert.match(many[0].message, /a@x.com: 3 · b@x.com: 1/);
  assert.deepEqual(M.notificationsFor([f(1)], { ...cfg, muteUntil: Date.now() + 60e3 }), []);
  assert.deepEqual(M.notificationsFor([f(1)], { ...cfg, notify: false }), []);
});

test('erros: sem conexão e limite do Gmail aparecem na conta, sem quebrar as outras', async () => {
  for (const k of Object.keys(db)) delete db[k];
  await M.setMailConfig({ enabled: true, accounts: { 'gmail:a@x.com': { provider: 'gmail', email: 'a@x.com', index: 0, show: true }, 'gmail:b@x.com': { provider: 'gmail', email: 'b@x.com', index: 1, show: true } } });
  const fetchFn = async (url) => (url.includes('/u/0/') ? { status: 429, ok: false, url, text: async () => '' } : { status: 200, ok: true, url, text: async () => atom('b@x.com', [mk('1', 'Oi', 'Bia')]) });
  await M.checkMail({ fetchFn });
  const c = await M.mailCache();
  assert.match(c.byAccount['gmail:a@x.com'].error, /pausa/);
  assert.equal(c.byAccount['gmail:b@x.com'].entries.length, 1);
});
