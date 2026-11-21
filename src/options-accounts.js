// Configurações → Contas e sincronização (contas Google; Microsoft na 0.7.6.3).
import { h } from './lib/ui.js';
import { t } from './lib/i18n.js';
import { requestAccess } from './lib/permissions.js';
import { listAccounts, connectGoogle, disconnect, providerReady, redirectUrl, requestIdentity, ACCOUNTS_KEY, OAUTH_OVERRIDE_KEY, clientId } from './lib/accounts.js';
import { OAUTH } from './lib/oauth-config.js';
import { syncConfig, enableSync, disableSync, wipeRemote, syncNow, remoteInfo, updateSyncConfig, CATEGORIES, SYNC_KEY } from './lib/sync.js';

const CAT_LABEL = { brain: '🧠 Cérebro (notas, tarefas, trechos e lixeira)', shortcuts: '🔗 Atalhos e grupos', settings: '⚙️ Configurações (sem as chaves de API)', agenda: '📅 Agenda (Minha agenda e links)', habits: '✅ Hábitos' };
const $ = (s) => document.querySelector(s);
const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function setupAccounts(toast) {
  const root = $('#tab-contas');
  if (!root) return;
  const accBox = h('div', { class: 'acc-list' });
  const accMsg = h('p', { class: 'hint', role: 'status' });
  const syncBox = h('div', { class: 'sync-box' });
  const syncMsg = h('p', { class: 'hint', role: 'status' });
  const say = (el, text, bad) => { el.textContent = text ? t(text) : ''; el.classList.toggle('err', !!bad); };

  const connectBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    const perm = requestIdentity(); // no clique, sem await antes
    connectBtn.disabled = true;
    try {
      if (!(await perm)) throw new Error('Sem a permissão de identidade do navegador, não dá para entrar com a conta.');
      const acc = await connectGoogle();
      say(accMsg, `✓ ${acc.email} conectada.`);
      await draw();
    } catch (e) { say(accMsg, e.message, e.code !== 'cancelled'); } finally { connectBtn.disabled = !(await providerReady('google')); }
  } }, '＋ Conectar conta Google');

  root.append(
    h('h2', { 'data-page': 'contas' }, 'Contas conectadas'),
    h('p', {}, 'Conecte uma ou mais contas para sincronizar suas notas entre aparelhos e, em breve, ver a agenda e os e-mails dessas contas. O acesso fica guardado só neste navegador: nada passa por servidores da NeuroTab.'),
    accBox,
    h('div', { class: 'row' }, connectBtn, h('button', { class: 'btn', type: 'button', disabled: true, title: 'Na próxima versão' }, 'Microsoft (em breve)')),
    accMsg,
    h('details', { class: 'hint' }, h('summary', {}, 'Para quem configura o login (desenvolvimento)'),
      h('p', {}, 'Endereço de retorno deste navegador, para cadastrar no cliente OAuth:'), h('code', { id: 'redirectUrl' }, redirectUrl() || '(o navegador mostra depois de permitir a identidade)'),
      OAUTH.google.clientId ? null : h('div', {},
        h('p', {}, 'ID do cliente OAuth do Google, só para testar neste navegador antes de ele entrar no código:'),
        h('div', { class: 'row' }, h('input', { class: 'txt', id: 'clientOverride', placeholder: '…apps.googleusercontent.com', spellcheck: false, style: 'flex:1;min-width:0' }),
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            const v = $('#clientOverride').value.trim();
            if (v && !/\.apps\.googleusercontent\.com$/.test(v)) return say(accMsg, 'Esse não parece um ID de cliente do Google (termina em .apps.googleusercontent.com).', true);
            await chrome.storage.local.set({ [OAUTH_OVERRIDE_KEY]: v ? { google: v } : {} });
            say(accMsg, v ? '✓ ID salvo neste navegador. Já dá para conectar a conta.' : 'ID removido.');
            draw();
          } }, 'Salvar')))),
    h('h2', { 'data-page': 'sync' }, 'Sincronização'),
    h('p', {}, 'Mantém o cérebro, os atalhos, as configurações, a agenda e os hábitos iguais em todos os seus navegadores, por uma pasta oculta da NeuroTab no seu Google Drive (ela não aparece nos seus arquivos e não ocupa espaço visível).'),
    syncBox,
    syncMsg,
  );

  async function draw() {
    const accounts = await listAccounts();
    const ready = await providerReady('google');
    connectBtn.disabled = !ready;
    if (!ready) say(accMsg, 'O login com Google ainda está sendo liberado. Ele chega numa atualização em breve.');
    else if (accMsg.textContent.includes('sendo liberado')) say(accMsg, '');
    const ov = $('#clientOverride');
    if (ov && !ov.value) ov.value = await clientId('google');
    accBox.replaceChildren(...(accounts.length ? accounts.map((a) => h('div', { class: 'acc' },
      a.picture ? h('img', { src: a.picture, alt: '', referrerpolicy: 'no-referrer', width: 32, height: 32 }) : h('span', { class: 'acc-avatar' }, (a.name || a.email || '?')[0].toUpperCase()),
      h('div', { class: 'grow' }, h('b', {}, a.name || a.email), h('small', {}, `${a.provider === 'google' ? 'Google' : 'Microsoft'} · ${a.email}`)),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        const c = await syncConfig();
        const warn = c.enabled && c.accountId === a.id ? t('A sincronização usa esta conta e será desligada neste aparelho. ') : '';
        if (!confirm(warn + t('Desconectar esta conta? O acesso da NeuroTab a ela será revogado.'))) return;
        if (c.enabled && c.accountId === a.id) await disableSync();
        await disconnect(a.id);
        await draw();
      } }, 'Desconectar'))) : [h('p', { class: 'empty' }, 'Nenhuma conta conectada.')]));
    await drawSync(accounts);
  }

  async function drawSync(accounts) {
    const c = await syncConfig();
    const google = accounts.filter((a) => a.provider === 'google');
    if (c.enabled) {
      const acc = accounts.find((a) => a.id === c.accountId);
      const r = c.lastResult || {};
      syncBox.replaceChildren(
        h('div', { class: 'opt' }, h('div', {},
          h('b', {}, c.paused ? '⏸ Sincronização pausada' : '☁️ Sincronização ligada'),
          h('small', {}, `${acc?.email || '?'} · ${c.mode === 'key' ? t('com senha (só você lê)') : t('sem senha')} · ${t('última')}: ${when(c.lastSync)}${r.conflicts ? ` · ⚠️ ${r.conflicts} ${t('conflito(s): as duas versões ficaram no cérebro')}` : ''}`),
          c.lastError ? h('small', { class: 'err' }, `⚠️ ${t(c.lastError)}`) : null)),
        h('div', { class: 'opt' }, h('div', {}, h('b', {}, 'O que sincroniza')), h('div', { class: 'cats' }, ...CATEGORIES.map((k) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: (c.categories || CATEGORIES).includes(k), onchange: async (e) => {
            const cats = new Set(c.categories || CATEGORIES);
            if (e.target.checked) cats.add(k); else cats.delete(k);
            await updateSyncConfig({ categories: CATEGORIES.filter((x) => cats.has(x)) });
            toast('Salvo ✓');
          } }), ' ', CAT_LABEL[k])))),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: async (e) => { e.target.disabled = true; say(syncMsg, 'Sincronizando…'); try { const x = await syncNow({ interactive: true }); say(syncMsg, x.skipped ? 'Sincronização pausada.' : `✓ ${t('Pronto')}: ${x.up} ${t('enviado(s)')}, ${x.down} ${t('recebido(s)')}.`); } catch (err) { say(syncMsg, err.message, true); } finally { e.target.disabled = false; drawSync(await listAccounts()); } } }, '↻ Sincronizar agora'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { await updateSyncConfig({ paused: !c.paused }); drawSync(await listAccounts()); } }, c.paused ? '▶ Retomar' : '⏸ Pausar'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { if (!confirm(t('Desligar a sincronização neste aparelho? Seus dados continuam aqui e na nuvem.'))) return; await disableSync(); drawSync(await listAccounts()); } }, 'Desligar neste aparelho'),
          h('button', { class: 'btn danger', type: 'button', onclick: async () => {
            if (!confirm(t('Apagar da nuvem tudo o que a NeuroTab guardou nesta conta? Os outros aparelhos param de sincronizar. Os dados deste aparelho continuam aqui.'))) return;
            try { const n = await wipeRemote(); say(syncMsg, `✓ ${n} ${t('arquivo(s) apagado(s) da nuvem.')}`); } catch (err) { say(syncMsg, err.message, true); }
            drawSync(await listAccounts());
          } }, '🗑 Apagar dados da nuvem')),
      );
      return;
    }
    if (!google.length) { syncBox.replaceChildren(h('p', { class: 'muted' }, 'Conecte uma conta Google acima para ligar a sincronização.')); return; }

    // ---------- ligar ----------
    const acct = h('select', {}, ...google.map((a) => h('option', { value: a.id }, a.email)));
    const modeKey = h('input', { type: 'radio', name: 'syncMode', value: 'key', checked: true });
    const modeNone = h('input', { type: 'radio', name: 'syncMode', value: 'none' });
    const pass = h('input', { type: 'password', class: 'txt', autocomplete: 'new-password', placeholder: t('Senha de sincronização (mín. 8 caracteres)') });
    const pass2 = h('input', { type: 'password', class: 'txt', autocomplete: 'new-password', placeholder: t('Repita a senha') });
    const passRow = h('div', { class: 'pass' }, pass, pass2, h('small', { class: 'warn' }, '⚠️ Guarde esta senha. Sem ela, os dados da nuvem não podem ser abertos (os deste aparelho continuam aqui). Ela é a mesma em todos os seus aparelhos.'));
    const cats = CATEGORIES.map((k) => h('input', { type: 'checkbox', checked: true, value: k }));
    const remoteNote = h('p', { class: 'hint' });
    let remote = null;
    const syncMode = () => { passRow.hidden = !modeKey.checked; };
    modeKey.onchange = modeNone.onchange = syncMode;
    const check = async () => {
      remote = null;
      say(remoteNote, '');
      try {
        remote = await remoteInfo(acct.value, { interactive: false });
        if (remote.exists) {
          modeKey.checked = remote.mode === 'key';
          modeNone.checked = remote.mode !== 'key';
          modeKey.disabled = modeNone.disabled = true;
          pass2.hidden = true;
          say(remoteNote, remote.mode === 'key' ? 'Esta conta já sincroniza outro aparelho, com senha. Digite a mesma senha para entrar.' : 'Esta conta já sincroniza outro aparelho, sem senha. É só ligar.');
        } else { modeKey.disabled = modeNone.disabled = false; pass2.hidden = false; }
        syncMode();
      } catch (e) { if (!['interaction_required', 'auth', 'scope', 'flow'].includes(e.code)) say(remoteNote, e.message, true); }
    };
    acct.onchange = check;
    const go = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      // Firefox: consentimento para enviar as notas e os atalhos ao Google Drive (no clique, sem await antes)
      const consent = requestAccess({ data: ['websiteContent', 'bookmarksInfo'] });
      const mode = modeKey.checked ? 'key' : 'none';
      if (mode === 'key' && !remote?.exists && pass.value !== pass2.value) return say(syncMsg, 'As senhas não são iguais.', true);
      if (mode === 'none' && !remote?.exists && !confirm(t('Sem senha, o Google consegue ler suas notas na pasta da NeuroTab. Continuar sem senha?'))) return;
      if (!(await consent)) return say(syncMsg, 'Sem o consentimento do navegador, a sincronização não pode enviar os dados.', true);
      go.disabled = true;
      say(syncMsg, mode === 'key' ? 'Preparando a criptografia e sincronizando… (alguns segundos)' : 'Sincronizando…');
      try {
        const r = await enableSync({ accountId: acct.value, mode, passphrase: pass.value, categories: cats.filter((x) => x.checked).map((x) => x.value) });
        pass.value = pass2.value = '';
        say(syncMsg, `✓ ${t('Sincronização ligada')}: ${r.up} ${t('enviado(s)')}, ${r.down} ${t('recebido(s)')}.`);
        drawSync(await listAccounts());
      } catch (e) { say(syncMsg, e.message, true); } finally { go.disabled = false; }
    } }, '☁️ Ligar sincronização');
    syncBox.replaceChildren(
      h('div', { class: 'opt' }, h('div', {}, h('b', {}, 'Conta')), acct),
      remoteNote,
      h('div', { class: 'opt' }, h('div', {}, h('b', {}, 'Proteção')), h('div', { class: 'cats' },
        h('label', { class: 'check' }, modeKey, ' ', h('span', {}, h('b', {}, 'Com senha (recomendado): '), t('as notas são criptografadas antes de sair do computador; nem o Google consegue ler.'))),
        h('label', { class: 'check' }, modeNone, ' ', h('span', {}, h('b', {}, 'Sem senha: '), t('mais simples, mas o conteúdo fica legível na sua conta Google.'))))),
      passRow,
      h('div', { class: 'opt' }, h('div', {}, h('b', {}, 'O que sincroniza')), h('div', { class: 'cats' }, ...cats.map((x) => h('label', { class: 'check' }, x, ' ', CAT_LABEL[x.value])))),
      h('p', { class: 'hint' }, 'Imagens da biblioteca e chaves de API não sincronizam. A sincronização acontece sozinha depois de cada mudança, a cada 5 minutos e ao abrir o navegador.'),
      h('div', { class: 'row' }, go),
    );
    syncMode();
    check();
  }

  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch[SYNC_KEY] || ch[ACCOUNTS_KEY])) draw(); });
  draw();
}
