// Camadas e painéis (#35): com tudo aberto ao mesmo tempo, nada sai da tela, a ordem é a esperada
// e o Esc fecha uma coisa de cada vez, a de cima primeiro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

const SIZES = [[1366, 768], [1024, 640], [800, 600], [390, 844]]; // 1024x640 ≈ 1280x800 com zoom de 125%

for (const [vw, vh] of SIZES) {
  test(`tudo aberto em ${vw}x${vh}: dentro da tela, ordem certa e Esc um por vez`, async () => {
    const x = await launch({ viewport: { width: vw, height: vh }, voice: true });
    try {
      const p = await x.open('src/newtab.html');
      const data = await x.storage(p, 'nt_data');
      data.settings.widgets = [{ id: 'calc', w: 4 }, { id: 'capture', w: 4 }, { id: 'brain', w: 4 }];
      await x.seed(p, { nt_data: data });

      // 1) widget maximizado  2) painel de atalhos  3) tela de voz  4) menu de contexto no canto
      await p.click('.widget[data-id="calc"] .wwin-max');
      await p.click('#voiceFab'); // (um clique fora do painel o fecharia, por isso o painel abre depois)
      await p.waitForTimeout(200);
      await p.evaluate(async () => (await import('/src/newtab/rail.js')).openPanel(null, true));
      await p.evaluate(async ([w, h]) => {
        const { showCtx } = await import('/src/lib/ui.js');
        const ev = { preventDefault() {}, clientX: w - 3, clientY: h - 3 };
        showCtx(ev, [['Primeira opção', () => {}], ['Segunda opção', () => {}], '-', ['Remover', () => {}, 'danger']]);
      }, [vw, vh]);

      const state = () => p.evaluate(() => {
        const vis = (s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; };
        const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const out = {};
        for (const [k, s] of [['max', '.widget.maximized'], ['panel', '#panel'], ['voice', '#voice'], ['ctx', '#ctx']]) out[k] = vis(s) && document.querySelector(s) ? r(s === '#voice' ? '#voice .voice-card' : s) : null;
        return out;
      });
      const inside = (b, name) => assert.ok(b.l >= -1 && b.t >= -1 && b.r <= vw + 1 && b.b <= vh + 1, `${name} fora da tela em ${vw}x${vh}: ${JSON.stringify(b)}`);
      let s = await state();
      for (const [k, b] of Object.entries(s)) { assert.ok(b, `${k} deveria estar aberto`); inside(b, k); }

      // A tela de voz está por cima de tudo; os elementos globais não ganharam números de camada soltos
      const top = await p.evaluate(() => {
        const c = document.querySelector('#voice .voice-card').getBoundingClientRect();
        const e = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
        return { onTop: !!e?.closest('#voice'), inline: ['#voiceFab', '#voice', '#ctx', '#toast', '#wakePill'].filter((q) => document.querySelector(q)?.style.zIndex) };
      });
      assert.equal(top.onTop, true, 'tela de voz por cima');
      assert.deepEqual(top.inline, [], 'nenhum z-index solto nos elementos globais');

      // Esc: voz → menu → painel → maximizado
      const order = [];
      for (let i = 0; i < 4; i++) {
        await p.keyboard.press('Escape');
        await p.waitForTimeout(80);
        const now = await state();
        const closed = Object.keys(s).filter((k) => s[k] && !now[k]);
        assert.equal(closed.length, 1, `Esc #${i + 1} fechou ${closed.join(', ') || 'nada'}`);
        order.push(closed[0]);
        s = now;
      }
      assert.deepEqual(order, ['voice', 'ctx', 'panel', 'max']);
      assert.deepEqual(x.errors, []);
    } finally {
      await x.close();
    }
  });
}
