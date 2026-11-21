// Widget: E-mail (#20) — e-mails não lidos de várias contas, com avisos.
import { h } from '../lib/ui.js';
import { t } from '../lib/i18n.js';
import { relTime } from '../lib/brain.js';
import { requestAccess } from '../lib/permissions.js';
import {
  MAIL_KEY, MAIL_CFG_KEY, GMAIL_ORIGIN, FILTERS, ADAPTERS, mailConfig, setMailConfig, mailCache, allEntries, forgetMail,
} from '../lib/mail.js';

const COLORS = ['#ea4335', '#4285f4', '#34a853', '#fbbc05', '#a142f4', '#24c1e0'];
const check = (rediscover = false) => chrome.runtime.sendMessage({ type: 'mail:check', rediscover }).catch((e) => ({ error: e.message }));

export default {
  id: 'email',
  title: 'E-mail',
  icon: '✉️',
  description: 'E-mails não lidos de todas as suas contas do Gmail, com aviso quando chega um novo. Abre a mensagem no Gmail com um clique.',
  defaultW: 5,
  mount(el, ctx) {
    let cfg = null;
    let cache = null;
    let only = ctx.widget.account || '';
    let busy = false;
    el.classList.add('mail-w');
    const chips = h('div', { class: 'mail-chips', role: 'tablist', 'aria-label': t('Contas') });
    const list = h('ul', { class: 'mail-list' });
    const foot = h('small', { class: 'muted mail-foot' });
    ctx.actions.append(
      h('button', { title: 'Verificar agora', onclick: () => refresh() }, '↻'),
      h('button', { title: 'Escrever um e-mail', onclick: () => compose() }, '✏️'),
      h('button', { title: 'Configurar o e-mail', onclick: () => settings() }, '⚙️'),
    );
    el.append(chips, list, foot);
    // ordem das contas = ordem no Gmail (u/0, u/1…); o armazenamento do Chrome não guarda a ordem das chaves
    const ordered = () => Object.entries(cfg.accounts).sort(([, a], [, b]) => (a.index ?? 99) - (b.index ?? 99) || a.email.localeCompare(b.email));
    const color = (k) => COLORS[ordered().findIndex(([x]) => x === k) % COLORS.length];
    const visible = () => ordered().filter(([, a]) => a.show && !a.missing);

    async function refresh(rediscover = false) {
      if (busy) return;
      busy = true;
      foot.textContent = t('Verificando…');
      const r = await check(rediscover);
      busy = false;
      if (r?.error) ctx.toast(r.error);
      await reload();
    }
    function compose() {
      const accs = visible();
      if (!accs.length) return settings();
      const [, acc] = accs.find(([k]) => k === only) || accs[0];
      window.open(ADAPTERS[acc.provider].composeUrl(acc), '_blank', 'noopener');
    }

    async function connect() {
      const ok = await requestAccess({ origins: [GMAIL_ORIGIN] }); // no clique
      if (!ok) return ctx.toast('Sem acesso ao Gmail, o widget não consegue ver os e-mails.');
      await setMailConfig({ enabled: true });
      await refresh(true);
      if (!visible().length) ctx.toast('Nenhuma conta aberta no Gmail neste navegador. Entre no Gmail e clique em ↻.');
    }

    function render() {
      if (!cfg) return;
      if (!cfg.enabled) {
        chips.replaceChildren();
        foot.textContent = '';
        list.replaceChildren(h('li', { class: 'mail-empty' },
          h('p', {}, 'Veja os e-mails não lidos de todas as suas contas do Gmail aqui, com aviso quando chegar um novo.'),
          h('p', { class: 'muted' }, 'Usa a sessão do Gmail que já está aberta neste navegador: nenhuma senha é pedida ou guardada. Os e-mails ficam só neste computador.'),
          h('button', { class: 'btn primary', type: 'button', onclick: connect }, '✉️ Conectar o Gmail'),
          h('p', { class: 'muted' }, `Outlook: ${t('em breve')} (${ADAPTERS.outlook.soon}).`)));
        return;
      }
      const accs = visible();
      const total = accs.reduce((n, [k]) => n + (cache.byAccount[k]?.unread || 0), 0);
      const chip = (k, label, n, err, dot) => h('button', { class: 'chip mail-chip' + (only === k ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(only === k), title: err || label,
        onclick: () => { only = k; ctx.saveWidget({ account: k }); render(); } },
        dot ? h('span', { class: 'mail-dot', style: `background:${dot}` }) : null, label, n ? h('b', {}, ` ${n > 99 ? '99+' : n}`) : null, err ? ' ⚠️' : '');
      chips.replaceChildren(...(accs.length > 1 ? [chip('', t('Todas'), total)] : []), ...accs.map(([k, a]) => chip(k, a.email, cache.byAccount[k]?.unread || 0, cache.byAccount[k]?.error, accs.length > 1 ? color(k) : null)));
      if (only && !accs.some(([k]) => k === only)) only = '';
      const items = allEntries(cfg, cache, only);
      list.replaceChildren(...items.map((e) => h('li', { class: 'mail-item' },
        h('a', { class: 'mail-main', href: e.link || ADAPTERS[e.provider].openUrl({ index: e.index }), target: '_blank', rel: 'noopener noreferrer', title: t('Abrir no Gmail') },
          accs.length > 1 ? h('span', { class: 'mail-dot', style: `background:${color(e.account)}`, title: e.email }) : null,
          h('span', { class: 'mail-txt' },
            h('span', { class: 'mail-top' }, h('b', { class: 'mail-from' }, e.from || e.fromEmail), h('small', { class: 'muted' }, relTime(e.at))),
            h('span', { class: 'mail-subj' }, e.subject),
            e.snippet ? h('span', { class: 'mail-snip muted' }, e.snippet) : null)),
        h('button', { class: 'chip mail-task', type: 'button', title: t('Criar tarefa para responder'), onclick: async () => {
          await ctx.capture({ type: 'task', text: `${t('Responder')}: ${e.subject} (${e.from || e.fromEmail})`, url: e.link, source: 'email' });
          ctx.toast('Tarefa criada ☑️');
        } }, '☑️'))));
      const errs = accs.map(([k, a]) => cache.byAccount[k]?.error && `${a.email}: ${cache.byAccount[k].error}`).filter(Boolean);
      if (!items.length) {
        list.append(h('li', { class: 'mail-empty muted' }, !accs.length
          ? h('span', {}, t('Nenhuma conta encontrada. Entre no Gmail neste navegador e clique em ↻.'))
          : errs.length ? h('span', {}, errs.join(' · ')) : h('span', {}, t('Nenhum e-mail não lido 🎉'))));
      } else if (errs.length) list.prepend(h('li', { class: 'mail-err' }, '⚠️ ' + errs.join(' · ')));
      const muted = cfg.muteUntil > Date.now() ? ` · 🔕 ${t('avisos silenciados até')} ${new Date(cfg.muteUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
      foot.textContent = cache.checkedAt ? `${t('Verificado')} ${relTime(cache.checkedAt)}${muted}` : '';
    }

    function settings() {
      if (!cfg.enabled) return connect();
      const say = h('p', { class: 'muted', role: 'status' });
      const rows = ordered().map(([k, a]) => {
        const show = h('input', { type: 'checkbox', checked: a.show !== false, 'aria-label': t('Mostrar') });
        const notify = h('input', { type: 'checkbox', checked: a.notify !== false, 'aria-label': t('Avisar') });
        const filter = h('select', { 'aria-label': t('Quais e-mails') }, ...Object.entries(FILTERS).map(([v, f]) => h('option', { value: v, selected: (a.filter || 'inbox') === v }, f.label)));
        const tr = h('tr', {},
          h('td', {}, h('span', { class: 'mail-dot', style: `background:${color(k)}` }), ` ${a.email}`, a.missing ? h('small', { class: 'muted' }, ` · ${t('não está aberta neste navegador')}`) : null),
          h('td', {}, show), h('td', {}, notify), h('td', {}, filter),
          h('td', {}, h('button', { class: 'btn', type: 'button', title: t('Esquecer esta conta'), onclick: () => { delete cfg.accounts[k]; tr.remove(); } }, '✕')));
        return { k, tr, show, notify, filter };
      });
      const interval = h('select', {}, ...[2, 5, 10, 15, 30, 60].map((n) => h('option', { value: n, selected: +cfg.interval === n }, `${n} min`)));
      const notifyAll = h('input', { type: 'checkbox', checked: cfg.notify });
      const mute = h('select', {},
        h('option', { value: '' }, cfg.muteUntil > Date.now() ? t('Manter como está') : t('Não silenciar')),
        h('option', { value: '0' }, t('Tirar o silêncio')),
        h('option', { value: '60' }, t('Por 1 hora')),
        h('option', { value: '240' }, t('Por 4 horas')),
        h('option', { value: 'tomorrow' }, t('Até amanhã às 8h')));
      const dlg = h('dialog', { class: 'dlg mail-dlg' }, h('form', { method: 'dialog' },
        h('h2', {}, '✉️ E-mail'),
        h('h3', {}, 'Contas'),
        h('table', { class: 'mail-acc' }, h('thead', {}, h('tr', {}, h('th', {}, 'Conta'), h('th', {}, 'Mostrar'), h('th', {}, 'Avisar'), h('th', {}, 'Quais e-mails'), h('th', {}))), h('tbody', {}, ...rows.map((r) => r.tr))),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          say.textContent = t('Procurando…');
          await check(true);
          dlg.close();
          settings();
        } }, '🔍 Procurar contas de novo'),
        h('p', { class: 'muted' }, 'As contas são as que estão abertas no Gmail deste navegador. Para acrescentar uma, entre nela no Gmail e clique em "Procurar contas de novo".'),
        h('h3', {}, 'Avisos'),
        h('label', { class: 'clip-opt' }, notifyAll, h('span', {}, h('b', {}, 'Avisar quando chegar um e-mail novo'))),
        h('label', {}, 'Verificar a cada', interval),
        h('label', {}, 'Silenciar os avisos', mute),
        h('h3', {}, 'Outros provedores'),
        h('p', { class: 'muted' }, `📨 Outlook / Microsoft 365: ${t('em breve, pela conta Microsoft')} (${ADAPTERS.outlook.soon}). iCloud e outros (IMAP): ${t('não há um caminho oficial para uma extensão de navegador.')}`),
        say,
        h('div', { class: 'actions' },
          h('button', { class: 'btn danger', type: 'button', onclick: async () => {
            if (!confirm(t('Desconectar o e-mail? As contas e os e-mails guardados neste computador são apagados.'))) return;
            await forgetMail();
            await chrome.permissions.remove({ origins: [GMAIL_ORIGIN] }).catch(() => {});
            dlg.close();
            ctx.toast('E-mail desconectado');
          } }, 'Desconectar e apagar'),
          h('button', { class: 'btn', value: 'cancel' }, 'Cancelar'),
          h('button', { class: 'btn primary', value: 'ok', onclick: async (e) => {
            e.preventDefault();
            for (const r of rows) if (cfg.accounts[r.k]) Object.assign(cfg.accounts[r.k], { show: r.show.checked, notify: r.notify.checked, filter: r.filter.value });
            let muteUntil = cfg.muteUntil;
            if (mute.value === '0') muteUntil = 0;
            else if (mute.value === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); muteUntil = +d; }
            else if (mute.value) muteUntil = Date.now() + +mute.value * 60e3;
            await setMailConfig({ accounts: cfg.accounts, interval: +interval.value, notify: notifyAll.checked, muteUntil });
            dlg.close();
            ctx.toast('Configurações do e-mail salvas');
            refresh();
          } }, 'Salvar'))));
      document.body.append(dlg);
      dlg.addEventListener('close', () => dlg.remove());
      dlg.showModal();
    }

    async function reload() {
      [cfg, cache] = await Promise.all([mailConfig(), mailCache()]);
      render();
    }
    const onStore = (ch, area) => { if (area === 'local' && (ch[MAIL_KEY] || ch[MAIL_CFG_KEY])) reload(); };
    chrome.storage.onChanged.addListener(onStore);
    ctx.onCleanup(() => chrome.storage.onChanged.removeListener(onStore));
    ctx.every(60_000, render);
    reload().then(() => {
      // abriu a nova aba e a última verificação é antiga: verifica agora
      if (cfg.enabled && Date.now() - (cache.checkedAt || 0) > Math.max(1, cfg.interval) * 60e3) refresh();
    });
    return {};
  },
};
