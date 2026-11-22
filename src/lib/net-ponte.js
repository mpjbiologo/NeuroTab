// NeuroTab — o que o widget Rede pede à NeuroTab Ponte (programa no computador, ponte/netdiag.go):
// ping de verdade, DNS por UDP, aparelhos na rede, programas com conexões e o uso total da placa de rede.
// Cada pedido abre a Ponte, recebe a resposta e ela fecha (chrome.runtime.sendNativeMessage).
import { NATIVE_HOST } from './clipboard-share.js';

export class PonteError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export const ponteAllowed = () => chrome.permissions.contains({ permissions: ['nativeMessaging'] }).catch(() => false);
export const askPonte = () => chrome.permissions.request({ permissions: ['nativeMessaging'] }).catch(() => false);

export async function ponteCall(op, payload) {
  if (!chrome.runtime.sendNativeMessage || !(await ponteAllowed())) throw new PonteError('Sem permissão para falar com a NeuroTab Ponte.', 'permission');
  let r;
  try {
    r = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: 'net', op, ...(payload ? { payload } : {}) });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/not found|no such native|not registered|specified native messaging host/i.test(msg)) throw new PonteError('A NeuroTab Ponte não está instalada neste computador.', 'missing');
    throw new PonteError(msg, 'failed');
  }
  if (!r || r.type !== 'net') throw new PonteError('A NeuroTab Ponte deste computador é antiga. Baixe a versão nova para usar o diagnóstico de rede.', 'old');
  if (r.message && !r.payload) throw new PonteError(r.message, 'failed');
  return r.payload;
}

/** Ping de verdade: [{ host, samples: [ms], sent, error }]. */
export const pingReal = (hosts, count = 10) => ponteCall('ping', { hosts, count });
/** DNS clássico (UDP 53): [{ server, samples: [ms|null] }]. */
export const dnsUdp = (servers, names) => ponteCall('dns', { servers, names });
/** Roteador, DNS em uso, IPs e sistema. */
export const netInfo = () => ponteCall('info');
/** Aparelhos na rede local; scan = cutuca a rede /24 antes de ler a tabela ARP. */
export const lanDevices = (scan = false) => ponteCall('devices', { scan });
/** Programas com conexões abertas: [{ name, pid, conns }]. */
export const netProcs = () => ponteCall('procs');
/** Uso total da rede no último segundo: { downMbps, upMbps }. */
export const netUsage = () => ponteCall('usage');
