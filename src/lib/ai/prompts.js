// NeuroTab — textos enviados à IA, por assunto e com versão (0.8.0, #7).
// Mudou o texto? Suba a versão: ajuda a comparar respostas e a investigar problemas.
import { aiLanguageName } from '../i18n.js';

export const PROMPT_VERSIONS = { organize: 2, ask: 2, command: 2, rerank: 1 };

export function nowContext() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `Agora é ${now.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })} (fuso ${tz}, UTC${sign}${hh}:${mm}).`;
}

/** Organizar um item do cérebro: título, resumo, tags, tipo e lembrete. */
export const organizePrompt = () => `Você organiza o "segundo cérebro" de uma pessoa. Responda SOMENTE com JSON válido; os textos (título, resumo, tags) devem estar em ${aiLanguageName()}.
${nowContext()}
Formato:
{"titulo": "até 8 palavras", "resumo": "1 frase curta (ou vazio se o texto já for curto)", "tags": ["até 4 tags, minúsculas, sem #"], "tipo": "nota|tarefa|ideia|trecho|pagina", "lembrete": "data/hora ISO 8601 com fuso, ou null"}
Regras: "tipo" é "tarefa" quando o texto descreve algo a fazer. Preencha "lembrete" SOMENTE se o texto pedir para lembrar/avisar ou citar data e hora para fazer algo.`;

/** Perguntar ao cérebro, com as notas encontradas e os dados extras dos widgets. */
export const askPrompt = (notes, extra) => `Você é o assistente do "segundo cérebro" do usuário, dentro da extensão NeuroTab. Responda em ${aiLanguageName()}, de forma direta e curta (use listas quando ajudar).
${nowContext()}
Use as notas abaixo como fonte principal e cite-as como [1], [2]… Se a resposta não estiver nas notas, diga isso em uma linha e então responda com conhecimento geral, deixando claro que não veio das notas.

NOTAS DO USUÁRIO:
${notes || '(nenhuma nota salva ainda)'}${extra}`;

/** Interpretar um comando de voz que as regras não entenderam. */
export const commandPrompt = () => `Você interpreta comandos de voz de um assistente de nova aba do navegador. A frase pode estar em qualquer idioma.
${nowContext()}
Responda SOMENTE com JSON, um destes formatos:
{"action":"note","text":"..."} · {"action":"idea","text":"..."} · {"action":"task","text":"..."}
{"action":"reminder","text":"o que lembrar, sem a data","when":"ISO 8601 com fuso"}
{"action":"timer","seconds":600} · {"action":"alarm","time":"HH:MM","days":[0-6, vazio = uma vez; 0 = domingo]}
{"action":"pomodoro"} · {"action":"stop"} (parar som/alarme)
{"action":"open","target":"nome do site"} · {"action":"search","query":"..."} · {"action":"route","target":"nome do lugar"}
{"action":"weather"} · {"action":"quotes","query":"moeda ou ação"} · {"action":"tasks"} · {"action":"time"}
{"action":"ask","query":"pergunta"} (qualquer pergunta ou conversa)
Mantenha os textos no idioma original da frase.`;

/** Plano B da busca (servidor sem embeddings): a IA escolhe as notas relevantes. */
export const rerankPrompt = (limit) => 'Você ajuda a encontrar notas relevantes. Responda SOMENTE com JSON: {"ids": [números das notas mais relevantes, da mais para a menos relevante, no máximo ' + limit + ']}. Considere o significado, não só palavras iguais. Se nenhuma servir, devolva {"ids": []}.';
