// Finanças (#66): categorias e regras. As regras aprendidas (correções da pessoa)
// valem mais que as embutidas; dentro de cada grupo, vence o trecho mais longo.

export const DEFAULT_CATEGORIES = [
  { id: 'mercado', name: 'Mercado', icon: '🛒', kind: 'saida' },
  { id: 'alimentacao', name: 'Alimentação', icon: '🍽️', kind: 'saida' },
  { id: 'transporte', name: 'Transporte', icon: '🚗', kind: 'saida' },
  { id: 'moradia', name: 'Moradia', icon: '🏠', kind: 'saida' },
  { id: 'contas', name: 'Contas da casa', icon: '💡', kind: 'saida' },
  { id: 'saude', name: 'Saúde', icon: '🩺', kind: 'saida' },
  { id: 'educacao', name: 'Educação', icon: '📚', kind: 'saida' },
  { id: 'lazer', name: 'Lazer', icon: '🎉', kind: 'saida' },
  { id: 'assinaturas', name: 'Assinaturas', icon: '🔁', kind: 'saida' },
  { id: 'compras', name: 'Compras', icon: '🛍️', kind: 'saida' },
  { id: 'impostos', name: 'Impostos e taxas', icon: '🧾', kind: 'saida' },
  { id: 'pets', name: 'Pets', icon: '🐾', kind: 'saida' },
  { id: 'salario', name: 'Salário', icon: '💼', kind: 'entrada' },
  { id: 'renda', name: 'Outras entradas', icon: '💰', kind: 'entrada' },
  { id: 'investimentos', name: 'Investimentos', icon: '📈', kind: 'ambos' },
  { id: 'transferencia', name: 'Transferência', icon: '🔄', kind: 'ambos' },
  { id: 'outros', name: 'Outros', icon: '•', kind: 'ambos' },
];

// Regras embutidas (trecho da descrição normalizada → categoria).
export const BUILTIN_RULES = [
  ['ifood', 'alimentacao'], ['rappi', 'alimentacao'], ['restaurante', 'alimentacao'], ['lanchonete', 'alimentacao'], ['padaria', 'alimentacao'],
  ['pizzaria', 'alimentacao'], ['burger', 'alimentacao'], ['mcdonalds', 'alimentacao'], ['cafe', 'alimentacao'], ['almoco', 'alimentacao'], ['jantar', 'alimentacao'], ['lanche', 'alimentacao'],
  ['supermercado', 'mercado'], ['mercado', 'mercado'], ['atacadao', 'mercado'], ['assai', 'mercado'], ['carrefour', 'mercado'], ['pao de acucar', 'mercado'], ['hortifruti', 'mercado'], ['sacolao', 'mercado'], ['acougue', 'mercado'],
  ['uber', 'transporte'], ['99app', 'transporte'], ['99 pop', 'transporte'], ['posto', 'transporte'], ['combustivel', 'transporte'], ['gasolina', 'transporte'], ['estacionamento', 'transporte'], ['pedagio', 'transporte'], ['sem parar', 'transporte'], ['onibus', 'transporte'], ['metro', 'transporte'],
  ['aluguel', 'moradia'], ['condominio', 'moradia'], ['iptu', 'impostos'],
  ['cemig', 'contas'], ['enel', 'contas'], ['copasa', 'contas'], ['sabesp', 'contas'], ['energia', 'contas'], ['luz', 'contas'], ['agua', 'contas'], ['internet', 'contas'], ['vivo', 'contas'], ['claro', 'contas'], ['tim ', 'contas'], ['oi fibra', 'contas'], ['gas', 'contas'],
  ['farmacia', 'saude'], ['drogaria', 'saude'], ['drogasil', 'saude'], ['raia', 'saude'], ['unimed', 'saude'], ['hospital', 'saude'], ['clinica', 'saude'], ['laboratorio', 'saude'], ['academia', 'saude'], ['consulta', 'saude'],
  ['escola', 'educacao'], ['faculdade', 'educacao'], ['curso', 'educacao'], ['udemy', 'educacao'], ['livraria', 'educacao'],
  ['netflix', 'assinaturas'], ['spotify', 'assinaturas'], ['disney', 'assinaturas'], ['prime video', 'assinaturas'], ['amazon prime', 'assinaturas'], ['youtube premium', 'assinaturas'], ['google one', 'assinaturas'], ['icloud', 'assinaturas'], ['chatgpt', 'assinaturas'], ['openai', 'assinaturas'], ['claude', 'assinaturas'], ['anthropic', 'assinaturas'], ['hbo', 'assinaturas'], ['globoplay', 'assinaturas'],
  ['cinema', 'lazer'], ['ingresso', 'lazer'], ['steam', 'lazer'], ['playstation', 'lazer'], ['bar ', 'lazer'], ['viagem', 'lazer'], ['hotel', 'lazer'], ['airbnb', 'lazer'], ['booking', 'lazer'],
  ['amazon', 'compras'], ['mercado livre', 'compras'], ['mercadolivre', 'compras'], ['shopee', 'compras'], ['magalu', 'compras'], ['magazine', 'compras'], ['americanas', 'compras'], ['aliexpress', 'compras'], ['shein', 'compras'], ['renner', 'compras'],
  ['petshop', 'pets'], ['pet shop', 'pets'], ['petz', 'pets'], ['cobasi', 'pets'], ['veterinari', 'pets'], ['racao', 'pets'],
  ['iof', 'impostos'], ['tarifa', 'impostos'], ['anuidade', 'impostos'], ['darf', 'impostos'], ['ipva', 'impostos'], ['juros', 'impostos'],
  ['salario', 'salario'], ['pagamento de salario', 'salario'], ['folha', 'salario'], ['pro labore', 'salario'], ['prolabore', 'salario'],
  ['rendimento', 'investimentos'], ['aplicacao', 'investimentos'], ['resgate', 'investimentos'], ['cdb', 'investimentos'], ['tesouro', 'investimentos'], ['dividendo', 'investimentos'],
  ['pagamento de fatura', 'transferencia'], ['pagamento fatura', 'transferencia'], ['pgto fatura', 'transferencia'], ['transferencia entre contas', 'transferencia'],
];

