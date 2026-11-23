// NeuroTab — tarefas que usam IA (0.8.0, #63). Cada uma pode herdar o Padrão ou ter um modelo próprio.
// needs: 'text' | 'vision' | 'embed'. reserve: false quando trocar de modelo no meio não faz sentido
// (os vetores da busca por significado de modelos diferentes não se misturam).
export const TASKS = {
  chat: { icon: '💬', label: 'Conversa e perguntas ao cérebro', where: 'Widget Perguntar e voz', needs: 'text' },
  organize: { icon: '🧠', label: 'Organizar o cérebro', where: 'Título, tags, resumo e lembretes das notas', needs: 'text' },
  commands: { icon: '🎙️', label: 'Entender comandos de voz', where: 'Quando as regras da voz não entendem a frase', needs: 'text' },
  media: { icon: '🎬', label: 'Resumir mídia', where: 'Salvar mídia no cérebro', needs: 'text' },
  images: { icon: '🖼️', label: 'Imagens', where: 'Ler texto, descrever e achar endereços em imagens', needs: 'vision' },
  search: { icon: '🔎', label: 'Busca por significado', where: 'Índice do cérebro (embeddings)', needs: 'embed', reserve: false },
};

/** Tarefas fora da central (aparecem na tabela só para informar onde se configura). */
export const EXTERNAL_TASKS = {
  transcribe: { icon: '📝', label: 'Transcrição da voz', where: 'Configurações → Voz → Fala e reconhecimento' },
};

/** Módulos novos (reunião, NeuroPilot, estudante…) registram a própria tarefa sem mexer na central. */
export function registerTask(id, def) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id) || TASKS[id]) return false;
  TASKS[id] = { needs: 'text', ...def };
  return true;
}
