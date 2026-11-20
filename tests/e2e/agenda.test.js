// Agenda (#26): criar, editar e excluir; agenda por link (Google) com permissão; importar .ics; aviso antes do evento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const dayKey = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toLocaleDateString('sv-SE'); };

const FEED = (d) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Trabalho (Google)\r\nBEGIN:VEVENT\r\nUID:g1@google.com\r\nDTSTART;TZID=America/Sao_Paulo:${d.replace(/-/g, '')}T150000\r\nDTEND;TZID=America/Sao_Paulo:${d.replace(/-/g, '')}T160000\r\nSUMMARY:Reunião com cliente\r\nLOCATION:Google Meet\r\nURL:https://calendar.google.com/event?eid=abc\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

async function setup(x) {
  await x.ctx.addInitScript(() => { if (globalThis.chrome?.permissions) { chrome.permissions.request = async () => true; chrome.permissions.contains = async () => true; } });
  const p = await x.open('src/newtab.html');
  const data = await x.storage(p, 'nt_data');
  data.settings.widgets = [{ id: 'agenda', w: 12 }];
  await x.seed(p, { nt_data: data });
  return p;
}
const card = (p) => p.locator('.widget[data-id="agenda"]');

test('compromisso: criar, aparecer em Próximos e no Mês, editar e excluir', async () => {
  const x = await launch();
  try {
    const p = await setup(x);
    await card(p).locator('.empty').waitFor();
    await card(p).locator('button[title="Novo compromisso"]').click();
    const dlg = p.locator('dialog.ag-dlg[open]');
    await dlg.locator('input[name="title"]').fill('Consulta de retorno');
    await dlg.locator('input[type="date"]').first().fill(dayKey(1));
    await dlg.locator('input[type="time"]').first().fill('14:00');
    await dlg.locator('input[type="date"]').nth(1).fill(dayKey(1));
    await dlg.locator('input[type="time"]').nth(1).fill('14:50');
    await dlg.locator('label:has-text("Local") input').fill('Clínica Harmonize');
    await dlg.locator('button[value="ok"]').click();
    await card(p).locator('.ag-ev:has-text("Consulta de retorno")').waitFor();
    assert.match(await card(p).locator('.ag-ev:has-text("Consulta de retorno")').textContent(), /14:00.*Clínica Harmonize/);
    const saved = (await x.storage(p, 'nt_calendar')).events[0];
    assert.equal(saved.start, `${dayKey(1)}T14:00`);
    assert.equal(saved.alarm, 10, 'aviso padrão de 10 min');

    await card(p).locator('.ag-views button:has-text("Mês")').click();
    await card(p).locator('.ag-cell .ag-ev:has-text("Consulta de retorno")').waitFor();

    // editar: vira semanal
    await card(p).locator('.ag-cell .ag-ev:has-text("Consulta de retorno")').click();
    await p.locator('dialog.ag-dlg[open] select').first().selectOption('WEEKLY');
    await p.locator('dialog.ag-dlg[open] button[value="ok"]').click();
    await p.waitForTimeout(300);
    assert.equal((await x.storage(p, 'nt_calendar')).events[0].rrule.freq, 'WEEKLY');

    // excluir todas as repetições
    await card(p).locator('.ag-cell .ag-ev:has-text("Consulta de retorno")').first().click();
    await p.locator('dialog.ag-dlg[open] button:has-text("Excluir")').click();
    await p.waitForTimeout(300);
    assert.equal((await x.storage(p, 'nt_calendar')).events.length, 0);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('Google Agenda por link: pede acesso ao site, baixa, mostra só leitura com "abrir no serviço"; erro claro com link errado', async () => {
  const x = await launch();
  try {
    await x.ctx.route('https://calendar.google.com/calendar/ical/**', (r) => r.fulfill({ status: 200, contentType: 'text/calendar', body: FEED(dayKey(1)) }));
    await x.ctx.route('https://example.com/nao-e-agenda', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>oi</html>' }));
    const p = await setup(x);
    await card(p).locator('button[title^="Agendas"]').click();
    const dlg = p.locator('dialog.ag-dlg[open]');
    await dlg.locator('input[type="url"]').fill('https://example.com/nao-e-agenda');
    await dlg.locator('button:has-text("Adicionar")').click();
    await dlg.locator('p.err').waitFor();
    assert.match(await dlg.locator('p.err').textContent(), /não é de uma agenda \.ics/);

    await dlg.locator('input[type="url"]').fill('webcal://calendar.google.com/calendar/ical/abc%40group/private-xyz/basic.ics');
    await dlg.locator('button:has-text("Adicionar")').click();
    await dlg.locator('.ag-cal:has-text("Trabalho (Google)")').waitFor();
    assert.match(await dlg.locator('p[role="status"]').textContent(), /Trabalho \(Google\): 1 evento/);
    await dlg.locator('button[value="ok"]').click();

    const ev = card(p).locator('.ag-ev.ext:has-text("Reunião com cliente")');
    await ev.waitFor();
    await ev.click();
    const view = p.locator('dialog.ag-dlg[open]');
    assert.match(await view.textContent(), /só leitura/);
    assert.equal(await view.locator('a:has-text("Abrir no serviço")').getAttribute('href'), 'https://calendar.google.com/event?eid=abc');
    // copiar para a agenda local abre o formulário de novo compromisso já preenchido
    await view.locator('button:has-text("Copiar para minha agenda")').click();
    const form = p.locator('dialog.ag-dlg[open]');
    assert.equal(await form.locator('input[name="title"]').inputValue(), 'Reunião com cliente');
    assert.match(await form.locator('h2').textContent(), /Novo compromisso/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('importar .ics, aviso antes do compromisso e "o que tenho hoje" com a agenda', async () => {
  const x = await launch();
  try {
    const p = await setup(x);
    // importar arquivo
    await card(p).locator('button[title^="Agendas"]').click();
    await p.locator('dialog.ag-dlg[open] input[type="file"]').setInputFiles({ name: 'agenda.ics', mimeType: 'text/calendar', buffer: Buffer.from(FEED(dayKey(2))) });
    await p.locator('dialog.ag-dlg[open] p[role="status"]:has-text("importado")').waitFor();
    await p.locator('dialog.ag-dlg[open] button[value="ok"]').click();
    assert.equal((await x.storage(p, 'nt_calendar')).events[0].title, 'Reunião com cliente');

    // aviso: compromisso daqui a 3 min com aviso de 2 min → alarme agendado pelo fundo
    const soon = await p.evaluate(async () => {
      const m = await import('/src/lib/calendar.js');
      const start = Date.now() + 3 * 60e3;
      const ev = await m.saveEvent({ title: 'Ligar para o banco', start: m.tsToKey(start), end: m.tsToKey(start + 30 * 60e3), alarm: 2 });
      return ev.id;
    });
    let alarms = [];
    for (let i = 0; i < 20 && !alarms.length; i++) {
      await p.waitForTimeout(250);
      alarms = (await p.evaluate(() => chrome.alarms.getAll())).filter((a) => a.name.startsWith('cal-') && a.name.includes(soon));
    }
    assert.equal(alarms.length, 1, 'alarme do aviso criado');
    // o início é guardado em minutos (arredonda para baixo): o aviso fica entre agora e 1 min
    const delta = alarms[0].scheduledTime - Date.now();
    assert.ok(delta > 0 && delta <= 61e3, 'aviso em até 1 min: ' + delta);

    // pergunta rápida
    const r = await p.evaluate(async () => (await import('/src/lib/assistant.js')).runCommand('o que tenho pra hoje', { items: () => [] }, 'pt'));
    assert.match(r.reply, /Agenda de hoje: \d\d:\d\d Ligar para o banco/);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
