// Widget: biblioteca local de imagens capturadas pelo menu de contexto.
import { h } from '../lib/ui.js';
import { openDB } from '../lib/idb.js';

export default {
  id: 'image-library',
  title: 'Biblioteca de imagens',
  icon: '🖼️',
  description: 'Imagens salvas de páginas da web, armazenadas localmente no navegador.',
  defaultW: 6,
  mount(el) {
    const list = h('div', { class: 'nt-image-grid' });
    const status = h('p', { class: 'muted' }, 'Carregando imagens…');
    let urls = [];
    let destroyed = false;
    el.append(status, list);

    async function load() {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls = [];
      list.replaceChildren();
      try {
        const db = await openDB();
        const records = await new Promise((resolve, reject) => {
          const tx = db.transaction('captures', 'readonly');
          const req = tx.objectStore('captures').getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
        if (destroyed) return;
        records.sort((a, b) => b.capturedAt - a.capturedAt);
        status.textContent = records.length
          ? `${records.length} imagem(ns) salvas neste navegador.`
          : 'Sua biblioteca está vazia. Clique com o botão direito em uma imagem → NeuroTab → Salvar imagem na biblioteca.';
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
            if (!confirm('Excluir esta imagem da biblioteca?')) return;
            await new Promise((resolve, reject) => {
              const tx = db.transaction('captures', 'readwrite');
              tx.objectStore('captures').delete(item.id);
              tx.oncomplete = resolve;
              tx.onerror = () => reject(tx.error);
            });
            await load();
          } }, '🗑 Excluir');
          list.append(h('article', { class: 'nt-image-card' },
            h('a', { class: 'nt-image-preview', href: url, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir imagem' }, img),
            h('div', { class: 'nt-image-meta' },
              h('b', {}, item.fileName || 'Imagem'),
              h('small', {}, `${date} · ${size}`),
              source),
            remove));
        }
      } catch (error) {
        status.textContent = 'Não foi possível abrir a biblioteca: ' + error.message;
      }
    }
    load();
    return {
      destroy() {
        destroyed = true;
        urls.forEach((url) => URL.revokeObjectURL(url));
        urls = [];
      }
    };
  },
};
