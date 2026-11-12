// Limpeza de HTML antes de colocar na página (respostas da IA, traduções, QR do Pix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './helpers.js';

test('setHTML remove scripts, eventos e links perigosos e mantém a formatação', async () => {
  const x = await launch();
  try {
    const p = await x.open('src/newtab.html', { wait: 600 });
    const r = await p.evaluate(async () => {
      const { setHTML, sanitizeHTML } = await import('/src/lib/safe-html.js');
      window.__pwned = 0;
      const box = document.createElement('div');
      document.body.append(box);
      setHTML(box, [
        '<p><b>ok</b> <i>it</i> <code>c</code> <a href="https://exemplo.com" target="_blank">link</a></p>',
        '<script>window.__pwned++</script>',
        '<img src="x" onerror="window.__pwned++">',
        '<a href="javascript:window.__pwned++">js</a>',
        '<a href=" JaVaScRiPt:window.__pwned++">js2</a>',
        '<iframe srcdoc="<script>parent.__pwned++</script>"></iframe>',
        '<svg><foreignObject><img src=x onerror="window.__pwned++"></foreignObject><rect onclick="x()" width="5" height="5"/></svg>',
        '<form action="javascript:alert(1)"><button>b</button></form>',
        '<img src="data:image/png;base64,iVBORw0KGgo=">',
        '<img src="data:text/html,<script>1</script>">',
      ].join(''));
      box.querySelectorAll('a').forEach((a) => a.click());
      await new Promise((res) => setTimeout(res, 300));
      const html = box.innerHTML;
      const frag = sanitizeHTML('<b>x</b>');
      return {
        pwned: window.__pwned,
        hasScript: /<script|<iframe|<form|foreignobject/i.test(html),
        hasOn: /\son[a-z]+=/i.test(html),
        hasJs: /javascript:/i.test(html),
        keep: ['b', 'i', 'code', 'svg', 'rect'].every((t) => box.querySelector(t)),
        rel: box.querySelector('a[target="_blank"]')?.rel,
        dataImg: [...box.querySelectorAll('img')].map((i) => i.getAttribute('src')),
        fragOk: frag.firstChild?.tagName === 'B',
      };
    });
    assert.equal(r.pwned, 0, 'nada pode ser executado');
    assert.equal(r.hasScript, false);
    assert.equal(r.hasOn, false);
    assert.equal(r.hasJs, false);
    assert.equal(r.keep, true, 'formatação comum continua');
    assert.equal(r.rel, 'noopener noreferrer');
    assert.ok(r.dataImg.includes('data:image/png;base64,iVBORw0KGgo='), 'imagem data:image é mantida');
    assert.ok(!r.dataImg.some((s) => s && s.startsWith('data:text')), 'data:text/html é removido');
    assert.equal(r.fragOk, true);
    assert.deepEqual(x.errors.filter((e) => !/net::|Failed to load resource/.test(e)), []);
  } finally {
    await x.close();
  }
});
