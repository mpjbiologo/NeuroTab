// Widget: Área de transferência (#51) — histórico do que você copia, só neste computador.
import { h } from '../lib/ui.js';
import { requestAccess } from '../lib/permissions.js';
import { parseReminder, relTime } from '../lib/brain.js';
import { saveCapture } from '../lib/captures.js';
import {
  CLIP_KEY, CLIP_CFG_KEY, KINDS, RETENTION, DEFAULT_IGNORE, loadClips, clipConfig, setClipConfig, addClip, updateClip,
  removeClip, clearClips, pruneClips, searchClips, shrinkImage, dataUrlToBlob, hostOf,
} from '../lib/clipboard.js';
import { shareConfig } from '../lib/clipboard-share.js';
import { openShareDialog, qrDialog, QR_MAX } from './clipboard-share-ui.js';
import { t } from '../lib/i18n.js';

const perms = () => globalThis.chrome?.permissions;
const hasRead = () => perms()?.contains({ permissions: ['clipboardRead'] }).catch(() => false) ?? false;
const hasSites = () => perms()?.contains({ origins: ['https://*/*'] }).catch(() => false) ?? false;
const continuousHere = () => !!globalThis.chrome?.offscreen; // Chrome/Edge: acompanha mesmo sem a nova aba aberta

const FILTERS = [['', 'Tudo'], ['link', 'Links'], ['text', 'Textos'], ['code', 'Código'], ['image', 'Imagens'], ['pinned', '⭐ Fixados']];

