// #60: a barra de organizar (com "＋ Widget") fica visível e clicável, nunca atrás dos widgets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

// O botão está por cima de tudo no ponto em que seria clicado?
const onTop = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { hit: !!hit && (hit === el || el.contains(hit)), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
}, sel);

for (const [label, viewport] of [['computador', { width: 1280, height: 800 }], ['celular', { width: 390, height: 760 }]]) {
  test(`modo livre (${label}): widget com camada alta no rodapé não cobre a barra; "＋ Widget" abre o catálogo`, async () => {
    const x = await launch({ viewport });
    try {
      const p = await x.open('src/newtab.html');
      const data = await x.storage(p, 'nt_data');
      data.settings.layoutMode = 'free';
      // widget largo, encostado embaixo da tela, com z alto (como um widget trazido para a frente)
      data.settings.widgets = [{ id: 'brain', w: 6, fx: 0, fy: 0, fw: 1, fh: 600, fz: 7000 }];
      await x.seed(p, { nt_data: data });
      // posiciona o widget para cobrir a parte de baixo da tela, onde a barra aparece
      const top = await p.evaluate(() => document.querySelector('#widgets').getBoundingClientRect().top + scrollY);
      data.settings.widgets[0].fy = Math.max(0, viewport.height - top - 300);
      await x.seed(p, { nt_data: data });
      // em tela estreita o modo livre vira grade: aí o widget pode não cobrir o rodapé, e tudo bem
      const cover = await p.evaluate(() => document.querySelector('#widgets .free-item:not(.free-fixed)')?.getBoundingClientRect().toJSON() || null);
      if (cover) assert.ok(cover.top < viewport.height - 120 && cover.bottom > viewport.height, 'o widget cobre o rodapé da tela ' + JSON.stringify({ top, fy: data.settings.widgets[0].fy, cover }));
      await p.click('#editLayout');
      await p.waitForSelector('#editBar:not([hidden])');
      assert.deepEqual(await onTop(p, '#addWidget'), { hit: true, inView: true });
      assert.deepEqual(await onTop(p, '#doneEdit'), { hit: true, inView: true });
      await p.click('#addWidget');
      await p.waitForSelector('#wDlg[open], dialog[open]:has-text("Adicionar widget")');
      assert.deepEqual(x.errors, []);
    } finally {
      await x.close();
    }
  });
}

test('modo grade: com muitos widgets e a página rolada até o fim, a barra continua visível e não esconde o último widget', async () => {
  const x = await launch({ viewport: { width: 1280, height: 800 } });
  try {
    const p = await x.open('src/newtab.html');
    const data = await x.storage(p, 'nt_data');
    data.settings.layoutMode = 'grid';
    data.settings.widgets = ['brain', 'reminders', 'clock', 'calc', 'focus', 'habits', 'quotes', 'capture', 'weather', 'shortcuts'].map((id) => ({ id, w: 6 }));
    await x.seed(p, { nt_data: data });
    await p.click('#editLayout');
    await p.waitForSelector('#editBar:not([hidden])');
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await p.waitForTimeout(200);
    assert.deepEqual(await onTop(p, '#addWidget'), { hit: true, inView: true });
    const gap = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('#widgets > *')];
      const last = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
      return document.querySelector('#editBar').getBoundingClientRect().top - last;
    });
    assert.ok(gap >= 0, `o último widget termina acima da barra (folga ${gap}px)`);
    // ao concluir, a barra some e a folga também
    await p.click('#doneEdit');
    assert.equal(await p.isHidden('#editBar'), true);
  } finally {
    await x.close();
  }
});
