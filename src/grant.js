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
  document.querySelector('#go').onclick = async () => {
    const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
    if (!granted) return say('Permissão não concedida.', 'err');
    say('Salvando…');
    try {
      await downloadAndSave(src, { pageUrl: q.get('page') || '', pageTitle: q.get('title') || '', source: 'context' });
      say('✓ Imagem salva na biblioteca.', 'ok');
      setTimeout(() => window.close(), 1200);
    } catch (e) {
      say(e.message, 'err');
    }
  };
})();
