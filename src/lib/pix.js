// Gera o "Pix Copia e Cola" (BR Code estático, padrão do Banco Central) e o QR Code em SVG.
import qrcode from '../vendor/qrcode.js';

const f = (id, v) => id + String(v.length).padStart(2, '0') + v;

function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const plain = (s, max) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .-]/g, '').toUpperCase().slice(0, max);

export function pixPayload({ key, name, city, amount, txid = '***', message = '' }) {
  const gui = f('00', 'br.gov.bcb.pix') + f('01', key.trim()) + (message ? f('02', message.slice(0, 40)) : '');
  let p = f('00', '01') + f('26', gui) + f('52', '0000') + f('53', '986');
  if (amount) p += f('54', Number(amount).toFixed(2));
  p += f('58', 'BR') + f('59', plain(name, 25)) + f('60', plain(city, 15)) + f('62', f('05', txid));
  p += '6304';
  return p + crc16(p);
}

export function qrSvg(text, { size = 220, margin = 2, dark = '#111', light = '#fff' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const total = n + margin * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + margin},${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
