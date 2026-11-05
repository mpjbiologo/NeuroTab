// NeuroTab — utilitários de interface compartilhados.
import { LOCALE } from './i18n.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Markdown mínimo e seguro para respostas da IA.
export function miniMarkdown(text) {
  const lines = esc(text).split('\n');
  const out = [];
  let list = null;
  for (const raw of lines) {
    let line = raw
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[(\d{1,2})\]/g, '<a href="#" class="cite" data-n="$1">[$1]</a>');
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (li) {
      if (!list) { list = []; }
      list.push(`<li>${li[1]}</li>`);
      continue;
    }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    const hd = line.match(/^#{1,4}\s+(.*)/);
    if (hd) out.push(`<p><b>${hd[1]}</b></p>`);
    else if (line.trim()) out.push(`<p>${line}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}

let toastTimer;
export function toast(msg, actionLabel, action) {
  let t = $('#toast');
  if (!t) {
    t = h('div', { id: 'toast', class: 'toast' });
    document.body.append(t);
  }
  t.replaceChildren(document.createTextNode(msg));
  if (actionLabel) {
    t.append(h('button', { onclick: () => { t.hidden = true; action(); } }, actionLabel));
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, actionLabel ? 6000 : 2600);
}

// Menu de contexto próprio.
export function showCtx(e, items) {
  e.preventDefault();
  let m = $('#ctx');
  if (!m) {
    m = h('div', { id: 'ctx', class: 'ctx' });
    document.body.append(m);
    document.addEventListener('click', () => { m.hidden = true; });
    document.addEventListener('keydown', (ev) => ev.key === 'Escape' && (m.hidden = true));
    window.addEventListener('blur', () => { m.hidden = true; });
  }
  m.replaceChildren(...items.map((it) => {
    if (it === '-') return h('hr');
    const [label, fn, cls] = it;
    return h('button', { class: cls || '', onclick: (ev) => { ev.stopPropagation(); m.hidden = true; fn(); } }, label);
  }));
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
}

// ---------- Voz ----------
export function hasDictation() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/** Ditado: chama onText(textoFinal, parcial). Retorna { stop() } ou null se não suportado. */
export function startDictation({ lang, onText, onEnd, onError }) {
  lang = lang || LOCALE;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onError?.('Seu navegador não oferece reconhecimento de voz.');
    return null;
  }
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = '';
  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText?.(finalText.trim(), interim.trim());
  };
  rec.onerror = (ev) => {
    const map = {
      'not-allowed': 'Microfone bloqueado. Clique no ícone de cadeado/câmera na barra de endereço e permita o microfone.',
      'no-speech': 'Não ouvi nada. Tente de novo.',
      network: 'O reconhecimento de voz precisa de internet.',
      'audio-capture': 'Nenhum microfone encontrado.',
    };
    onError?.(map[ev.error] || 'Erro no reconhecimento de voz: ' + ev.error);
  };
  rec.onend = () => onEnd?.(finalText.trim());
  rec.start();
  return { stop: () => rec.stop() };
}

export function voicesFor(lang = 'pt-BR') {
  if (!('speechSynthesis' in window)) return [];
  const pre = lang.slice(0, 2);
  return speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(pre));
}

/** opts: string (idioma) ou settings ({ voiceLang, ttsVoice, ttsRate, ttsPitch }). Retorna Promise ao terminar. */
export function speak(text, opts = 'pt-BR') {
  if (!('speechSynthesis' in window)) return Promise.resolve();
  const o = typeof opts === 'string' ? { voiceLang: opts } : opts || {};
  const lang = o.voiceLang || LOCALE;
  speechSynthesis.cancel();
  const clean = String(text).replace(/\[\d+\]/g, '').replace(/[*#`_>]/g, '').replace(/https?:\/\/\S+/g, '').slice(0, 1500);
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = lang;
  u.rate = o.ttsRate || 1;
  u.pitch = o.ttsPitch || 1;
  const all = speechSynthesis.getVoices();
  const voice = (o.ttsVoice && all.find((v) => v.voiceURI === o.ttsVoice))
    || voicesFor(lang).find((v) => /natural|online|neural/i.test(v.name))
    || voicesFor(lang)[0];
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  return new Promise((res) => {
    u.onend = res;
    u.onerror = res;
    speechSynthesis.speak(u);
  });
}

// Botão de microfone ligado a um campo de texto.
export function micButton(target, { lang, onFinal, title = 'Ditar por voz' } = {}) {
  const btn = h('button', { type: 'button', class: 'mic', title }, '🎤');
  if (!hasDictation()) { btn.hidden = true; return btn; }
  let session = null;
  let base = '';
  btn.addEventListener('click', () => {
    if (session) { session.stop(); return; }
    base = target.value ? target.value.replace(/\s*$/, ' ') : '';
    btn.classList.add('rec');
    session = startDictation({
      lang,
      onText: (fin, interim) => {
        target.value = base + fin + (interim ? ' ' + interim : '');
        target.dispatchEvent(new Event('input', { bubbles: true }));
      },
      onEnd: (fin) => {
        btn.classList.remove('rec');
        session = null;
        target.value = (base + fin).trim();
        target.dispatchEvent(new Event('input', { bubbles: true }));
        if (fin) onFinal?.(target.value);
      },
      onError: (msg) => toast(msg),
    });
    if (!session) btn.classList.remove('rec');
  });
  return btn;
}

export function toLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v) {
  return v ? new Date(v).getTime() : null;
}
