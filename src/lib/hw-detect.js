// NeuroTab — o que dá para descobrir do computador para o recomendador de IA (0.8.1).
// Fontes, da mais precisa para a menos: NeuroTab Ponte → navegador (system.cpu/memory) → LibreHardwareMonitor
// → estimativas do navegador (memória arredondada, WebGPU). Nada sai do computador.
import { mergeSys, readBrowser, readLhm, sanitizeSys } from './sysinfo.js';
import { fromSys, gpuVendorOf } from './ai/advisor.js';
import { NATIVE_HOST } from './clipboard-share.js';
import { ponteAllowed } from './net-ponte.js';

/** Uma leitura da NeuroTab Ponte ({ type: 'sys', op: 'snapshot' }). null se não der. */
export async function ponteSnapshot({ timeout = 15000 } = {}) {
  if (!chrome.runtime.connectNative || !(await ponteAllowed())) return { snap: null, error: 'permission' };
  return new Promise((resolve) => {
    let done = false;
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    const fin = (v) => { if (done) return; done = true; try { port.disconnect(); } catch { /* já fechou */ } resolve(v); };
    port.onMessage.addListener((m) => fin(m?.type === 'sys' && m.payload ? { snap: m.payload } : { snap: null, error: 'old' }));
    port.onDisconnect.addListener(() => {
      const msg = chrome.runtime.lastError?.message || '';
      fin({ snap: null, error: /not found|no such native|not registered|specified native messaging host/i.test(msg) ? 'missing' : 'old' });
    });
    port.postMessage({ type: 'sys', op: 'snapshot', payload: { procs: false } });
    setTimeout(() => fin({ snap: null, error: 'timeout' }), timeout);
  });
}

const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

/** Estimativas do próprio navegador, sem permissão nenhuma. */
export async function browserHints() {
  const out = {};
  const put = (f, value) => { if (value != null && value !== '') out[f] = { value, src: 'estimate' }; };
  if (navigator.deviceMemory) put('ramGB', navigator.deviceMemory); // arredondado e limitado a 8 GB
  if (navigator.hardwareConcurrency) put('threads', navigator.hardwareConcurrency);
  try {
    const ua = await within(navigator.userAgentData?.getHighEntropyValues?.(['platform', 'architecture', 'bitness']) || Promise.resolve(null), 1500);
    if (ua) {
      put('os', /win/i.test(ua.platform) ? 'windows' : /mac/i.test(ua.platform) ? 'mac' : /linux|chrome os/i.test(ua.platform) ? 'linux' : '');
      put('arch', ua.architecture ? `${ua.architecture}${ua.bitness ? '-' + ua.bitness : ''}` : '');
    }
  } catch { /* navegador sem userAgentData */ }
  if (!out.os) {
    const p = navigator.platform || navigator.userAgent;
    put('os', /win/i.test(p) ? 'windows' : /mac/i.test(p) ? 'mac' : /linux/i.test(p) ? 'linux' : '');
  }
  try {
    const ad = await within(navigator.gpu?.requestAdapter?.() || Promise.resolve(null), 2000);
    const info = ad?.info || (await within(ad?.requestAdapterInfo?.() || Promise.resolve(null), 1000));
    if (info) {
      const v = gpuVendorOf(`${info.vendor} ${info.description || ''}`) || (/nvidia/i.test(info.vendor) ? 'nvidia' : /amd|ati/i.test(info.vendor) ? 'amd' : /intel/i.test(info.vendor) ? 'intel' : /apple/i.test(info.vendor) ? 'apple' : '');
      put('gpuVendor', v);
      if (info.description) put('gpuName', info.description);
    }
  } catch { /* sem WebGPU */ }
  return out;
}

/**
 * Detecta tudo o que der: { detected: { campo: { value, src } }, sources: { ponte, browser, lhm }, ponteError }.
 * Campos mais precisos substituem as estimativas.
 */
export async function detectHardware(settings) {
  const hints = await browserHints();
  const [{ snap, error }, browser] = await Promise.all([ponteSnapshot(), within(readBrowser(null).catch(() => null), 4000)]);
  const sys = sanitizeSys(settings?.system);
  let lhm = null;
  if (sys.lhm.on && (await chrome.permissions.contains({ origins: [new URL(sys.lhm.url).origin + '/*'] }).catch(() => false))) lhm = await readLhm(sys.lhm.url).catch(() => null);
  const v = snap || browser || lhm ? mergeSys({ ponte: snap, browser, lhm }) : null;
  const precise = fromSys(v, snap ? {} : { mem: browser ? 'browser' : 'lhm', cpu: browser ? 'browser' : 'lhm' });
  return { detected: { ...hints, ...precise }, sources: { ponte: !!snap, browser: !!browser, lhm: !!lhm }, ponteError: snap ? '' : error };
}
