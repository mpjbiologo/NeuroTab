// Widget Área de transferência — tela "Compartilhar com outros aparelhos" (0.7.7.2) e o QR de um item.
import { h } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { qrSvg } from '../lib/pix.js';
import { requestAccess } from '../lib/permissions.js';
import { clipConfig, setClipConfig } from '../lib/clipboard.js';
import { shareConfig, newTopic, newShareKey, newToken, ntfyPairLink, lanTargets, SHARE_STATE_KEY } from '../lib/clipboard-share.js';
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

/**
 * QR da rede local (0.9.2.2): um endereço só no QR (o melhor), os outros para escolher
 * se não abrir, e o que conferir quando o celular não alcança o computador.
 */
export function lanQrDialog(targets, { onUseNtfy = null } = {}) {
  let cur = targets[0];
  const img = h('div', { class: 'clip-qr-img' });
  const link = h('code', { class: 'lan-link' });
  const warn = h('p', { class: 'lan-warn', hidden: true });
  const copy = h('button', { class: 'btn', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(cur.url); copy.textContent = `✓ ${t('Copiado')}`; } catch { /* sem permissão */ }
  } }, `📋 ${t('Copiar link')}`);
  const label = (a) => `${a.iface || a.ip}${a.iface ? ` · ${a.ip}` : ''}${a.best ? ` — ${t('recomendado')}` : a.virtual ? ` — ${t('VPN ou adaptador virtual')}` : ''}`;
  const pick = h('div', { class: 'lan-pick', role: 'radiogroup', 'aria-label': t('Endereço') });
  const paint = () => {
    img.innerHTML = qrSvg(cur.url, { size: 260, margin: 2 });
    link.textContent = cur.url.replace(/#.*/, '');
    warn.hidden = !(cur.virtual || cur.publicNet);
    warn.textContent = cur.publicNet
      ? `⚠️ ${t('O Windows marcou esta rede como Pública e o firewall bloqueia o celular. Mude o Wi-Fi para Rede privada (Configurações → Rede e Internet → Wi-Fi → Propriedades).')}`
      : `⚠️ ${t('Este endereço é de uma VPN ou de um adaptador virtual: o celular provavelmente não alcança. Prefira o do Wi-Fi ou da Ethernet.')}`;
    pick.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', targets[i] === cur));
  };
  targets.forEach((a) => pick.append(h('button', { type: 'button', class: 'btn lan-opt', onclick: () => { cur = a; paint(); } }, label(a))));
  const dlg = h('dialog', { class: 'dlg clip-qr lan-qr' }, h('form', { method: 'dialog' },
    h('h2', {}, t('Abrir no celular')),
    img,
    h('p', { class: 'muted' }, t('Aponte a câmera do celular. Ele precisa estar no mesmo Wi-Fi deste computador.')),
    h('div', { class: 'share-row' }, link, copy),
    warn,
    targets.length > 1 ? h('details', {}, h('summary', {}, t('Não abriu? Escolha outro endereço')), pick) : null,
    h('details', {}, h('summary', {}, t('Ainda não abre? Confira')),
      h('ul', { class: 'lan-tips' },
        h('li', {}, t('Celular e computador no mesmo Wi-Fi (não na rede de convidados) e com os dados móveis desligados no teste.')),
        h('li', {}, t('Windows: abra de novo o programa da Ponte e responda Sim para liberar no firewall; o Wi-Fi precisa estar como Rede privada.')),
        h('li', {}, t('VPN no computador (Cloudflare WARP, empresa…): permita o acesso à rede local ou desligue enquanto usa.')),
        h('li', {}, t('Alguns roteadores isolam os aparelhos (isolamento de AP / clientes): desligue essa opção no roteador.')))),
    onUseNtfy ? h('div', { class: 'lan-alt' },
      h('small', { class: 'muted' }, t('Em Wi-Fi público, rede de convidados ou de empresa, a rede local costuma ser bloqueada. O ntfy funciona em qualquer rede, cifrado.')),
      h('button', { class: 'btn', type: 'button', onclick: () => { dlg.close(); onUseNtfy(); } }, `🔔 ${t('Usar ntfy em vez disso')}`)) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', value: 'ok' }, t('Fechar')))));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  paint();
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
  const lanMirror = h('input', { type: 'checkbox', checked: sh.lan.mirror !== false });
  let lanToken = sh.lan.token || newToken();

  const pairNtfy = () => {
    if (!ntfyTopic) { ntfyTopic = newTopic(); ntfyKey = newShareKey(); }
    qrDialog(t('Parear o celular'), ntfyPairLink({ name: name.value, ntfy: { server: ntfyServer.value || 'https://ntfy.sh', topic: ntfyTopic, key: ntfyKey } }), t('Aponte a câmera do celular. Salve a página nos favoritos ou na tela inicial.'));
  };
  /** Rede local bloqueada: liga o ntfy e já mostra o QR de pareamento (0.9.2.3). */
  const useNtfy = async () => {
    let origin;
    try { origin = new URL(ntfyServer.value || 'https://ntfy.sh').origin; } catch { return void (say.textContent = t('Endereço do servidor ntfy inválido.')); }
    if (!(await requestAccess({ origins: [`${origin}/*`] }))) { say.textContent = t('Sem acesso ao servidor do ntfy, esse caminho não funciona.'); return; }
    enabled.checked = true;
    ntfy.checked = true;
    ntfy.closest('.share-card')?.scrollIntoView({ block: 'center' });
    say.textContent = t('🔔 ntfy ligado. Pareie o celular pelo QR e clique em Salvar.');
    pairNtfy();
  };
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
  const lanList = lanTargets(lanSt, lanToken);

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
        h('button', { class: 'btn', type: 'button', onclick: pairNtfy }, '📱 Parear celular'),
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
        h('p', {}, h('b', {}, 'Windows: '), 'abra o arquivo baixado. Se aparecer "O Windows protegeu o computador", clique em "Mais informações" → "Executar assim mesmo". No fim, responda Sim para liberar a Ponte no firewall (redes privadas): sem isso o celular não abre a página.'),
        h('p', {}, h('b', {}, 'macOS: '), 'no Terminal: ', h('code', {}, 'chmod +x ~/Downloads/neurotab-ponte-macos-* && xattr -d com.apple.quarantine ~/Downloads/neurotab-ponte-macos-*; ~/Downloads/neurotab-ponte-macos-*')),
        h('p', {}, h('b', {}, 'Linux: '), h('code', {}, 'chmod +x neurotab-ponte-linux-* && ./neurotab-ponte-linux-*')),
        h('p', { class: 'muted' }, 'Depois de instalar, ligue esta opção e salve. O navegador abre a Ponte sozinho quando precisar.')),
      h('label', { class: 'clip-opt' }, lanMirror, h('span', {}, h('small', {}, 'O celular vê a área de transferência deste computador (os 30 itens mais recentes; o que parece senha nunca é guardado)'))),
      h('label', {}, 'Porta', lanPort),
      lanList.length
        ? h('button', { class: 'btn primary', type: 'button', onclick: () => lanQrDialog(lanList, { onUseNtfy: useNtfy }) }, '📱 Abrir no celular')
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
          lan: { on: lan.checked, port: Math.min(65535, Math.max(1024, +lanPort.value || 41414)), token: lanToken, mirror: lanMirror.checked },
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
