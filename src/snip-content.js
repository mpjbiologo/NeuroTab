// NeuroTab — Recorte de tela (0.9.0, #37): camada por cima da página para escolher a área.
// Injetado só com o clique da pessoa (activeTab). Mostra a foto da aba (tirada antes), escurecida; arrastar escolhe
// a área; Enter confirma, Esc cancela. Devolve a imagem recortada e o que fazer com ela.
(() => {
  if (window.__ntSnip) return;

  // Igual a toPixels() de src/lib/snip.js (o teste confere).
  function toPixels(rect, { imgW, imgH, vw, vh }) {
    const kx = imgW / vw;
    const ky = imgH / vh;
    const x0 = Math.max(0, Math.min(vw, Math.min(rect.x, rect.x + rect.w)));
    const y0 = Math.max(0, Math.min(vh, Math.min(rect.y, rect.y + rect.h)));
    const x1 = Math.max(0, Math.min(vw, Math.max(rect.x, rect.x + rect.w)));
    const y1 = Math.max(0, Math.min(vh, Math.max(rect.y, rect.y + rect.h)));
    const sx = Math.round(x0 * kx);
    const sy = Math.round(y0 * ky);
    return { sx, sy, sw: Math.max(0, Math.round(x1 * kx) - sx), sh: Math.max(0, Math.round(y1 * ky) - sy) };
  }

  const L = (window.__ntSnipLabels = window.__ntSnipLabels || {});
  const T = (k, d) => L[k] || d;
  const css = (el, o) => Object.assign(el.style, o);
  const Z = '2147483647';

  window.__ntSnip = (shotUrl) => new Promise((resolve) => {
    const vw = innerWidth;
    const vh = innerHeight;
    const host = document.createElement('div');
    host.setAttribute('data-neurotab-snip', '');
    css(host, { position: 'fixed', inset: '0', zIndex: Z, cursor: 'crosshair', userSelect: 'none' });
    const root = host.attachShadow({ mode: 'closed' });
    const img = new Image();
    img.src = shotUrl;
    css(img, { position: 'absolute', inset: '0', width: vw + 'px', height: vh + 'px', pointerEvents: 'none' });
    const dim = document.createElement('div');
    css(dim, { position: 'absolute', inset: '0', background: 'rgba(0,0,0,.45)' });
    const box = document.createElement('div');
    css(box, { position: 'absolute', border: '2px solid #4fc3f7', boxShadow: '0 0 0 9999px rgba(0,0,0,.45)', display: 'none', background: 'transparent' });
    const tip = document.createElement('div');
    tip.textContent = T('tip', 'Arraste para escolher a área · Enter confirma · Esc cancela');
    css(tip, { position: 'absolute', left: '50%', top: '16px', transform: 'translateX(-50%)', background: 'rgba(20,20,24,.9)', color: '#fff', font: '13px system-ui, sans-serif', padding: '8px 14px', borderRadius: '10px' });
    const size = document.createElement('div');
    css(size, { position: 'absolute', background: 'rgba(20,20,24,.9)', color: '#fff', font: '12px system-ui, sans-serif', padding: '3px 7px', borderRadius: '6px', display: 'none' });
    const bar = document.createElement('div');
    css(bar, { position: 'absolute', display: 'none', gap: '6px', background: 'rgba(20,20,24,.95)', padding: '6px', borderRadius: '10px', font: '13px system-ui, sans-serif' });
    const btn = (label, action) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.action = action;
      css(b, { background: action === 'save' ? '#4fc3f7' : '#2a2a32', color: action === 'save' ? '#06121a' : '#fff', border: '0', borderRadius: '7px', padding: '7px 11px', cursor: 'pointer', font: 'inherit' });
      b.addEventListener('click', (e) => { e.stopPropagation(); finish(action); });
      bar.append(b);
    };
    btn(T('save', '💾 Salvar na biblioteca'), 'save');
    btn(T('copy', '📋 Copiar'), 'copy');
    btn(T('note', '📝 Salvar e anotar'), 'note');
    btn(T('cancel', 'Cancelar'), 'cancel');
    root.append(img, dim, box, size, tip, bar);
    document.documentElement.append(host);

    let start = null;
    let rect = null;
    const show = () => {
      if (!rect) return;
      const x = Math.min(rect.x, rect.x + rect.w);
      const y = Math.min(rect.y, rect.y + rect.h);
      const w = Math.abs(rect.w);
      const hh = Math.abs(rect.h);
      dim.style.display = 'none';
      css(box, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
      css(size, { display: 'block', left: x + 'px', top: Math.max(0, y - 24) + 'px' });
      size.textContent = `${Math.round(w)} × ${Math.round(hh)}`;
    };
    const placeBar = () => {
      const x = Math.min(rect.x, rect.x + rect.w);
      const y = Math.max(rect.y, rect.y + rect.h);
      css(bar, { display: 'flex', left: Math.max(8, Math.min(vw - 420, x)) + 'px', top: Math.min(vh - 48, y + 8) + 'px' });
    };
    host.addEventListener('pointerdown', (e) => {
      if (e.target !== host && e.composedPath()[0]?.dataset?.action) return;
      start = { x: e.clientX, y: e.clientY };
      rect = { x: start.x, y: start.y, w: 0, h: 0 };
      bar.style.display = 'none';
      tip.style.display = 'none';
      host.setPointerCapture?.(e.pointerId);
    });
    host.addEventListener('pointermove', (e) => { if (!start) return; rect = { x: start.x, y: start.y, w: e.clientX - start.x, h: e.clientY - start.y }; show(); });
    host.addEventListener('pointerup', () => { if (!start) return; start = null; if (Math.abs(rect.w) < 4 || Math.abs(rect.h) < 4) { rect = null; box.style.display = 'none'; size.style.display = 'none'; dim.style.display = 'block'; return; } placeBar(); });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); }
      if (e.key === 'Enter' && rect) { e.preventDefault(); e.stopPropagation(); finish('save'); }
    };
    addEventListener('keydown', onKey, true);

    async function crop() {
      await img.decode().catch(() => {});
      const p = toPixels(rect, { imgW: img.naturalWidth, imgH: img.naturalHeight, vw, vh });
      if (!p.sw || !p.sh) return null;
      const c = document.createElement('canvas');
      c.width = p.sw;
      c.height = p.sh;
      c.getContext('2d').drawImage(img, p.sx, p.sy, p.sw, p.sh, 0, 0, p.sw, p.sh);
      return c;
    }
    async function finish(action) {
      removeEventListener('keydown', onKey, true);
      if (action === 'cancel' || !rect) { host.remove(); resolve({ action: 'cancel' }); return; }
      const c = await crop();
      host.remove();
      if (!c) { resolve({ action: 'cancel' }); return; }
      if (action === 'copy') {
        try {
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          resolve({ action: 'copy', copied: true, w: c.width, h: c.height });
        } catch (e) {
          resolve({ action: 'copy', copied: false, error: String(e?.message || e), dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height });
        }
        return;
      }
      resolve({ action, dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height });
    }
  });

  // ---------- Captura rolada (página inteira) ----------
  let hidden = [];
  let box = null;
  let cancelled = false;
  window.__ntSnipFull = {
    measure() {
      const el = document.scrollingElement || document.documentElement;
      return { pageH: Math.max(el.scrollHeight, document.body?.scrollHeight || 0), viewH: innerHeight, viewW: innerWidth, y0: scrollY };
    },
    async scrollTo(y) {
      scrollTo({ top: y, left: 0, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 120));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return scrollY;
    },
    hideFixed() {
      // Cabeçalhos e menus fixos aparecem uma vez só (na primeira foto).
      for (const el of document.querySelectorAll('body *')) {
        const p = getComputedStyle(el).position;
        if ((p === 'fixed' || p === 'sticky') && !el.hasAttribute('data-neurotab-snip')) { hidden.push([el, el.style.visibility]); el.style.visibility = 'hidden'; }
      }
    },
    progress(i, n) {
      if (!box) {
        box = document.createElement('div');
        box.setAttribute('data-neurotab-snip', '');
        css(box, { position: 'fixed', right: '16px', bottom: '16px', zIndex: Z, background: 'rgba(20,20,24,.95)', color: '#fff', font: '13px system-ui, sans-serif', padding: '10px 12px', borderRadius: '10px', display: 'flex', gap: '10px', alignItems: 'center' });
        const label = document.createElement('span');
        const b = document.createElement('button');
        b.textContent = T('cancel', 'Cancelar');
        css(b, { background: '#2a2a32', color: '#fff', border: '0', borderRadius: '7px', padding: '5px 9px', cursor: 'pointer' });
        b.onclick = () => { cancelled = true; };
        box.append(label, b);
        document.documentElement.append(box);
      }
      box.firstChild.textContent = `${T('capturing', 'Capturando a página')} ${i}/${n}…`;
      // Fora da foto: o quadro some durante a captura de cada tela.
      return cancelled;
    },
    showBox(on) { if (box) box.style.visibility = on ? 'visible' : 'hidden'; },
    restore(y0) {
      for (const [el, v] of hidden) el.style.visibility = v;
      hidden = [];
      box?.remove();
      box = null;
      const c = cancelled;
      cancelled = false;
      scrollTo({ top: y0 || 0, left: 0, behavior: 'instant' });
      return c;
    },
  };
})();
