// NeuroTab — Aparência da nova aba: tema, barra lateral, plano de fundo e slides de fotos (Bing/NASA/pasta).
import { SEARCH_ENGINES } from '../lib/store.js';
import { $, $$, h } from '../lib/ui.js';
import { photoList, photoUrl, preload } from '../lib/photos.js';
import { t } from '../lib/i18n.js';
import { S, heroEl, omniEl } from './state.js';
import { dockPos, openPanel } from './rail.js';

// ---------- Aparência ----------
export function applySettings() {
  const s = S.data.settings;
  const root = document.documentElement.style;
  root.setProperty('--cols', s.columns);
  root.setProperty('--radius', s.tileRadius + 'px');
  root.setProperty('--dim', s.bgDim);
  root.setProperty('--bg-color', s.bgColor);
  const b = document.body.classList;
  const pos = dockPos();
  ['left', 'right', 'top', 'bottom'].forEach((p) => b.toggle('dock-' + p, pos === p));
  b.toggle('narrow', innerWidth < 700);
  const lateral = pos === 'left' || pos === 'right';
  b.toggle('pinned', lateral && s.dockPinned);
  $('#pinDock').classList.toggle('on', s.dockPinned);
  heroEl.hidden = !s.showClock;
  omniEl.hidden = !s.showSearch;
  $('#omni').placeholder = `Pesquisar atalhos, notas ou no ${(SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.google).name}…  (Ctrl+K)`;
  $('#addGroup').hidden = !s.showAddButtons;
  $('#panelAdd').hidden = !s.showAddButtons;
  if (lateral && s.dockPinned) openPanel(S.activeId, true);
  applyBackground();
}

export function applyBackground() {
  const s = S.data.settings;
  const slides = s.bgEnabled && s.bgMode === 'slides';
  const want = !slides && S.bgCache && s.bgEnabled ? S.bgCache : null;
  if (want !== applyBackground.last) {
    applyBackground.last = want;
    $('#bg').style.backgroundImage = want ? `url("${want}")` : 'none';
  }
  const key = slides ? `${s.slideSource}|${s.slideInterval}` : '';
  if (key === slideshow.key) return;
  slideshow.key = key;
  clearTimeout(slideshow.timer);
  if (!slides) {
    $$('.bgl').forEach((l) => l.classList.remove('on'));
    $('#bgCredit').hidden = true;
    return;
  }
  startSlideshow();
}

const slideshow = { key: '', list: [], i: 0, timer: null, front: null };
async function startSlideshow() {
  const s = S.data.settings;
  slideshow.list = await photoList(s.slideSource);
  const L = slideshow.list;
  for (let k = L.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [L[k], L[j]] = [L[j], L[k]]; }
  slideshow.i = 0;
  if (!L.length) {
    const cr = $('#bgCredit');
    const msg = s.slideSource === 'local' ? t('Sem fotos para o slide — adicione em Configurações → Plano de fundo.') : '';
    cr.hidden = !msg;
    cr.classList.add('msg');
    cr.textContent = msg;
    return;
  }
  nextSlide();
}

async function nextSlide() {
  const L = slideshow.list;
  if (!L.length) return;
  const p = L[slideshow.i++ % L.length];
  const url = await photoUrl(p);
  if (url && (await preload(url))) {
    const layers = $$('.bgl');
    const back = slideshow.front === layers[0] ? layers[1] : layers[0];
    back.style.backgroundImage = `url("${url}")`;
    back.classList.add('on');
    slideshow.front?.classList.remove('on');
    slideshow.front = back;
    const cr = $('#bgCredit');
    cr.hidden = p.kind !== 'web';
    cr.classList.remove('msg');
    if (p.kind === 'web') {
      const label = `${p.title ? p.title + ' · ' : ''}${p.credit}`;
      cr.replaceChildren(h('a', { href: p.link || '#', target: '_blank', rel: 'noopener', title: label, 'aria-label': label },
        h('span', { class: 'cr-ic', 'aria-hidden': 'true' }, '📷'), h('span', { class: 'cr-txt' }, label)));
    }
  }
  clearTimeout(slideshow.timer);
  slideshow.timer = setTimeout(nextSlide, Math.max(0.25, S.data.settings.slideInterval || 5) * 60e3);
}
