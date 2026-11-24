// NeuroTab — Modo Clean (0.9.0, #69). Liga em Configurações → Aparência ou com Alt+Z.
// Esconde widgets, barra de atalhos e o relógio comum; mostra data, saudação, relógio grande, barra do dia,
// a busca (a mesma barra universal, movida para cá) e os atalhos do grupo escolhido.
import { $, h } from '../lib/ui.js';
import { t, LOCALE } from '../lib/i18n.js';
import { saveData } from '../lib/store.js';
import { linkIconEl } from '../lib/tiles.js';
import { CLEAN_FONTS, clockParts, dayProgress, dateLabel, cleanLinks, sanitizeClean } from '../lib/clean.js';
import { S, bus } from './state.js';
import { ctx } from './context.js';
import { openUrl } from './open.js';

let tick = 0;
let homeOfOmni = null; // onde a barra de pesquisa fica fora do Modo Clean

const conf = () => sanitizeClean(S.data.settings.clean);

function greetText(d) {
  const hr = d.getHours();
  const hello = t(hr < 5 ? 'Boa madrugada' : hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite');
  return S.data.settings.userName ? `${hello}, ${S.data.settings.userName}` : hello;
}

function paintTime() {
  const c = conf();
  const d = new Date();
  $('#clDate').textContent = c.date ? dateLabel(d, LOCALE) : '';
  $('#clGreet').textContent = c.greet ? greetText(d) : '';
  const { parts, suffix } = clockParts(d, c);
  const sep = () => h('span', { class: 'cl-sep', 'aria-hidden': 'true' }, h('i'), h('i'));
  const kids = [h('span', {}, parts[0]), sep(), h('span', {}, parts[1])];
  if (parts[2]) kids.push(h('span', { class: 'cl-sec' }, parts[2]));
  if (suffix) kids.push(h('span', { class: 'cl-ampm' }, suffix));
  const clock = $('#clClock');
  clock.replaceChildren(...kids);
  clock.setAttribute('aria-label', d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }));
  const p = dayProgress(d);
  $('#clDayWrap').hidden = !c.dayBar;
  $('#clDay').style.width = (p * 100).toFixed(2) + '%';
  $('#clDayWrap').title = `${Math.round(p * 100)}% ${t('do dia')}`;
}

function paintLinks() {
  const c = conf();
  const box = $('#clLinks');
  box.hidden = c.links === 'none';
  box.classList.toggle('icons', c.links === 'icon');
  box.style.setProperty('--cl-cols', c.cols);
  if (c.links === 'none') { box.replaceChildren(); return; }
  box.replaceChildren(...cleanLinks(S.data, c).map((l) => {
    const name = l.title || l.url;
    const a = h('a', { class: 'cl-link', href: l.url, title: name, 'aria-label': name, 'data-id': l.id }, linkIconEl(l, ctx.faviconFor), c.links === 'icon' ? null : h('span', { class: 'cl-name' }, name));
    a.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // o navegador abre como pedido
      e.preventDefault();
      openUrl(l.url);
    });
    return a;
  }));
}

/** Liga/desliga a tela limpa sem perder nada do layout normal. */
export function applyClean() {
  const c = conf();
  const on = !!c.on;
  const body = document.body;
  body.classList.toggle('clean-mode', on);
  body.classList.toggle('cl-blur-soft', on && c.blur === 'soft');
  body.classList.toggle('cl-blur-strong', on && c.blur === 'strong');
  body.style.setProperty('--cl-dim', String(on ? c.dim / 100 : 0));
  const font = CLEAN_FONTS[c.font] || CLEAN_FONTS.playfair;
  $('#clean').style.setProperty('--cl-font', font.css);
  $('#clean').style.setProperty('--cl-weight', String(font.weight));
  $('#clean').hidden = !on;
  // A barra de pesquisa universal (com resultados, notas e Ctrl+K) muda de lugar.
  const omni = $('#omniWrap');
  if (on) {
    if (!homeOfOmni) homeOfOmni = { parent: omni.parentNode, next: omni.nextSibling };
    $('#clOmniSlot').append(omni);
    omni.hidden = !c.search;
    $('#omni').placeholder = t('Buscar na web');
  } else if (homeOfOmni) {
    homeOfOmni.parent.insertBefore(omni, homeOfOmni.next);
    homeOfOmni = null;
    omni.hidden = !S.data.settings.showSearch;
    $('#omni').placeholder = t('Pesquisar atalhos, notas ou na web…  (Ctrl+K)');
  }
  $('#clQuick').hidden = !c.hint;
  clearInterval(tick);
  if (on) {
    paintTime();
    paintLinks();
    tick = setInterval(paintTime, c.seconds ? 1000 : 5000);
  }
}

export async function toggleClean() {
  const s = S.data.settings;
  s.clean = { ...sanitizeClean(s.clean), on: !sanitizeClean(s.clean).on };
  applyClean();
  await saveData(S.data);
}

export function setupClean() {
  applyClean();
  ctx.on('data', () => applyClean());
  bus.on('widgets.rendered', () => { if (conf().on) applyClean(); });
  $('#clQuick').addEventListener('click', () => { const o = $('#omni'); o.focus(); o.select(); });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.target.closest?.('input,textarea,[contenteditable="true"]')) {
      e.preventDefault();
      toggleClean();
    }
  });
}
