// NeuroTab — verificação de novas versões (GitHub Releases).
export const UPDATE_KEY = 'nt_update';
export const WHATSNEW_KEY = 'nt_whatsnew';
const API = 'https://api.github.com/repos/mpjbiologo/NeuroTab/releases/latest';

export function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export async function checkForUpdate() {
  const current = chrome.runtime.getManifest().version;
  const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error('GitHub respondeu ' + res.status);
  const r = await res.json();
  const latest = String(r.tag_name || '').replace(/^v/, '');
  const zip = (r.assets || []).find((a) => a.name === 'neurotab.zip') || (r.assets || [])[0];
  const info = {
    checkedAt: Date.now(),
    current,
    latest,
    available: cmpVersion(latest, current) > 0,
    url: r.html_url,
    zip: zip?.browser_download_url || r.html_url,
    notes: String(r.body || '').slice(0, 4000),
  };
  const prev = (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY] || {};
  info.dismissed = prev.dismissed === latest ? latest : null;
  info.notifiedVersion = prev.notifiedVersion || null;
  await chrome.storage.local.set({ [UPDATE_KEY]: info });
  return info;
}

/** Instalada pela loja (Edge Add-ons, Chrome Web Store, AMO)? Nesse caso a loja atualiza sozinha. */
export async function isStoreInstall() {
  try {
    const self = await chrome.management.getSelf();
    return self.installType === 'normal';
  } catch {
    return false;
  }
}
