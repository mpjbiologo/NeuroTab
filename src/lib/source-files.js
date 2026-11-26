// NeuroTab — Fonte a partir de um arquivo do computador (0.9.3, #9).
// Guarda só os dados do arquivo (nome, tamanho, tipo, data) e, quando dá, o texto para a busca:
// texto simples direto e PDF pelo pdf.js que já vem na extensão. O arquivo em si nunca é copiado.
import { kindForFile, isPlainText, plainFromFile, MAX_TEXT } from './sources.js';
import { t } from './i18n.js';

/** PDFs maiores que isto ficam só com os dados (ler o texto travaria a página). */
export const MAX_READ = 50 * 1024 * 1024;

const baseName = (n) => String(n || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

/** Lê um File e devolve o pedido para criar a fonte ({ type, title, text, src }). */
export async function sourceFromFile(file) {
  const name = file.name || 'arquivo';
  const mime = file.type || '';
  const kind = kindForFile(name, mime);
  const meta = { name, size: file.size || 0, mime, modified: file.lastModified || 0 };
  let text = '';
  let title = baseName(name);
  let author = '';
  let published = '';
  let note = '';
  if (file.size <= MAX_READ && isPlainText(name, mime)) {
    text = plainFromFile(name, await file.text());
  } else if (file.size <= MAX_READ && kind === 'pdf') {
    try {
      const { extractPdf } = await import('./finance/import-pdf.js');
      const r = await extractPdf(await file.arrayBuffer());
      meta.pages = r.pages;
      text = r.text.slice(0, MAX_TEXT);
      try {
        const info = (await r.doc.getMetadata())?.info || {};
        if (typeof info.Title === 'string' && info.Title.trim().length > 3) title = info.Title.trim();
        if (typeof info.Author === 'string') author = info.Author.trim();
        const d = /^D:(\d{4})(\d{2})?(\d{2})?/.exec(info.CreationDate || '');
        if (d) published = [d[1], d[2], d[3]].filter(Boolean).join('-');
      } catch { /* sem metadados */ }
      if (r.scanned) note = t('PDF escaneado: sem texto para a busca (a leitura por imagem fica para depois).');
    } catch (e) {
      note = e.code === 'password' ? t('PDF com senha: guardei só os dados do arquivo.') : t('Não consegui ler o PDF: guardei só os dados do arquivo.');
    }
  } else if (file.size > MAX_READ && (kind === 'pdf' || isPlainText(name, mime))) {
    note = t('Arquivo grande: guardei só os dados, sem o texto.');
  }
  if (text) meta.textChars = text.length;
  return { type: 'source', title, text, src: { kind, author, published, file: meta }, note };
}

/** Abre o seletor de arquivos e devolve o pedido (ou null se a pessoa cancelar). */
export function pickSourceFile() {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try { resolve(await sourceFromFile(f)); } catch (e) { reject(e); }
    }, { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
