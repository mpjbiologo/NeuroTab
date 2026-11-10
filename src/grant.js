// Janelinha de permissão: usada quando o navegador não aceita pedir permissão direto do menu de contexto.
import { loadData } from './lib/store.js';
import { initI18n, t } from './lib/i18n.js';
import { downloadAndSave } from './lib/captures.js';

const q = new URLSearchParams(location.search);
const src = q.get('src') || '';
const msg = document.querySelector('#msg');
const say = (text, cls = '') => { msg.className = 'msg ' + cls; msg.textContent = t(text); };

(async () => {
  initI18n((await loadData()).settings.lang);
  let origin = '';
  try {
    const u = new URL(src);
    if (u.protocol !== 'https:') throw new Error();
    origin = u.origin;
  } catch {
    say('Endereço de imagem inválido.', 'err');
    document.querySelector('#go').disabled = true;
    return;
  }
  document.querySelector('#host').textContent = new URL(origin).hostname;
  document.querySelector('#cancel').onclick = () => window.close();
  const meta = { url: src, pageUrl: q.get('page') || '', pageTitle: q.get('title') || '', source: 'context' };
  const tabId = q.get('tab') ? Number(q.get('tab')) : null;
  const done = () => { say('✓ Imagem salva na biblioteca.', 'ok'); setTimeout(() => window.close(), 1200); };
  // Plano B: pegar a imagem de dentro da aba onde a pessoa clicou (login, bloqueio do site, permissão negada).
  const fromPage = async (firstError) => {
    if (tabId == null) return say(firstError, 'err');
    say('Tentando pela página…');
    const r = await chrome.runtime.sendMessage({ type: 'grabImage', src, meta, tabId, frameId: Number(q.get('frame') || 0), windowId: q.get('win') ? Number(q.get('win')) : undefined }).catch((e) => ({ ok: false, error: e.message }));
    return r?.ok ? done() : say(r?.error || firstError, 'err');
  };
  document.querySelector('#go').onclick = async () => {
    const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
    if (!granted) return fromPage('Permissão não concedida.');
    say('Salvando…');
    try {
      await downloadAndSave(src, meta);
      done();
    } catch (e) {
      if (/12 MB/.test(e.message)) return say(e.message, 'err');
      return fromPage(e.message);
    }
  };
})();
