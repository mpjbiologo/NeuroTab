// NeuroTab — fluxo de "Salvar no cérebro com resumo" (#67), rodando no service worker:
// lê a página (ou o link), evita duplicar, cria o item "Mídia" e pede à IA título, resumo, pontos-chave, categoria e tags.
// Inspirado no worker do Kora (MIT) — Joao V Santos — https://github.com/Joaovitor12j/kora (src/kora/worker.py).
import { loadData } from './store.js';
import { loadItems, addItem, updateItem } from './brain.js';
import { complete, isConfigured, isLocalAI } from './ai.js';
import { aiLanguageName } from './i18n.js';
import { canonicalize, platformOf, tweetParts } from './media-links.js';
import { sanitizeMediaSave, systemPrompt, userPrompt, parseAnswer, knownTags, mediaItem, mediaText, fromFxTwitter } from './media.js';
import { extractPage } from './media-extract.js';
import { grabAndSave } from './page-image.js';

/** Sites que a extensão precisa poder abrir para salvar a partir de um link (pedidos em Configurações → Mídia). */
export const MEDIA_ORIGINS = ['https://www.instagram.com/*', 'https://www.tiktok.com/*', 'https://www.youtube.com/*', 'https://x.com/*', 'https://api.fxtwitter.com/*'];

const findSaved = (items, url) => items.find((x) => x.type === 'media' && !x.deletedAt && x.url === url);

async function runExtractor(tabId) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: extractPage, args: [60000] });
  if (!r?.result) throw new Error('Não deu para ler esta página.');
  return r.result;
}

/** Abre o link numa aba em segundo plano, roda fn(tabId) e fecha (precisa da permissão do site). */
export async function withHiddenTab(url, fn) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); reject(new Error('A página demorou demais para abrir.')); }, 30000);
      const on = (id, info) => { if (id === tab.id && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(); } };
      chrome.tabs.onUpdated.addListener(on);
    });
    await new Promise((r) => setTimeout(r, 2500)); // redes sociais terminam de montar depois do "complete"
    return await fn(tab.id);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}
const extractFromLink = (url) => withHiddenTab(url, runExtractor);

async function fxTwitter(url) {
  const p = tweetParts(url);
  if (!p) throw new Error('Link do X inválido.');
  const r = await fetch(`https://api.fxtwitter.com/${p.user}/status/${p.id}`);
  if (!r.ok) throw new Error('O FixTweet respondeu ' + r.status);
  return fromFxTwitter(await r.json(), url);
}

/**
 * Lê e salva. `tab` = a página aberta (botão direito na página); `url` = um link (botão direito no link ou Captura rápida).
 * Devolve { item, existed, pending }.
 */
export async function saveMedia({ tab = null, url = '' } = {}) {
  let meta = null;
  let pendingWhy = '';
  if (tab?.id != null && !url) {
    meta = await runExtractor(tab.id);
  } else {
    const plat = platformOf(url);
    const can = async (o) => chrome.permissions.contains({ origins: [o] }).catch(() => false);
    try {
      if (plat === 'x' && (await can('https://api.fxtwitter.com/*'))) meta = await fxTwitter(url);
      else if (await can(new URL(url).origin + '/*')) meta = await extractFromLink(url);
      else pendingWhy = 'Para ler a partir do link, permita em Configurações → Mídia → Salvar mídia. Ou abra o link e use o botão direito na própria página.';
    } catch (e) {
      pendingWhy = e.message || String(e);
    }
    if (!meta) meta = { url, platform: plat, title: '', caption: '', content: '' };
  }
  const base = mediaItem(meta);
  const items = await loadItems();
  const old = findSaved(items, base.url);
  let item;
  if (old) {
    item = await updateItem(old.id, { text: base.text || old.text, pageTitle: base.pageTitle || old.pageTitle, media: { ...old.media, ...pickFilled(base.media, old.media), status: 'pendente', error: pendingWhy } });
  } else {
    base.media.error = pendingWhy;
    item = await addItem(base);
  }
  // imagens do post na biblioteca (opcional): o cérebro lê o texto delas
  const { settings } = await loadData();
  const cfg = sanitizeMediaSave(settings.mediaSave);
  if (cfg.images === 'always' && tab?.id != null && meta.images?.length) {
    for (const src of meta.images.slice(0, 10)) {
      await grabAndSave(src, { url: src, pageUrl: base.url, pageTitle: base.pageTitle, source: 'context' }, { tabId: tab.id }).catch((e) => console.info('NeuroTab: imagem do post', e?.message));
    }
  }
  if (!pendingWhy) await summarizeMedia(item.id).catch(() => {});
  return { item: (await loadItems()).find((x) => x.id === item.id), existed: !!old, pending: !!pendingWhy };
}

// Ao reler, não apaga o que já tinha (ex.: transcrição) se a releitura veio mais pobre.
function pickFilled(next, prev) {
  const out = {};
  for (const k of ['platform', 'author', 'published', 'caption', 'content', 'contentType', 'duration']) out[k] = next[k] || prev?.[k] || next[k];
  return out;
}

/** Pede à IA o resumo. allowCloud: a pessoa autorizou agora (botão "Resumir"). */
export async function summarizeMedia(id, { allowCloud = false, override = null, allowCloudReserve = false } = {}) {
  const { settings } = await loadData();
  const cfg = sanitizeMediaSave(settings.mediaSave);
  const items = await loadItems();
  const it = items.find((x) => x.id === id);
  if (!it || it.type !== 'media') throw new Error('Item não encontrado.');
  const fail = async (error) => { await updateItem(id, { media: { ...it.media, status: 'pendente', error } }); return { error }; };
  if (!isConfigured(settings, 'media') && !override) return fail('Configure a IA em Configurações → IA para gerar o resumo.');
  if (!isLocalAI(settings, 'media', { override }) && !cfg.cloudOK && !allowCloud) return fail('cloud');
  const m = it.media || {};
  if (!m.caption && !m.content && !it.pageTitle) return fail('Nada para resumir: a página não entregou texto.');
  try {
    let used = null;
    const text = await complete(settings, {
      task: 'media',
      override,
      allowCloudReserve: allowCloudReserve || cfg.cloudOK || allowCloud,
      onUse: (p) => { used = p; },
      system: systemPrompt({ categories: cfg.categories, tags: knownTags(items), language: aiLanguageName() }),
      messages: [{ role: 'user', content: userPrompt({ platform: m.platform, title: it.pageTitle || it.title, author: m.author, caption: m.caption, content: m.content, contentType: m.contentType }, cfg.maxChars) }],
      json: true,
      maxTokens: 900,
    });
    const a = parseAnswer(text, cfg.categories);
    await updateItem(id, {
      title: a.title,
      summary: a.summary,
      tags: [...new Set([...(it.tags || []), ...a.tags])].slice(0, 8),
      enriched: true,
      media: { ...m, points: a.points, category: a.category, status: 'processado', error: '', ai: used ? `${used.name}${used.model ? ' · ' + used.model : ''}` : '' },
    });
    return { ok: true };
  } catch (e) {
    if (e.code === 'consent') { await updateItem(id, { media: { ...it.media, status: 'pendente', error: 'reserve' } }); return { error: 'reserve', message: e.message }; }
    return fail(e.message || String(e));
  }
}

export { canonicalize, mediaText };
