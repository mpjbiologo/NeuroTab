// Agenda pela conta Google (0.7.6.2): conectar no widget, escolher agendas, ver, criar e excluir lá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const dayKey = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toLocaleDateString('sv-SE'); };

const fakeIdentity = () => {
  if (!globalThis.chrome?.runtime) return;
  chrome.permissions.request = async () => true;
  chrome.permissions.contains = async () => true;
  chrome.identity = {
    getRedirectURL: () => 'https://teste.chromiumapp.org/',
    launchWebAuthFlow: async ({ url }) => {
      const u = new URL(url);
      return `https://teste.chromiumapp.org/#access_token=tok-1&expires_in=3600&token_type=Bearer&scope=${encodeURIComponent(u.searchParams.get('scope'))}&state=${u.searchParams.get('state')}`;
    },
  };
};

function fakeCalendar(x) {
  const cors = { 'access-control-allow-origin': '*' };
  const json = (r, o, status = 200) => r.fulfill({ status, json: o, headers: cors });
  const t1 = new Date(); t1.setDate(t1.getDate() + 1); t1.setHours(10, 0, 0, 0);
  const events = [{ id: 'g1', summary: 'Reunião do Google', start: { dateTime: t1.toISOString() }, end: { dateTime: new Date(+t1 + 36e5).toISOString() }, hangoutLink: 'https://meet.google.com/abc', htmlLink: 'https://calendar.google.com/e/g1' }];
  const calls = [];
  x.ctx.route('https://www.googleapis.com/oauth2/v3/userinfo', (r) => json(r, { sub: '42', email: 'ana@gmail.com', name: 'Ana' }));
  x.ctx.route(/https:\/\/www\.googleapis\.com\/calendar\/v3\/.*/, (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const m = req.method();
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    calls.push(`${m} ${decodeURIComponent(u.pathname)}`);
    if (u.pathname.endsWith('/calendarList')) return json(r, { items: [{ id: 'ana@gmail.com', summary: 'Ana', accessRole: 'owner', primary: true, backgroundColor: '#3f8fe0', timeZone: 'America/Sao_Paulo' }, { id: 'pt.brazilian#holiday', summary: 'Feriados no Brasil', accessRole: 'reader' }] });
    if (m === 'GET') return json(r, { items: decodeURIComponent(u.pathname).includes('ana@gmail.com') ? events : [] });
    if (m === 'POST') { const b = JSON.parse(req.postData()); const it = { id: 'g' + (events.length + 1), status: 'confirmed', ...b }; events.push(it); return json(r, it); }
    if (m === 'DELETE') { const id = u.pathname.split('/').pop(); events.splice(events.findIndex((e) => e.id === id), 1); return r.fulfill({ status: 204, headers: cors }); }
    return json(r, {}, 400);
  });
  return { events, calls };
}

test('agenda do Google: conectar, escolher agendas, ver, criar lá e excluir', async () => {
  const x = await launch();
  try {
    await x.ctx.addInitScript(fakeIdentity);
    const G = fakeCalendar(x);
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.widgets = [{ id: 'agenda', w: 12 }];
    await x.seed(p, { nt_data: data }, { reload: true });
    const card = p.locator('.widget[data-id="agenda"]');

    await card.locator('button[title*="conta Google"]').click();
    await p.locator('dialog[open] button:has-text("Conectar conta Google")').click();
    // escolha das agendas: a principal vem marcada
    const pick = p.locator('dialog[open]:has-text("ana@gmail.com")');
    await pick.locator('.ag-cal:has-text("Feriados no Brasil")').waitFor();
    assert.equal(await pick.locator('.ag-cal:has-text("Ana") input').isChecked(), true);
    assert.equal(await pick.locator('.ag-cal:has-text("Feriados") input').isChecked(), false);
    await pick.locator('button:has-text("Salvar")').click();
    await p.locator('dialog[open] .ag-cal:has-text("Google")').waitFor();
    const acc = await x.storage(p, 'nt_accounts');
    assert.ok(acc.accounts[0].scopes.includes('https://www.googleapis.com/auth/calendar.events'), 'pediu a permissão da agenda');
    await p.locator('dialog[open] button[value="ok"]:has-text("Fechar")').click();

    await card.locator('.ag-ev:has-text("Reunião do Google")').waitFor();
    // criar na agenda do Google
    await card.locator('button[title="Novo compromisso"]').click();
    const dlg = p.locator('dialog.ag-dlg[open]');
    await dlg.locator('input[name="title"]').fill('Retorno no Google');
    await dlg.locator('label:has-text("Agenda") select').selectOption({ label: 'Ana' });
    await dlg.locator('input[type="date"]').first().fill(dayKey(2));
    await dlg.locator('input[type="time"]').first().fill('15:00');
    await dlg.locator('input[type="date"]').nth(1).fill(dayKey(2));
    await dlg.locator('input[type="time"]').nth(1).fill('15:50');
    await dlg.locator('button[value="ok"]').click();
    await card.locator('.ag-ev:has-text("Retorno no Google")').waitFor();
    const made = G.events.find((e) => e.summary === 'Retorno no Google');
    assert.deepEqual(made.start, { dateTime: `${dayKey(2)}T15:00:00`, timeZone: made.start.timeZone });
    assert.deepEqual(made.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
    assert.equal((await x.storage(p, 'nt_calendar')).events.length, 0, 'não foi para Minha agenda');

    // abrir e excluir
    await card.locator('.ag-ev:has-text("Retorno no Google")').click();
    await p.locator('dialog.ag-dlg[open] button:has-text("Excluir")').click();
    await card.locator('.ag-ev:has-text("Retorno no Google")').waitFor({ state: 'detached' });
    assert.ok(G.calls.some((c) => /^DELETE .*\/events\/g2$/.test(c)));
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
