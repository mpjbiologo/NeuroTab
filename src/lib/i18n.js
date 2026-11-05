// NeuroTab — tradução automática da interface (pt-BR → en / es).
// Estratégia: o código continua em português; um tradutor de DOM troca os textos
// conhecidos (dicionários em src/i18n/) e ajusta datas/números para o idioma escolhido.
import EN from '../i18n/en.js';
import ES from '../i18n/es.js';

const DICTS = { en: EN, es: ES };
export let LANG = 'pt-BR';
export let LOCALE = 'pt-BR';
let D = null;
let PATS = [];

export function resolveLang(pref) {
  const l = pref && pref !== 'auto' ? pref : (globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || 'pt-BR');
  if (/^pt/i.test(l)) return 'pt-BR';
  if (/^es/i.test(l)) return 'es';
  return 'en';
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function setLang(pref) {
  LANG = resolveLang(pref);
  const nav = globalThis.navigator?.language || '';
  LOCALE = LANG === 'pt-BR' ? 'pt-BR' : nav.toLowerCase().startsWith(LANG) ? nav : LANG === 'en' ? 'en-US' : 'es-ES';
  D = DICTS[LANG] || null;
  PATS = D
    ? D.patterns.map(([src, dst]) => {
      const order = [];
      const re = new RegExp('^' + src.split(/\{(\d)\}/).map((p, i) => (i % 2 ? (order.push(+p), '([\\s\\S]+?)') : escRe(p))).join('') + '$');
      return { re, order, dst, len: src.length };
    }).sort((a, b) => b.len - a.len) // padrões mais específicos primeiro
    : [];
  patchLocale();
  return LANG;
}

function matchPattern(s) {
  for (const p of PATS) {
    const m = s.match(p.re);
    if (!m) continue;
    const vals = {};
    p.order.forEach((n, i) => { vals[n] = m[i + 1]; });
    return p.dst.replace(/\{(\d)\}/g, (_, n) => {
      const v = vals[n] ?? '';
      return D.exact[v.trim()] ?? v;
    });
  }
  return null;
}

/** Traduz um texto (mantém espaços nas pontas). Sem dicionário, devolve o original. */
export function t(s) {
  if (!D || typeof s !== 'string' || !s.trim()) return s;
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = m[2];
  let out = D.exact[core];
  if (out == null) out = matchPattern(core);
  if (out == null && core.includes(' · ')) {
    const parts = core.split(' · ');
    const tr = parts.map((p) => D.exact[p] ?? matchPattern(p) ?? p);
    if (tr.some((x, i) => x !== parts[i])) out = tr.join(' · ');
  }
  return out == null ? s : m[1] + out + m[3];
}

export const isTranslated = () => !!D;

// ---------- Datas e números no idioma certo ----------
let patched = false;
function patchLocale() {
  if (patched) return;
  patched = true;
  const map = (l) => (l === 'pt-BR' ? LOCALE : l);
  for (const fn of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
    const orig = Date.prototype[fn];
    Date.prototype[fn] = function (l, o) { return orig.call(this, map(l), o); };
  }
  const num = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = function (l, o) { return num.call(this, map(l), o); };
  const RTF = Intl.RelativeTimeFormat;
  Intl.RelativeTimeFormat = class extends RTF { constructor(l, o) { super(map(l), o); } };
}

// ---------- Tradução do DOM ----------
const SKIP = 'script,style,textarea,code,pre,[contenteditable],.no-tr,.plink .t,.item .tt,.item .tx,.msg,.pill,.rt-name,.ph-cap,.calc-hist,.calc-out,#clock,.pl-name,.tag,.q-row small,#panelTitle,.rail-btn .lbl,.focus-main span,.news-src';
const ATTRS = ['placeholder', 'title', 'aria-label'];
const HTML_TAGS = new Set(['P', 'LI', 'SMALL', 'LABEL', 'SUMMARY', 'H2', 'H3', 'SPAN', 'DIV', 'B']);

function trText(node) {
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  const v = t(node.data);
  if (v !== node.data) node.data = v;
}

function trAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v) {
      const tv = t(v);
      if (tv !== v) el.setAttribute(a, tv);
    }
  }
}

function trTree(root) {
  if (!D || !root) return;
  if (root.nodeType === 3) { trText(root); return; }
  if (root.nodeType !== 1) return;
  if (root.closest?.(SKIP)) { trAttrs(root); return; }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType === 1 && n.matches(SKIP)) { trAttrs(n); return NodeFilter.FILTER_REJECT; }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n = root;
  while (n) {
    if (n.nodeType === 3) trText(n);
    else {
      trAttrs(n);
      if (HTML_TAGS.has(n.tagName) && n.children.length && D.html) {
        const key = n.innerHTML.split(/\s+/).join(' ').trim();
        const h = D.html[key];
        if (h) { n.innerHTML = h; n = walker.nextSibling() || nextOut(walker); continue; }
      }
    }
    n = walker.nextNode();
  }
}

function nextOut(walker) {
  while (walker.parentNode()) {
    const s = walker.nextSibling();
    if (s) return s;
  }
  return null;
}

/** Inicia a tradução da página: textos atuais + tudo o que for criado depois. */
export function initI18n(pref) {
  setLang(pref);
  document.documentElement.lang = LANG;
  if (!D) return;
  document.title = t(document.title);
  trTree(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') trText(m.target);
      else if (m.type === 'attributes') trAttrs(m.target);
      else m.addedNodes.forEach(trTree);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const { confirm, alert, prompt } = window;
  window.confirm = (msg) => confirm.call(window, t(String(msg)));
  window.alert = (msg) => alert.call(window, t(String(msg)));
  window.prompt = (msg, def) => prompt.call(window, t(String(msg)), def);
}

/** Nome do idioma para instruir a IA. */
export function aiLanguageName() {
  return { 'pt-BR': 'português do Brasil', en: 'inglês (English)', es: 'espanhol (español)' }[LANG] || 'português do Brasil';
}
