// Layout: modo livre (arrastar, redimensionar, salvar), tela estreita e camadas (#35).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

test('modo livre: arrastar e redimensionar persistem; tela estreita volta para coluna', async () => {
  const x = await launch({ viewport: { width: 1600, height: 950 } });
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { widgets: [{ id: 'capture', w: 6 }, { id: 'reminders', w: 6 }, { id: 'calc', w: 4 }] });
    await p.click('#editLayout');
    await p.click('#modeFree');
    await p.waitForTimeout(500);
    // O modo livre redesenha os widgets depois de cada arrasto: espera o elemento estar visível antes de medir.
    const box = async (sel) => { const l = p.locator(sel); await l.waitFor({ state: 'visible' }); await p.waitForTimeout(250); return l.boundingBox(); };
    const hw = await box('.widget[data-id=reminders] > header .wt');
    await p.mouse.move(hw.x + 20, hw.y + 8);
    await p.mouse.down();
    await p.mouse.move(1300, 160, { steps: 15 });
    await p.mouse.up();
    await p.waitForTimeout(400);
    const g = await box('.widget[data-id=calc] .grip');
    await p.mouse.move(g.x + 9, g.y + 9);
    await p.mouse.down();
    await p.mouse.move(g.x + 120, g.y + 60, { steps: 10 });
    await p.mouse.up();
    await p.click('#doneEdit');
    await p.reload();
    await p.waitForTimeout(1000);
    const s = (await x.storage(p, 'nt_data')).settings;
    assert.equal(s.layoutMode, 'free');
    const rem = s.widgets.find((w) => w.id === 'reminders');
    assert.ok(Number.isFinite(rem.fx) && Number.isFinite(rem.fy), JSON.stringify(rem));
    // widgets não se sobrepõem depois de carregar
    const overlaps = await p.$$eval('.free-item', (els) => {
      const out = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i].getBoundingClientRect(); const b = els[j].getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${els[i].dataset.id}×${els[j].dataset.id}`);
      }
      return out;
    });
    assert.deepEqual(overlaps, []);
    await p.setViewportSize({ width: 650, height: 900 });
    await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => document.body.classList.contains('free')), false);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});

test('camadas: a tela de voz fica acima dos widgets (#35)', async () => {
  const x = await launch({ voice: true });
  try {
    const p = await x.open('src/newtab.html');
    await x.settings(p, { layoutMode: 'free', widgets: [{ id: 'capture', w: 6 }, { id: 'reminders', w: 6 }, { id: 'calc', w: 4 }] });
    for (const id of ['capture', 'reminders', 'calc']) await p.click(`.widget[data-id=${id}] > header`).catch(() => {}); // traz cada um "para frente"
    await p.evaluate(() => { const v = document.querySelector('#voice'); v.hidden = false; document.querySelector('#voiceReply').textContent = 'teste '.repeat(400); });
    const hits = await p.evaluate(() => {
      const r = document.querySelector('.voice-card').getBoundingClientRect();
      return [[r.left + 20, r.top + 20], [r.right - 20, r.top + 20], [r.left + 20, r.bottom - 20], [r.right - 20, r.bottom - 20], [r.left + r.width / 2, r.top + r.height / 2]]
        .map(([px, py]) => !!document.elementFromPoint(px, py)?.closest('#voice'));
    });
    assert.deepEqual(hits, [true, true, true, true, true]);
    assert.deepEqual(x.errors, []);
  } finally {
    await x.close();
  }
});
