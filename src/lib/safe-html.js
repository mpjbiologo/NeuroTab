// NeuroTab — colocar HTML na página com segurança.
//
// Em vez de `el.innerHTML = html`, o HTML é lido por um DOMParser (que não executa nada),
// limpo e só então inserido. Sai da limpeza:
//   • elementos que executam ou carregam coisas: script, iframe, object, embed, link, meta, base, form…
//   • atributos de evento (onclick, onerror…)
//   • endereços javascript:, vbscript: e data: (exceto imagens data:image/…)
// Usado para textos traduzidos, respostas da IA em Markdown e o QR Code do Pix.

const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'LINK', 'META', 'BASE', 'FORM', 'TEMPLATE', 'NOSCRIPT', 'FOREIGNOBJECT']);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster', 'background']);

function unsafeUrl(name, value) {
  const v = String(value).replace(/[\u0000- ]/g, '').toLowerCase();
  if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return true;
  if (v.startsWith('data:')) return !(name === 'src' && v.startsWith('data:image/') && !v.startsWith('data:image/svg'));
  return false;
}

/** Devolve um fragmento com o HTML já limpo. */
export function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html ?? ''}`, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const drop = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (DROP.has(n.tagName.toUpperCase())) { drop.push(n); continue; }
    for (const a of [...n.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || (URL_ATTRS.has(name) && unsafeUrl(name, a.value))) n.removeAttribute(a.name);
    }
    if (n.tagName === 'A' && n.getAttribute('target') === '_blank') n.setAttribute('rel', 'noopener noreferrer');
  }
  for (const n of drop) n.remove();
  const frag = document.createDocumentFragment();
  frag.append(...doc.body.childNodes);
  return frag;
}

/** Substitui o conteúdo de `el` pelo HTML limpo. */
export function setHTML(el, html) {
  el.replaceChildren(sanitizeHTML(html));
  return el;
}
