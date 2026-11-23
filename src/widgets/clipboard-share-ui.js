// Widget Área de transferência — tela "Compartilhar com outros aparelhos" (0.7.7.2) e o QR de um item.
import { h } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { qrSvg } from '../lib/pix.js';
import { requestAccess } from '../lib/permissions.js';
import { clipConfig, setClipConfig } from '../lib/clipboard.js';
import { shareConfig, newTopic, newShareKey, newToken, ntfyPairLink, SHARE_STATE_KEY } from '../lib/clipboard-share.js';
import { telegramTransport } from '../lib/clipboard-transports.js';
import { syncConfig } from '../lib/sync.js';

export const COLA_URL = 'https://mpjbiologo.github.io/NeuroTab/cola/';
const RELEASES = 'https://github.com/mpjbiologo/NeuroTab/releases/latest/download/';
export const QR_MAX = 1500; // caracteres que cabem com folga num QR lido pela câmera do celular

/** Programa da Ponte certo para este computador. */
export function ponteDownloads() {
  const p = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent}`.toLowerCase();
  const arm = /arm|aarch64/.test(p);
  const all = {
    windows: { label: 'Windows', file: 'neurotab-ponte-windows-amd64.exe' },
    'macos-arm64': { label: 'macOS (Apple M1/M2/M3…)', file: 'neurotab-ponte-macos-arm64' },
    'macos-amd64': { label: 'macOS (Intel)', file: 'neurotab-ponte-macos-amd64' },
    'linux-amd64': { label: 'Linux', file: 'neurotab-ponte-linux-amd64' },
    'linux-arm64': { label: 'Linux (ARM)', file: 'neurotab-ponte-linux-arm64' },
  };
  const mine = /win/.test(p) ? 'windows' : /mac/.test(p) ? 'macos-arm64' : arm ? 'linux-arm64' : 'linux-amd64';
  return { mine, all, url: (k) => RELEASES + all[k].file };
}

/** Aviso curto ao lado do botão de baixar a Ponte: antivírus e SmartScreen podem reclamar; leva às instruções. */
export function ponteSafetyNote() {
  return h('p', { class: 'muted ponte-safe' }, '🛡️ ', t('Se o Windows ou o antivírus avisar ao baixar ou abrir, é normal em programa novo e é seguro.'), ' ',
    h('a', { href: chrome.runtime.getURL('src/options.html#apps'), target: '_blank' }, t('Veja como seguir')));
}

export function qrDialog(title, text, note = '') {
  const dlg = h('dialog', { class: 'dlg clip-qr' }, h('form', { method: 'dialog' },
    h('h2', {}, title),
    h('div', { class: 'clip-qr-img', html: qrSvg(text, { size: 260, margin: 2 }) }),
    note ? h('p', { class: 'muted' }, note) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', value: 'ok' }, 'Fechar'))));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

const ago = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
function statusLine(st) {
  if (!st) return '';
  if (st.error) return `⚠️ ${st.error}`;
  if (st.lastOk || st.lastPoll) return `✓ ${t('funcionando')} · ${ago(Math.max(st.lastOk || 0, st.lastPoll || 0))}`;
  return '';
}

/** Abre a tela de compartilhamento. */
export async function openShareDialog(ctx) {
  const cfg = await clipConfig();
  const sh = shareConfig(cfg);
  const st = (await chrome.storage.local.get(SHARE_STATE_KEY))[SHARE_STATE_KEY] || {};
  const sync = await syncConfig();
  const say = h('p', { class: 'muted', role: 'status' });

  const enabled = h('input', { type: 'checkbox', checked: sh.enabled });
  const name = h('input', { type: 'text', value: sh.name || '', placeholder: t('Ex.: Notebook do trabalho'), maxlength: 40 });
  const what = h('select', {}, ...[['manual', 'Só o que eu mandar (botão 📤)'], ['pinned', 'Os fixados (★)'], ['all', 'Tudo o que for copiado']].map(([v, l]) => h('option', { value: v, selected: sh.what === v }, l)));
  const images = h('select', {}, ...[['no', 'Não'], ['small', 'Só as pequenas (até 300 KB)'], ['all', 'Todas']].map(([v, l]) => h('option', { value: v, selected: sh.images === v }, l)));
  const direction = h('select', {}, ...[['both', 'Enviar e receber'], ['send', 'Só enviar'], ['receive', 'Só receber']].map(([v, l]) => h('option', { value: v, selected: sh.direction === v }, l)));

  // ☁️ nuvem
  const cloud = h('input', { type: 'checkbox', checked: sh.cloud.on, disabled: !sync.enabled });
  // 🔔 ntfy
  const ntfy = h('input', { type: 'checkbox', checked: sh.ntfy.on });
  const ntfyServer = h('input', { type: 'url', value: sh.ntfy.server, placeholder: 'https://ntfy.sh' });
  const ntfyPlain = h('input', { type: 'checkbox', checked: sh.ntfy.plain });
  let ntfyTopic = sh.ntfy.topic;
  let ntfyKey = sh.ntfy.key;
  // ✈️ Telegram
  const tg = h('input', { type: 'checkbox', checked: sh.telegram.on });
  const tgToken = h('input', { type: 'password', value: sh.telegram.token, placeholder: '123456:ABC-…', autocomplete: 'off' });
  let tgChat = sh.telegram.chatId;
  let tgBot = sh.telegram.bot;
  const tgInfo = h('p', { class: 'muted' }, tgChat ? `✓ ${t('Conectado ao bot')} @${tgBot}` : t('Crie um bot no @BotFather do Telegram, cole o token e clique em Conectar.'));
  // 🏠 rede local
  const lan = h('input', { type: 'checkbox', checked: sh.lan.on });
  const lanPort = h('input', { type: 'number', min: 1024, max: 65535, value: sh.lan.port });
  let lanToken = sh.lan.token || newToken();

  ntfy.addEventListener('change', async () => {
    if (!ntfy.checked) return;
    let origin;
    try { origin = new URL(ntfyServer.value || 'https://ntfy.sh').origin; } catch { ntfy.checked = false; return void (say.textContent = t('Endereço do servidor ntfy inválido.')); }
    if (!(await requestAccess({ origins: [`${origin}/*`] }))) { ntfy.checked = false; say.textContent = t('Sem acesso ao servidor do ntfy, esse caminho não funciona.'); }
  });
  tg.addEventListener('change', async () => {
    if (tg.checked && !(await requestAccess({ origins: ['https://api.telegram.org/*'] }))) { tg.checked = false; say.textContent = t('Sem acesso ao Telegram, esse caminho não funciona.'); }
  });
  lan.addEventListener('change', async () => {
    if (lan.checked && !(await chrome.permissions.request({ permissions: ['nativeMessaging'] }).catch(() => false))) { lan.checked = false; say.textContent = t('Sem a permissão de falar com programas do computador, a rede local não funciona.'); }
  });

  const tgConnect = h('button', { class: 'btn', type: 'button', onclick: async () => {
    if (!(await requestAccess({ origins: ['https://api.telegram.org/*'] }))) return;
    const tr = telegramTransport({ token: tgToken.value.trim() });
    try {
      const bot = await tr.getMe();
      tgBot = bot.username;
      const chat = await tr.findChat();
      if (chat) { tgChat = chat.chatId; tg.checked = true; tgInfo.textContent = `✓ ${t('Conectado ao bot')} @${tgBot} · ${chat.name}`; }
      else tgInfo.replaceChildren(h('span', {}, `${t('Agora abra')} `), h('a', { href: `https://t.me/${tgBot}`, target: '_blank', rel: 'noopener' }, `@${tgBot}`), h('span', {}, ` ${t('no Telegram, mande /start e clique em Conectar de novo.')}`));
    } catch (e) { tgInfo.textContent = '⚠️ ' + e.message; }
  } }, 'Conectar');

  const dl = ponteDownloads();
  const lanSt = st.lan || {};
  const lanUrls = (lanSt.urls || []).map((u) => `${u}/#t=${encodeURIComponent(lanToken)}`);

  const card = (icon, title, toggle, body, status) => h('section', { class: 'share-card' },
    h('label', { class: 'clip-opt' }, toggle || h('span', { class: 'share-dot' }), h('span', {}, h('b', {}, `${icon} ${t(title)}`))),
    h('div', { class: 'share-body' }, ...body, status ? h('small', { class: 'muted share-st' }, status) : null));

  const dlg = h('dialog', { class: 'dlg clip-dlg share-dlg' }, h('form', { method: 'dialog' },
    h('h2', {}, '📤 Compartilhar com outros aparelhos'),
    h('label', { class: 'clip-opt' }, enabled, h('span', {}, h('b', {}, 'Compartilhar a área de transferência'), h('small', { class: 'muted' }, 'Você escolhe por onde e o quê. Desligado, nada sai deste computador.'))),
    h('label', {}, 'Nome deste aparelho', name),
    h('label', {}, 'O que enviar', what),
    h('label', {}, 'Imagens', images),
    h('label', {}, 'Sentido', direction),
    h('h3', {}, 'Por onde'),
    card('📷', 'QR code', null, [h('small', { class: 'muted' }, 'Sempre disponível: o botão 📱 de cada item mostra um QR para a câmera do celular. Nada sai do computador. Só texto, até 1.500 caracteres.')]),
    card('☁️', 'Minha nuvem (Google Drive)', cloud, [
      h('small', { class: 'muted' }, sync.enabled
        ? t('Usa a pasta oculta e a criptografia da sincronização. No celular, abra a página abaixo, entre com a mesma conta Google e digite a senha de sincronização.')
        : t('Precisa da sincronização ligada (Configurações → Contas e sincronização).')),
      h('button', { class: 'btn', type: 'button', onclick: () => qrDialog(t('Abrir no celular'), COLA_URL + '#nuvem', t('Aponte a câmera do celular. Funciona em qualquer rede.')) }, '📱 Abrir no celular'),
    ], statusLine(st.cloud)),
    card('🔔', 'ntfy (notificações)', ntfy, [
      h('small', { class: 'muted' }, 'Canal privado, quase instantâneo. Cifrado com uma chave que só vai no QR de pareamento: o servidor não lê.'),
      h('label', {}, 'Servidor', ntfyServer),
      h('label', { class: 'clip-opt' }, ntfyPlain, h('span', {}, h('small', {}, 'Mostrar o texto aberto nas notificações do app ntfy (menos privado: o servidor passa a ler)'))),
      h('div', { class: 'share-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => {
          if (!ntfyTopic) { ntfyTopic = newTopic(); ntfyKey = newShareKey(); }
          qrDialog(t('Parear o celular'), ntfyPairLink({ name: name.value, ntfy: { server: ntfyServer.value || 'https://ntfy.sh', topic: ntfyTopic, key: ntfyKey } }), t('Aponte a câmera do celular. Salve a página nos favoritos ou na tela inicial.'));
        } }, '📱 Parear celular'),
        h('button', { class: 'btn', type: 'button', onclick: () => { ntfyTopic = newTopic(); ntfyKey = newShareKey(); say.textContent = t('Canal novo criado: pareie os aparelhos de novo.'); } }, 'Gerar canal novo')),
    ], statusLine(st.ntfy)),
    card('✈️', 'Telegram', tg, [
      h('small', { class: 'muted' }, 'Chega numa conversa sua com o seu bot, e o que você manda para ele vem para cá. O conteúdo passa pelos servidores do Telegram.'),
      h('label', {}, 'Token do bot', tgToken),
      h('div', { class: 'share-row' }, tgConnect, h('a', { class: 'btn', href: 'https://t.me/BotFather', target: '_blank', rel: 'noopener' }, 'Abrir o BotFather')),
      tgInfo,
    ], statusLine(st.telegram)),
    card('🏠', 'Rede local (NeuroTab Ponte)', lan, [
      h('small', { class: 'muted' }, 'Sem internet e sem conta: um programinha neste computador abre uma página para o celular no mesmo Wi-Fi. Use em redes de confiança.'),
      h('div', { class: 'share-row' },
        h('a', { class: 'btn', href: dl.url(dl.mine), rel: 'noopener' }, `⬇️ ${t('Baixar para')} ${dl.all[dl.mine].label}`),
        h('details', {}, h('summary', {}, 'Outros sistemas'), ...Object.keys(dl.all).filter((k) => k !== dl.mine).map((k) => h('a', { href: dl.url(k), rel: 'noopener' }, dl.all[k].label)))),
        ponteSafetyNote(),
      h('details', {}, h('summary', {}, 'Como instalar'),
        h('p', {}, h('b', {}, 'Windows: '), 'abra o arquivo baixado. Se aparecer "O Windows protegeu o computador", clique em "Mais informações" → "Executar assim mesmo". Quando o celular conectar pela primeira vez, permita o acesso em redes privadas.'),
        h('p', {}, h('b', {}, 'macOS: '), 'no Terminal: ', h('code', {}, 'chmod +x ~/Downloads/neurotab-ponte-macos-* && xattr -d com.apple.quarantine ~/Downloads/neurotab-ponte-macos-*; ~/Downloads/neurotab-ponte-macos-*')),
        h('p', {}, h('b', {}, 'Linux: '), h('code', {}, 'chmod +x neurotab-ponte-linux-* && ./neurotab-ponte-linux-*')),
        h('p', { class: 'muted' }, 'Depois de instalar, ligue esta opção e salve. O navegador abre a Ponte sozinho quando precisar.')),
      h('label', {}, 'Porta', lanPort),
      lanUrls.length
        ? h('button', { class: 'btn primary', type: 'button', onclick: () => qrDialog(t('Abrir no celular'), lanUrls[0], `${t('O celular precisa estar no mesmo Wi-Fi.')} ${lanUrls.join(' · ')}`) }, '📱 Abrir no celular')
        : null,
    ], lanSt.status === 'on' ? `✓ ${t('Ponte ligada')}${lanSt.version ? ' · v' + lanSt.version : ''}` : statusLine(lanSt)),
    say,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        say.textContent = t('Conferindo…');
        const r = await chrome.runtime.sendMessage({ type: 'clipshare:poll' }).catch((e) => ({ error: e.message }));
        say.textContent = r?.error ? '⚠️ ' + r.error : `✓ ${r?.got || 0} ${t('novo(s)')}`;
      } }, '↻ Conferir agora'),
      h('button', { class: 'btn', value: 'cancel' }, 'Cancelar'),
      h('button', { class: 'btn primary', value: 'ok', onclick: async (e) => {
        e.preventDefault();
        if (ntfy.checked && !ntfyTopic) { ntfyTopic = newTopic(); ntfyKey = newShareKey(); }
        const share = {
          ...sh, enabled: enabled.checked, name: name.value.trim(), what: what.value, images: images.value, direction: direction.value,
          cloud: { on: cloud.checked && sync.enabled },
          ntfy: { on: ntfy.checked, server: (ntfyServer.value || 'https://ntfy.sh').trim(), topic: ntfyTopic, key: ntfyKey, plain: ntfyPlain.checked },
          telegram: { on: tg.checked && !!tgChat, token: tgToken.value.trim(), chatId: tgChat, bot: tgBot },
          lan: { on: lan.checked, port: Math.min(65535, Math.max(1024, +lanPort.value || 41414)), token: lanToken },
        };
        if (tg.checked && !tgChat) say.textContent = t('Telegram: falta conectar o bot (botão Conectar).');
        await setClipConfig({ share });
        await chrome.runtime.sendMessage({ type: 'clipshare:sync' }).catch(() => {});
        dlg.close();
        ctx.toast(share.enabled ? 'Compartilhamento salvo 📤' : 'Compartilhamento desligado');
      } }, 'Salvar'))));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
