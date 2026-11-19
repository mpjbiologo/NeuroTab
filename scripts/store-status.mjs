#!/usr/bin/env node
// Situação da NeuroTab nas três lojas: versão publicada e versão em revisão.
// Só consulta, não envia nada. Usado pelo fluxo "Situação nas lojas" (.github/workflows/lojas-situacao.yml),
// que comenta numa issue quando algo muda (o GitHub avisa por e-mail e no app; as lojas não avisam).
// Uso: node scripts/store-status.mjs [arquivo.json]   (credenciais nas mesmas variáveis do envio)
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getAccessToken, API as CWS } from './publish-chrome.mjs';
import { amoToken, API as AMO, GUID } from './check-amo.mjs';

export const EDGE_CRX = 'mhaainpmhalhhbefceigjmbcdhdeainl';
const json = async (res) => { const t = await res.text(); try { return t ? JSON.parse(t) : null; } catch { return null; } };

// Estados de cada loja em português.
const CHROME_STATE = {
  PENDING_REVIEW: 'em revisão', STAGED: 'aprovada, aguardando publicação', PUBLISHED: 'publicada',
  PUBLISHED_TO_TESTERS: 'publicada para testadores', REJECTED: 'recusada', CANCELLED: 'envio cancelado',
};
const AMO_STATE = { public: 'publicada', nominated: 'em revisão', unreviewed: 'em revisão', awaiting_review: 'em revisão', disabled: 'recusada ou desativada', null: 'incompleta' };

/** Chrome Web Store (precisa das credenciais do envio). */
export async function chromeStatus({ publisherId, extensionId, fetchFn = fetch, ...auth }) {
  const token = await getAccessToken({ ...auth, fetchFn });
  const name = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`;
  const res = await fetchFn(`${CWS}/v2/${name}:fetchStatus`, { headers: { Authorization: `Bearer ${token}` } });
  const b = await json(res);
  if (!res.ok) throw new Error(`Chrome respondeu HTTP ${res.status}`);
  const ver = (r) => r?.distributionChannels?.map((d) => d.crxVersion).filter(Boolean)[0] || '';
  const pub = b?.publishedItemRevisionStatus;
  const sub = b?.submittedItemRevisionStatus;
  const review = sub && ver(sub) && ver(sub) !== ver(pub) ? { version: ver(sub), state: CHROME_STATE[sub.state] || sub.state || '?' } : null;
  return { published: ver(pub), review };
}

/** Firefox (AMO): a última versão enviada e o estado do arquivo dela. */
export async function firefoxStatus({ issuer, secret, fetchFn = fetch }) {
  const get = async (url) => {
    const res = await fetchFn(url, { headers: { Authorization: `JWT ${amoToken(issuer, secret)}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Firefox respondeu HTTP ${res.status}`);
    return json(res);
  };
  const addon = await get(`${AMO}/addons/addon/${encodeURIComponent(GUID)}/`);
  const list = await get(`${AMO}/addons/addon/${encodeURIComponent(GUID)}/versions/?filter=all_with_unlisted&page_size=5`);
  const published = addon?.current_version?.version || '';
  const last = list?.results?.[0];
  const st = last?.file?.status ?? null;
  const review = last && last.version !== published ? { version: last.version, state: AMO_STATE[st] || String(st) } : null;
  return { published, review };
}

/** Edge: versão publicada, pela página pública da loja (a API do Edge não informa a revisão). */
export async function edgeStatus({ fetchFn = fetch } = {}) {
  const res = await fetchFn(`https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/${EDGE_CRX}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Edge respondeu HTTP ${res.status}`);
  const b = await json(res);
  return { published: b?.version || '', review: null };
}

/** Consulta as três lojas; uma loja com erro não impede as outras. */
export async function storeStatus(env = process.env, fetchFn = fetch) {
  const out = {};
  const run = async (key, fn) => { try { out[key] = await fn(); } catch (e) { out[key] = { error: e.message }; } };
  await Promise.all([
    run('chrome', () => chromeStatus({
      publisherId: env.CWS_PUBLISHER_ID, extensionId: env.CWS_EXTENSION_ID, serviceAccount: env.CWS_SERVICE_ACCOUNT || undefined,
      clientId: env.CWS_CLIENT_ID, clientSecret: env.CWS_CLIENT_SECRET, refreshToken: env.CWS_REFRESH_TOKEN, fetchFn,
    })),
    run('firefox', () => firefoxStatus({ issuer: env.AMO_JWT_ISSUER, secret: env.AMO_JWT_SECRET, fetchFn })),
    run('edge', () => edgeStatus({ fetchFn })),
  ]);
  return out;
}

const NAMES = { chrome: 'Chrome', firefox: 'Firefox', edge: 'Edge' };

// Como terminou o envio da última release para cada loja (jobs loja-* do fluxo Release).
const SENT = { success: 'enviada', failure: 'o envio falhou', skipped: 'não enviada: a release falhou antes do envio', cancelled: 'envio cancelado' };

/** Linha da tabela para cada loja. */
export function describe(s, latest = '') {
  return Object.keys(NAMES).map((k) => {
    const x = s[k] || {};
    if (x.error) return `| ${NAMES[k]} | ? | não consegui consultar (${x.error}) |`;
    const sub = s.submit?.[k];
    const missing = latest && x.published !== latest && !x.review;
    const review = x.review ? `${x.review.version}: ${x.review.state}`
      : missing && k === 'edge' && sub !== 'skipped' ? `${latest}: aguardando a loja aceitar o envio`
      : missing && sub && sub !== 'success' ? `⚠️ ${latest}: ${SENT[sub] || sub}` : '—';
    return `| ${NAMES[k]} | ${x.published || '?'} | ${review} |`;
  });
}

/** O que mudou entre duas consultas, em frases curtas (vazio se nada mudou ou se houve erro de consulta). */
export function changes(prev = {}, now = {}) {
  const out = [];
  for (const k of Object.keys(NAMES)) {
    const a = prev[k] || {};
    const b = now[k] || {};
    if (b.error || a.error || !Object.keys(a).length) continue;
    if (b.published && b.published !== a.published) out.push(`✅ **${NAMES[k]}** publicou a **${b.published}**.`);
    const ra = a.review ? `${a.review.version}|${a.review.state}` : '';
    const rb = b.review ? `${b.review.version}|${b.review.state}` : '';
    if (rb && rb !== ra) {
      const bad = /recusada|cancelado|desativada/.test(b.review.state);
      out.push(`${bad ? '❌' : '⏳'} **${NAMES[k]}**: ${b.review.version} ${b.review.state}.`);
    }
  }
  // Release que não chegou às lojas (ex.: um teste falhou e o envio foi pulado): avisa uma vez por versão.
  const bad = Object.keys(NAMES).filter((k) => ['skipped', 'cancelled'].includes(now.submit?.[k]) || (k !== 'edge' && now.submit?.[k] === 'failure'));
  if (bad.length && now.latest && (prev.latest !== now.latest || JSON.stringify(prev.submit) !== JSON.stringify(now.submit))) {
    out.push(`⚠️ A **${now.latest}** não chegou a ${bad.map((k) => NAMES[k]).join(', ')}: ${SENT[now.submit[bad[0]]] || 'o envio falhou'}. Veja o fluxo Release no Actions.`);
  }
  return out;
}

export const ISSUE_TITLE = '📦 Situação nas lojas';
const MARK = /<!-- estado: (.*?) -->/s;

/** Corpo da issue de acompanhamento, com o estado guardado num comentário HTML. */
export function issueBody(s, latest, when = new Date()) {
  return [
    'Esta issue é atualizada sozinha a cada 3 horas pelo fluxo **Situação nas lojas**. Quando uma loja publica, recusa ou começa a revisar uma versão, entra um comentário aqui e o GitHub avisa por e-mail e no app.',
    '',
    `Última release: **${latest || '?'}** · consulta: ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    '| Loja | Publicada | Em revisão |', '|---|---|---|', ...describe(s, latest),
    '',
    `<!-- estado: ${JSON.stringify(s)} -->`,
  ].join('\n');
}

