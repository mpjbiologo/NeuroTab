// NeuroTab — leituras contínuas do widget Sistema pela NeuroTab Ponte (ponte/sys.go).
// Uma conexão nativa aberta enquanto o widget está na tela; fechar a conexão para a Ponte.
import { NATIVE_HOST } from './clipboard-share.js';
import { PonteError, ponteAllowed } from './net-ponte.js';

/**
 * Abre o fluxo. onSnap(snapshot) a cada leitura; onError(PonteError) se cair.
 * Devolve uma função que fecha a conexão.
 */
export async function openSysStream({ interval = 2000, procs = true, onSnap, onError }) {
  if (!chrome.runtime.connectNative || !(await ponteAllowed())) throw new PonteError('Sem permissão para falar com a NeuroTab Ponte.', 'permission');
  let got = false;
  let closed = false;
  const port = chrome.runtime.connectNative(NATIVE_HOST);
  port.onMessage.addListener((m) => {
    if (m?.type === 'sys' && m.payload) { got = true; onSnap(m.payload); }
    else if (!got) { closed = true; port.disconnect(); onError?.(new PonteError('A NeuroTab Ponte deste computador é antiga. Baixe a versão nova para ver o sistema.', 'old')); }
  });
  port.onDisconnect.addListener(() => {
    if (closed) return;
    closed = true;
    const msg = chrome.runtime.lastError?.message || '';
    if (/not found|no such native|not registered|specified native messaging host/i.test(msg)) onError?.(new PonteError('A NeuroTab Ponte não está instalada neste computador.', 'missing'));
    else onError?.(new PonteError(got ? 'A conexão com a NeuroTab Ponte caiu.' : 'A NeuroTab Ponte deste computador é antiga. Baixe a versão nova para ver o sistema.', got ? 'failed' : 'old'));
  });
  port.postMessage({ type: 'sys', op: 'stream', payload: { interval, procs } });
  return () => { if (!closed) { closed = true; port.disconnect(); } };
}