// Normaliza a descrição: minúsculas, sem acentos, sem datas, códigos e ruído de banco.
export function normalizeDesc(desc) {
  return String(desc || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/\bparc(ela)?\s*\d+\s*(\/|de)\s*\d+\b/g, ' ')
    .replace(/\b(compra|cartao|credito|debito|pix|ted|doc|enviado|recebido|transf|transferencia enviada|pag\*|pg \*|ec \*|\*)\b/g, ' ')
    .replace(/[*#_|]/g, ' ').replace(/\d{4,}/g, ' ').replace(/[^\w\s.&-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Trecho que vira regra ao corrigir uma categoria: as duas primeiras palavras úteis.
export function ruleKey(desc) {
  const words = normalizeDesc(desc).split(' ').filter((w) => w.length > 1 && !/^\d+$/.test(w));
  return words.slice(0, 2).join(' ');
}

function bestMatch(text, rules) {
  let best = null;
  for (const r of rules) if (r.match && text.includes(r.match) && (!best || r.match.length > best.match.length)) best = r;
  return best;
}

// Sugere uma categoria. Devolve { cat, by: 'regra' | 'embutida' | 'padrao' }.
export function suggestCategory(fin, desc, kind = 'saida') {
  const text = ' ' + normalizeDesc(desc) + ' ';
  const learned = bestMatch(text, (fin?.rules || []).map((r) => ({ match: r.match, cat: r.cat })));
  if (learned) return { cat: learned.cat, by: 'regra' };
  const built = bestMatch(text, BUILTIN_RULES.map(([match, cat]) => ({ match, cat })));
  if (built) {
    const c = DEFAULT_CATEGORIES.find((x) => x.id === built.cat);
    if (!c || c.kind === 'ambos' || c.kind === kind) return { cat: built.cat, by: 'embutida' };
  }
  return { cat: kind === 'entrada' ? 'renda' : 'outros', by: 'padrao' };
}

// Aprende com uma correção: cria ou atualiza a regra "trecho → categoria".
export function learnRule(fin, desc, cat) {
  const match = ruleKey(desc);
  if (!match || match.length < 3) return fin;
  const rules = fin.rules.filter((r) => r.match !== match);
  rules.push({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), match, cat, learned: true });
  return { ...fin, rules };
}

// Contas de pagamento de fatura e transferências internas não são gasto.
export const isBillPayment = (desc) => /pag(amento|to)?\.?\s*(de\s+)?fatura|pgto\.?\s*fat|pagamento (do )?cart[aã]o|pag fat/i.test(String(desc));