/** Atualiza (ou cria) a issue e comenta o que mudou, mencionando o dono do repositório. */
export async function syncIssue({ status, latest, repo, token, owner, fetchFn = fetch, log = console.log }) {
  const gh = async (path, opts = {}) => {
    const res = await fetchFn(`https://api.github.com/repos/${repo}${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`GitHub ${opts.method || 'GET'} ${path}: HTTP ${res.status}`);
    return json(res);
  };
  const open = (await gh('/issues?state=open&labels=lojas&per_page=20')) || [];
  let issue = open.find((i) => i.title === ISSUE_TITLE);
  const prev = issue ? JSON.parse(issue.body?.match(MARK)?.[1] || '{}') : {};
  const body = issueBody(status, latest);
  if (!issue) {
    issue = await gh('/issues', { method: 'POST', body: JSON.stringify({ title: ISSUE_TITLE, body, labels: ['lojas'] }) });
    log(`Issue criada: #${issue.number}`);
  } else {
    await gh(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
  }
  const list = changes(prev, status);
  if (list.length) {
    await gh(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: [`@${owner}`, '', ...list.map((l) => `- ${l}`)].join('\n') }) });
    log('Mudanças comentadas:\n' + list.join('\n'));
  } else log('Nada mudou desde a última consulta.');
  return { issue: issue.number, changes: list };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const env = process.env;
  const s = await storeStatus();
  s.latest = env.LATEST || '';
  try { s.submit = env.SUBMIT ? JSON.parse(env.SUBMIT) : undefined; } catch { /* sem dados do envio */ }
  const table = ['| Loja | Publicada | Em revisão |', '|---|---|---|', ...describe(s, env.LATEST || '')].join('\n');
  console.log(table);
  if (env.GITHUB_STEP_SUMMARY) writeFileSync(env.GITHUB_STEP_SUMMARY, `### Situação nas lojas\n\n${table}\n`, { flag: 'a' });
  if (process.argv[2] === '--issue') {
    try {
      await syncIssue({ status: s, latest: env.LATEST, repo: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN, owner: env.OWNER });
    } catch (e) {
      console.error(`::error::${e.message}`);
      process.exit(1);
    }
  }
}
