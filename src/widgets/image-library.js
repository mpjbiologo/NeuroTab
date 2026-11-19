// Widget: biblioteca local de imagens capturadas pelo menu de contexto.
import { h } from '../lib/ui.js';
import { listCaptures, deleteCapture, captureStatus } from '../lib/image-index.js';

const STATUS = {
  pending: ['⏳ Ainda não lida', 'O texto será lido aqui no computador em instantes.'],
  done: ['🧠 No cérebro', 'O texto e a descrição já aparecem na busca e nas perguntas ao cérebro.'],
  empty: ['Sem texto', 'Nenhum texto encontrado. Peça uma descrição em Analisar para o cérebro encontrá-la.'],
  error: ['⚠ Não deu para ler', ''],
};
const openAnalyzer = (id) => chrome.windows.create({ url: chrome.runtime.getURL('src/analyze.html?id=' + encodeURIComponent(id)), type: 'popup', width: 560, height: 760 });

export default {
  id: 'image-library',
  title: 'Biblioteca de imagens',
  icon: '🖼️',
  description: 'Imagens salvas de páginas da web, armazenadas localmente no navegador.',
  defaultW: 6,
  mount(el, ctx) {
    const list = h('div', { class: 'nt-image-grid' });
    const status = h('p', { class: 'muted', role: 'status' }, 'Carregando imagens…');
    const refresh = h('button', { class: 'chip', type: 'button' }, '↻ Atualizar');
    let urls = [];
    let destroyed = false;
    el.append(h('div', { class: 'nt-image-toolbar' }, status, refresh), list);

    async function load() {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls = [];
      list.replaceChildren();
      try {
        const records = await listCaptures();
        if (destroyed) return;
        status.textContent = records.length
          ? `${records.length} imagem(ns) salvas neste navegador.`
          : 'Sua biblioteca está vazia. Clique com o botão direito em uma imagem → NeuroTab → Salvar imagem na biblioteca, ou cole uma imagem (Ctrl+V) na Captura rápida.';
        for (const item of records) {
          const url = URL.createObjectURL(item.blob);
          urls.push(url);
          const img = h('img', { src: url, alt: item.fileName || 'Imagem salva', loading: 'lazy' });
          let host = item.url;
          try { host = new URL(item.url).hostname; } catch { /* URL antiga ou inválida */ }
          const source = h('a', {
            href: item.pageUrl || item.url, target: '_blank', rel: 'noopener noreferrer',
            title: item.pageTitle || item.url
          }, item.pageTitle || host);
          const date = new Date(item.capturedAt).toLocaleDateString();
          const size = (item.size / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
          const remove = h('button', { class: 'chip danger', type: 'button', title: 'Excluir imagem', onclick: async () => {
            if (!confirm('Excluir esta imagem da biblioteca? O que o cérebro leu dela também sai.')) return;
            await deleteCapture(item.id);
            await load();
          } }, '🗑 Excluir');
          list.append(h('article', { class: 'nt-image-card' },
            h('a', { class: 'nt-image-preview', href: url, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir imagem' }, img),
            h('div', { class: 'nt-image-meta' },
              h('b', {}, item.fileName || 'Imagem'),
              h('small', {}, `${date} · ${size}`),
              source,
              (() => { const st = captureStatus(item); const [label, tip] = STATUS[st]; return h('small', { class: 'nt-image-status ' + st, title: st === 'error' ? item.analyzeError : tip }, label); })()),
            h('div', { class: 'nt-image-actions' },
              h('button', { class: 'chip', type: 'button', title: 'Ler o texto, descrever e perguntar sobre a imagem', onclick: () => openAnalyzer(item.id) }, '🔍 Analisar'),
              remove)));
        }
      } catch (error) {
        status.textContent = 'Erro ao carregar a biblioteca: ' + error.message;
      }
    }
    // Recarrega quando chega imagem nova, quando uma é excluída e quando o cérebro termina de ler uma.
    let t;
    const later = () => { clearTimeout(t); t = setTimeout(load, 400); };
    const onMessage = (message) => { if (['imageCaptured', 'imageDeleted'].includes(message?.type)) later(); };
    const offBrain = ctx.on('brain.changed', later);
    chrome.runtime.onMessage.addListener(onMessage);
    window.addEventListener('nt-image-captured', load); // imagem colada nesta mesma aba
    refresh.addEventListener('click', load);
    load();
    return {
      destroy() {
        destroyed = true;
        offBrain?.();
        clearTimeout(t);
        chrome.runtime.onMessage.removeListener(onMessage);
        window.removeEventListener('nt-image-captured', load);
        refresh.removeEventListener('click', load);
        urls.forEach((url) => URL.revokeObjectURL(url));
        urls = [];
      }
    };
  },
};
