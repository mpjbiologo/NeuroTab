// NeuroTab — acha um endereço num texto (selecionado na página ou lido de uma imagem).
const STREET = String.raw`(?:rua|r\.|avenida|av\.?|alameda|al\.|pra[çc]a|p[çc]a\.?|travessa|tv\.|rodovia|rod\.|estrada|largo|viela|calle|c\/|carrera|cra\.?|paseo|plaza|camino|avda\.?)`;
const EN_STREET = String.raw`(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|place|pl\.?|court|ct\.?)`;
const RE_PT = new RegExp(String.raw`\b${STREET}\s+[^\n,;]{2,60}?(?:,?\s*(?:n[º°o.]?\s*)?\d{1,5}[a-z]?)?(?:\s*[-–,]\s*[^\n;]{2,60})?(?=$|[\n;]|\s{2})`, 'imu');
const RE_EN = new RegExp(String.raw`\b\d{1,5}\s+(?:[A-Z][\w'.-]*\s+){1,4}${EN_STREET}\b[^\n;]{0,50}`, 'mi');
const RE_CEP = /\b\d{5}-\d{3}\b/;

/** Procura um endereço num texto (selecionado na página ou lido de uma imagem). */
export function findAddress(text) {
  const s = String(text || '').replace(/\s*\n\s*/g, '\n');
  const m = s.match(RE_PT) || s.match(RE_EN);
  let out = m ? m[0] : '';
  const cep = s.match(RE_CEP)?.[0];
  if (cep && !out.includes(cep)) out = out ? `${out}, ${cep}` : cep;
  return out.replace(/\s+/g, ' ').replace(/[\s,.;–-]+$/, '').trim() || null;
}