/** PNG para devolver uma imagem à área de transferência (a API só aceita PNG). */
async function toPng(dataUrl) {
  const bmp = await createImageBitmap(dataUrlToBlob(dataUrl));
  const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

export default {
  id: 'clipboard',
  title: 'Área de transferência',
  icon: '📋',
  description: 'Histórico do que você copia, só neste computador: copie de novo com um clique, fixe, pesquise e transforme em nota.',
  defaultW: 4,
  mount(el, ctx) {
    let items = [];
    let cfg = null;
    let q = '';
    let filter = ctx.widget.filter || '';
    let pollTimer = null;

    const status = h('button', { class: 'clip-status', type: 'button', onclick: () => togglePause() });
    const search = h('input', { type: 'search', class: 'clip-search', placeholder: 'Pesquisar no que você copiou', oninput: () => { q = search.value; render(); } });
    const kinds = h('select', { class: 'clip-filter', title: 'Filtrar', onchange: () => { filter = kinds.value; ctx.saveWidget({ filter }); render(); } },
      ...FILTERS.map(([v, l]) => h('option', { value: v, selected: v === filter }, l)));
    const list = h('ul', { class: 'clip-list' });
    const drop = h('div', { class: 'clip-drop', tabindex: '0', title: 'Clique aqui e cole (Ctrl+V)' }, '⌨️ Clique aqui e cole (Ctrl+V)');
    ctx.actions.append(
      h('button', { title: 'Compartilhar com outros aparelhos', onclick: () => openShareDialog(ctx) }, '📤'),
      h('button', { title: 'Colar o que está copiado agora', onclick: () => pasteNow() }, '📋'),
      h('button', { title: 'Configurar a área de transferência', onclick: () => settings() }, '⚙️'),
    );
    el.classList.add('clip-w');
    el.append(h('div', { class: 'clip-bar' }, status, h('div', { class: 'clip-tools' }, search, kinds)), list, drop);

    // ---------- Captura manual ----------
    async function addFromPaste(dt, via = 'paste') {
      const file = [...(dt?.files || [])].find((f) => f.type.startsWith('image/'));
      const text = dt?.getData?.('text/plain') || '';
      if (file) return result(await addClip({ image: await shrinkImage(file), via }));
      if (text) return result(await addClip({ text, via, force: true }));
      ctx.toast('Nada para colar.');
    }
    function result(r) {
      if (r?.skipped === 'sensitive') ctx.toast(`Parece ${t(r.why)}: não guardei. Desligue a proteção em ⚙️ se precisar.`);
      else if (r?.skipped) ctx.toast('Não guardado.');
      else ctx.toast(r?.duplicate ? 'Já estava no histórico: subiu para o topo.' : 'Guardado na área de transferência 📋');
    }
    async function pasteNow() {
      // pedido no clique, sem esperar nada antes (o navegador exige o gesto)
      const granted = await perms()?.request({ permissions: ['clipboardRead'] }).catch(() => false);
      if (!granted) { drop.focus(); return ctx.toast('Sem permissão para ler: clique no quadro e cole com Ctrl+V.'); }
      try {
        const parts = await navigator.clipboard.read();
        for (const p of parts) {
          const img = p.types.find((x) => x.startsWith('image/'));
          if (img) return result(await addClip({ image: await shrinkImage(await p.getType(img)), via: 'manual' }));
        }
        const text = await navigator.clipboard.readText();
        if (text) return result(await addClip({ text, via: 'manual', force: true }));
        ctx.toast('A área de transferência está vazia.');
      } catch {
        const text = await navigator.clipboard.readText().catch(() => '');
        if (text) result(await addClip({ text, via: 'manual', force: true }));
        else ctx.toast('Não consegui ler: clique no quadro e cole com Ctrl+V.');
      }
    }
    drop.addEventListener('paste', (e) => { e.preventDefault(); addFromPaste(e.clipboardData).catch((err) => ctx.toast(err.message)); });

    // ---------- Ações dos itens ----------
    async function copyBack(it) {
      try {
        if (it.kind === 'image') await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toPng(it.image.data) })]);
        else await navigator.clipboard.writeText(it.text);
        await updateClip(it.id, { updatedAt: Date.now() });
        ctx.toast('Copiado ✓');
      } catch (e) { ctx.toast('Não consegui copiar: ' + e.message); }
    }
    async function toBrain(it, type) {
      const text = it.text.trim();
      const remindAt = type === 'task' ? parseReminder(text) : null;
      await ctx.capture({
        type: it.kind === 'link' && type === 'note' ? 'page' : type, text: it.kind === 'link' ? '' : text,
        url: it.kind === 'link' ? text : it.source?.url || '', pageTitle: it.source?.title || '', remindAt, source: 'clipboard',
      });
      ctx.toast(type === 'task' ? 'Tarefa criada ☑️' : 'Salvo no cérebro 🧠');
    }
    async function toLibrary(it) {
      await saveCapture({ blob: dataUrlToBlob(it.image.data), type: it.image.type, pageUrl: it.source?.url || '', pageTitle: it.source?.title || '', fileName: 'copiada', source: 'clipboard' });
      window.dispatchEvent(new Event('nt-image-captured'));
      ctx.toast('Imagem na biblioteca 🖼️');
    }

    // ---------- Lista ----------
    function preview(it) {
      if (it.kind === 'image') return h('img', { class: 'clip-img', src: it.image.data, alt: t('Imagem copiada'), loading: 'lazy' });
      if (it.kind === 'color') return h('span', { class: 'clip-txt' }, h('span', { class: 'clip-swatch', style: `background:${it.text.trim()}` }), it.text.trim());
      return h('span', { class: 'clip-txt' + (it.kind === 'code' ? ' code' : '') }, it.text.length > 400 ? it.text.slice(0, 400) + '…' : it.text);
    }
    function row(it) {
      const icon = KINDS[it.kind]?.icon || '📄';
      const share = shareConfig(cfg);
      const meta = [
        it.origin === 'remote' ? `📥 ${it.from?.name || t('outro aparelho')}` : it.source?.url ? hostOf(it.source.url) : '',
        relTime(it.updatedAt), it.count > 1 ? `×${it.count}` : '',
        it.sharedAt && it.sharedVia?.length ? '📤 ✓' : '', it.shareError ? '⚠️' : '',
      ].filter(Boolean).join(' · ');
      const canSend = share.enabled && share.direction !== 'receive' && it.origin !== 'remote';
      const btn = (title, label, fn) => h('button', { class: 'chip', type: 'button', title, onclick: (e) => { e.stopPropagation(); fn().catch((err) => ctx.toast(err.message)); } }, label);
      return h('li', { class: 'clip-item' + (it.pinned ? ' pinned' : ''), 'data-kind': it.kind },
        h('button', { class: 'clip-main', type: 'button', title: t('Clique para copiar de novo'), onclick: () => copyBack(it) },
          h('span', { class: 'clip-ico', 'aria-hidden': 'true' }, icon), preview(it)),
        h('div', { class: 'clip-meta' },
          h('small', { class: 'muted', title: it.source?.title || '' }, meta),
          h('span', { class: 'clip-acts', title: it.shareError || '' },
            btn(it.pinned ? 'Desafixar' : 'Fixar (não apaga sozinho)', it.pinned ? '★' : '☆', () => updateClip(it.id, { pinned: !it.pinned })),
            it.kind === 'link' ? h('a', { class: 'chip', href: /^https?:/i.test(it.text.trim()) ? it.text.trim() : 'https://' + it.text.trim(), target: '_blank', rel: 'noopener noreferrer', title: t('Abrir'), onclick: (e) => e.stopPropagation() }, '↗') : null,
            it.kind !== 'image' ? btn('Salvar como nota', '🧠', () => toBrain(it, 'note')) : null,
            it.kind !== 'image' && it.kind !== 'link' ? btn('Salvar como tarefa', '☑️', () => toBrain(it, 'task')) : null,
            it.kind === 'image' ? btn('Guardar na biblioteca de imagens', '🖼️', () => toLibrary(it)) : null,
            it.kind !== 'image' && it.text.length <= QR_MAX ? btn('Mostrar QR para o celular', '📱', async () => qrDialog(t('Ler com o celular'), it.text, t('Aponte a câmera do celular para o código.'))) : null,
            canSend ? btn(it.sharedAt ? 'Enviar de novo para meus aparelhos' : 'Enviar para meus aparelhos', '📤', async () => { await updateClip(it.id, { shareRequested: true, sharedAt: null, shareError: '' }); ctx.toast('Enviando para seus aparelhos 📤'); }) : null,
            btn('Excluir', '✕', () => removeClip(it.id)))));
    }
    function render() {
      if (!cfg) return;
      const on = [cfg.sites && t('ao copiar em sites'), cfg.monitor && t(continuousHere() ? 'tudo o que você copia' : 'tudo o que você copia com a nova aba aberta')].filter(Boolean);
      status.className = 'clip-status ' + (cfg.paused ? 'paused' : on.length ? 'on' : 'manual');
      status.textContent = cfg.paused ? t('⏸ Pausado · clique para retomar') : on.length ? `● ${t('Capturando')}: ${on.join(' · ')}` : t('Só o que você colar aqui');
      status.title = cfg.paused ? t('Retomar a captura') : on.length ? t('Pausar a captura') : t('Ligue a captura automática em ⚙️');
      const shown = searchClips(filter === 'pinned' ? items.filter((x) => x.pinned) : items, q, filter === 'pinned' ? '' : filter);
      list.replaceChildren(...shown.map(row));
      if (!items.length) {
        list.append(h('li', { class: 'clip-empty muted' },
          h('p', {}, 'Nada copiado ainda.'),
          h('p', {}, 'Cole aqui embaixo ou ligue a captura automática em ⚙️. Tudo fica só neste computador.'),
          h('button', { class: 'btn', type: 'button', onclick: () => settings() }, '⚙️ Configurar')));
      } else if (!shown.length) list.append(h('li', { class: 'clip-empty muted' }, 'Nada encontrado.'));
    }
    async function togglePause() {
      if (!cfg.sites && !cfg.monitor && !cfg.paused) return settings();
      cfg = await setClipConfig({ paused: !cfg.paused });
      ctx.toast(cfg.paused ? 'Captura pausada' : 'Captura retomada');
    }

    // ---------- Configurações ----------
    function settings() {
      const say = h('p', { class: 'muted', role: 'status' });
      const sites = h('input', { type: 'checkbox', checked: !!cfg.sites });
      const monitor = h('input', { type: 'checkbox', checked: !!cfg.monitor });
      const retention = h('select', {}, ...Object.entries(RETENTION).map(([k, r]) => h('option', { value: k, selected: k === cfg.retention }, r.label)));
      const max = h('select', {}, ...[50, 100, 200, 500].map((n) => h('option', { value: n, selected: n === cfg.max }, `${n} ${t('itens')}`)));
      const protect = h('input', { type: 'checkbox', checked: cfg.protect !== false });
      const ignore = h('textarea', { rows: 5, spellcheck: 'false' }, (cfg.ignore || DEFAULT_IGNORE).join('\n'));
      sites.addEventListener('change', async () => {
        if (!sites.checked) return;
        const ok = await requestAccess({ origins: ['https://*/*'] }); // no clique
        if (!ok) { sites.checked = false; say.textContent = t('Sem o acesso aos sites, essa captura não funciona.'); }
      });
      monitor.addEventListener('change', async () => {
        if (!monitor.checked) return;
        const ok = await perms()?.request({ permissions: ['clipboardRead'] }).catch(() => false);
        if (!ok) { monitor.checked = false; say.textContent = t('Sem a permissão de ler a área de transferência, o acompanhamento não funciona.'); return; }
        if (!confirm(t('Ligar o acompanhamento? A NeuroTab vai guardar, só neste computador, tudo o que você copiar (de qualquer programa) enquanto o navegador estiver aberto. O ícone da extensão mostra um ● enquanto estiver ligado. Senhas e códigos são ignorados quando reconhecidos.'))) monitor.checked = false;
      });
      const dlg = h('dialog', { class: 'dlg clip-dlg' }, h('form', { method: 'dialog' },
        h('h2', {}, '📋 Área de transferência'),
        h('p', { class: 'muted' }, 'Tudo fica só neste computador: não sincroniza, não vai para o backup e não é enviado à IA. Só vira nota se você pedir.'),
        h('h3', {}, 'O que capturar'),
        h('label', { class: 'clip-opt' }, h('input', { type: 'checkbox', checked: true, disabled: true }),
          h('span', {}, h('b', {}, 'O que você colar aqui'), h('small', { class: 'muted' }, 'Sempre ligado: clique no quadro do widget e cole, ou use o botão 📋.'))),
        h('label', { class: 'clip-opt' }, sites,
          h('span', {}, h('b', {}, 'Ao copiar em sites'), h('small', { class: 'muted' }, 'Guarda o texto e o site de origem. Pede acesso aos sites. Não funciona em janelas anônimas nem em campos de senha.'))),
        h('label', { class: 'clip-opt' }, monitor,
          h('span', {}, h('b', {}, 'Acompanhar tudo o que eu copio'), h('small', { class: 'muted' }, continuousHere()
            ? 'De qualquer programa (Word, PDF, WhatsApp…), enquanto o navegador estiver aberto. O ícone da extensão mostra um ● quando está ligado.'
            : 'De qualquer programa, enquanto uma nova aba da NeuroTab estiver aberta (o Firefox não deixa acompanhar com ela fechada).'))),
        h('h3', {}, 'Por quanto tempo guardar'),
        h('label', {}, 'Apagar sozinho', retention),
        h('label', {}, 'Guardar no máximo', max),
        h('p', { class: 'muted' }, 'Os itens fixados (★) nunca são apagados sozinhos.'),
        h('h3', {}, 'Proteção'),
        h('label', { class: 'clip-opt' }, protect, h('span', {}, h('b', {}, 'Ignorar o que parece senha, código de verificação, chave ou cartão'))),
        h('label', {}, 'Sites ignorados (um por linha)', ignore),
        h('button', { class: 'btn', type: 'button', onclick: () => { ignore.value = DEFAULT_IGNORE.join('\n'); } }, 'Restaurar a lista padrão'),
        h('h3', {}, 'Compartilhar com outros aparelhos'),
        h('p', { class: 'muted' }, 'QR code, sua nuvem, ntfy, Telegram ou a rede local: você escolhe.'),
        h('button', { class: 'btn', type: 'button', onclick: () => { dlg.close(); openShareDialog(ctx); } }, '📤 Configurar compartilhamento'),
        say,
        h('div', { class: 'actions' },
          h('button', { class: 'btn danger', type: 'button', onclick: async () => {
            if (!confirm(t('Apagar todo o histórico? Os itens fixados (★) ficam.'))) return;
            await clearClips({ keepPinned: true });
            say.textContent = t('Histórico apagado.');
          } }, '🗑 Limpar histórico'),
          h('button', { class: 'btn', value: 'cancel' }, 'Cancelar'),
          h('button', { class: 'btn primary', value: 'ok', onclick: async (e) => {
            e.preventDefault();
            const sitesOk = sites.checked && (await hasSites());
            const monOk = monitor.checked && (await hasRead());
            cfg = await setClipConfig({
              sites: sitesOk, monitor: monOk, retention: retention.value, max: +max.value, protect: protect.checked,
              ignore: ignore.value.split('\n').map((x) => x.trim()).filter(Boolean), paused: false,
            });
            await pruneClips();
            dlg.close();
            ctx.toast(sitesOk || monOk ? 'Captura ligada 📋' : 'Configurações salvas');
          } }, 'Salvar'))));
      document.body.append(dlg);
      dlg.addEventListener('close', () => dlg.remove());
      dlg.showModal();
    }

    // ---------- Firefox: acompanhar com a nova aba aberta ----------
    function syncPolling() {
      clearInterval(pollTimer);
      pollTimer = null;
      if (!cfg?.monitor || cfg.paused || continuousHere()) return;
      let last = null;
      pollTimer = setInterval(async () => {
        if (document.visibilityState !== 'visible') return;
        const text = await navigator.clipboard.readText().catch(() => null);
        if (text == null) return;
        if (last === null) { last = text; return; }
        if (text && text !== last) { last = text; await addClip({ text, via: 'monitor' }); }
      }, 2000);
    }

    // 🔔 ntfy ao vivo: com a nova aba aberta, chega na hora (o fundo confere a cada 30 s)
    let live = null;
    let liveKey = '';
    function syncLive() {
      const sh = shareConfig(cfg);
      const on = sh.enabled && sh.direction !== 'send' && sh.ntfy.on && sh.ntfy.topic;
      const key = on ? `${sh.ntfy.server}|${sh.ntfy.topic}` : '';
      if (key === liveKey) return;
      live?.close();
      live = null;
      liveKey = key;
      if (!on) return;
      try {
        live = new EventSource(`${sh.ntfy.server.replace(/\/+$/, '')}/${encodeURIComponent(sh.ntfy.topic)}/sse`);
        live.onmessage = () => chrome.runtime.sendMessage({ type: 'clipshare:poll', only: 'ntfy' }).catch(() => {});
      } catch { /* sem ao vivo: fica o alarme */ }
    }

    async function reload() {
      [items, cfg] = await Promise.all([loadClips(), clipConfig()]);
      render();
      syncPolling();
      syncLive();
    }
    const onStore = (changes, areaName) => { if (areaName === 'local' && (changes[CLIP_KEY] || changes[CLIP_CFG_KEY])) reload(); };
    chrome.storage.onChanged.addListener(onStore);
    ctx.onCleanup(() => { chrome.storage.onChanged.removeListener(onStore); clearInterval(pollTimer); live?.close(); });
    ctx.every(60_000, render); // "há 2 min" anda
    pruneClips().finally(reload);
    return {};
  },
};
