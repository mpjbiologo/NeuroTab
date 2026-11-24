// Finanças (#66): leitor de OFX 1.x (SGML, tags sem fechamento) e 2.x (XML).
// Puro e sem dependências. Lê extratos bancários (BANKMSGSRSV1) e de cartão (CREDITCARDMSGSRSV1).

const tagValue = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
};

// "20261105120000[-3:BRT]" → "2026-11-05"
export function ofxDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

// Converte o texto do arquivo em { kind: 'banco' | 'cartao', currency, acctId, balance, items: [...] }.
// Cada item: { date, amount (centavos, positivo), kind: entrada|saida, desc, fitid, type }.
export function parseOfx(text) {
  const src = String(text || '');
  if (!/<OFX>/i.test(src)) throw new Error('Este arquivo não parece um OFX.');
  const isCard = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(src);
  const currency = tagValue(src, 'CURDEF') || 'BRL';
  const acctId = tagValue(src, 'ACCTID');
  const balBlock = src.match(/<LEDGERBAL>[\s\S]*?(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i);
  const balance = balBlock ? Math.round(Number(tagValue(balBlock[0], 'BALAMT').replace(',', '.')) * 100) || 0 : null;
  const items = [];
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
  let m;
  while ((m = re.exec(src))) {
    const b = m[1];
    const raw = tagValue(b, 'TRNAMT').replace(/\s/g, '');
    // Alguns bancos usam vírgula decimal no OFX.
    const num = Number(/,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''));
    const date = ofxDate(tagValue(b, 'DTPOSTED') || tagValue(b, 'DTUSER'));
    if (!date || !Number.isFinite(num) || !num) continue;
    const name = decodeEntities(tagValue(b, 'NAME'));
    const memo = decodeEntities(tagValue(b, 'MEMO'));
    const desc = (memo && name && !memo.toLowerCase().includes(name.toLowerCase()) ? `${name} ${memo}` : memo || name).replace(/\s+/g, ' ').trim();
    items.push({
      date, amount: Math.abs(Math.round(num * 100)), kind: num < 0 ? 'saida' : 'entrada',
      desc: desc || tagValue(b, 'TRNTYPE'), fitid: tagValue(b, 'FITID'), type: tagValue(b, 'TRNTYPE').toUpperCase(),
    });
  }
  return { kind: isCard ? 'cartao' : 'banco', currency, acctId, balance, items };
}

// Gera um OFX 1.02 (SGML) para exportar lançamentos de uma conta.
export function toOfx(list, { acctId = 'NEUROTAB', currency = 'BRL', bank = '0000' } = {}) {
  const d = (s) => s.replace(/-/g, '') + '120000';
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = list.map((t) => [
    '<STMTTRN>', `<TRNTYPE>${t.kind === 'entrada' ? 'CREDIT' : 'DEBIT'}`, `<DTPOSTED>${d(t.date)}`,
    `<TRNAMT>${((t.kind === 'entrada' ? 1 : -1) * t.amount / 100).toFixed(2)}`, `<FITID>${esc(t.fitid || t.id)}`, `<MEMO>${esc(t.desc)}`, '</STMTTRN>',
  ].join('\n')).join('\n');
  const dates = list.map((t) => t.date).sort();
  return [
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    '<OFX>', '<BANKMSGSRSV1>', '<STMTTRNRS>', '<TRNUID>1', '<STATUS>', '<CODE>0', '<SEVERITY>INFO', '</STATUS>', '<STMTRS>', `<CURDEF>${currency}`,
    '<BANKACCTFROM>', `<BANKID>${bank}`, `<ACCTID>${esc(acctId)}`, '<ACCTTYPE>CHECKING', '</BANKACCTFROM>',
    '<BANKTRANLIST>', `<DTSTART>${d(dates[0] || '2000-01-01')}`, `<DTEND>${d(dates.at(-1) || '2000-01-01')}`, rows, '</BANKTRANLIST>',
    '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>', '',
  ].join('\n');
}
