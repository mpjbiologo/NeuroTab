// E-mail (#20, 0.7.7.4): conectar o Gmail (sessão do navegador, Gmail simulado), duas contas, filtro por conta,
// abrir a mensagem, virar tarefa, aviso de e-mail novo e desconectar apagando tudo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, extWith } from './helpers.js';
import { atom } from '../fixtures/gmail-atom.js';

const mk = (id, subject, from, min) => ({ id, subject, from, fromEmail: 'x@x.com', snippet: 'Trecho de ' + subject, at: new Date(Date.now() - min * 60e3).toISOString() });

test('widget de e-mail: duas contas, abrir, tarefa, aviso de novo, desconectar', async () => {
  const ext = extWith((m) => { m.host_permissions.push('https://mail.google.com/*'); });
  const x = await launch({ ext });
  try {
    const sessions = [
      { email: 'ana@gmail.com', entries: [mk('1', 'Consulta confirmada', 'Clínica Harmonize', 5)] },
      { email: 'ana@empresa.com', entries: [mk('9', 'Relatório semanal', 'Equipe', 30)] },
    ];
    await x.ctx.route(/https:\/\/mail\.google\.com\/mail\/u\/\d+\/feed\/atom.*/, (r) => {
      const i = +r.request().url().match(/\/u\/(\d+)\//)[1];
      const s = sessions[i] || sessions[0];
      return r.fulfill({ status: 200, contentType: 'application/atom+xml; charset=utf-8', body: atom(s.email, s.entries) });
    });
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.widgets = [{ id: 'email', w: 6 }];
    await x.seed(p, { nt_data: data }, { reload: true });
    const card = p.locator('.widget[data-id="email"]');
    await card.locator('button:has-text("Conectar o Gmail")').click();
    await card.locator('.mail-item').nth(1).waitFor({ timeout: 10000 });
    // duas contas, cada uma com seus não lidos; a mais nova em cima
    assert.deepEqual(await card.locator('.mail-chip').allTextContents(), ['Todas 2', 'ana@gmail.com 1', 'ana@empresa.com 1']);
    assert.match(await card.locator('.mail-item').first().textContent(), /Clínica Harmonize.*Consulta confirmada/s);
    assert.match(await card.locator('.mail-item .mail-main').first().getAttribute('href'), /message_id=1/);
    // filtrar por conta
    await card.locator('.mail-chip:has-text("ana@empresa.com")').click();
    assert.equal(await card.locator('.mail-item').count(), 1);
    await card.locator('.mail-chip:has-text("Todas")').click();
    // virar tarefa
    await card.locator('.mail-item').first().hover();
    await card.locator('.mail-item').first().locator('.mail-task').click();
    await p.waitForTimeout(300);
    const task = (await x.storage(p, 'nt_brain')).find((b) => b.type === 'task');
    assert.match(task.text, /Responder: Consulta confirmada \(Clínica Harmonize\)/);
    // chega um e-mail novo → aviso do navegador, sem repetir
    sessions[0].entries.unshift(mk('2', 'Exame pronto', 'Laboratório', 0));
    const sw = x.ctx.serviceWorkers()[0];
    await sw.evaluate(() => { globalThis.__notes = []; const orig = chrome.notifications.create; chrome.notifications.create = (id, o) => { globalThis.__notes.push([id, o.title, o.message, o.contextMessage]); return orig.call(chrome.notifications, id, o); }; });
    await card.locator('..').locator('button[title="Verificar agora"]').click();
    await card.locator('.mail-item:has-text("Exame pronto")').waitFor();
    let notes = await sw.evaluate(() => globalThis.__notes);
    assert.equal(notes.length, 1);
    assert.deepEqual(notes[0].slice(1), ['✉️ Laboratório', 'Exame pronto — Trecho de Exame pronto', 'ana@gmail.com']);
    await card.locator('..').locator('button[title="Verificar agora"]').click();
    await p.waitForTimeout(800);
    notes = await sw.evaluate(() => globalThis.__notes);
    assert.equal(notes.length, 1, 'não avisa de novo');
    // configurações: silenciar uma conta e desconectar
    await card.locator('..').locator('button[title="Configurar o e-mail"]').click();
    const dlg = p.locator('dialog.mail-dlg[open]');
    assert.equal(await dlg.locator('tbody tr').count(), 2);
    await dlg.locator('tbody tr:has-text("ana@empresa.com") input[aria-label="Mostrar"]').uncheck();
    await dlg.locator('button[value="ok"]').click();
    await p.waitForTimeout(500);
    assert.equal(await card.locator('.mail-item:has-text("Relatório semanal")').count(), 0);
    await card.locator('..').locator('button[title="Configurar o e-mail"]').click();
    await p.locator('dialog.mail-dlg[open] button:has-text("Desconectar e apagar")').click();
    await card.locator('button:has-text("Conectar o Gmail")').waitFor();
    assert.equal(await x.storage(p, 'nt_mail'), undefined);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
