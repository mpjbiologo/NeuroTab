# Central de IA (0.8.0 — #63 e #7)

Vários servidores e modelos ao mesmo tempo, um modelo por tarefa, Padrão e Reserva, e nenhuma troca silenciosa do computador para a internet.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `src/lib/ai/catalog.js` | Tipos de servidor (`PROVIDERS`), onde os dados vão (`whereOf`: `local`, `lan`, `cloud`), palpite de capacidades pelo nome (`guessCaps`), modelos de embeddings padrão |
| `src/lib/ai/config.js` | Formato de `settings.ai` (v2), migração do formato antigo, espelho para versões antigas, `removeServer`, exportar e importar sem chaves |
| `src/lib/ai/tasks.js` | Tarefas (`chat`, `organize`, `commands`, `media`, `images`, `search`) e `registerTask` para módulos novos |
| `src/lib/ai/router.js` | `resolve(ai, tarefa, { override })` → `{ use, reserve, problems }`. Puro (sem rede) |
| `src/lib/ai/errors.js` | `AIError` com códigos e `RETRYABLE` |
| `src/lib/ai/providers/` | Adaptadores: `gemini.js`, `anthropic.js`, `openai.js` (OpenAI e compatíveis: OpenRouter, Ollama, LM Studio, Groq…) |
| `src/lib/ai/prompts.js` | Textos enviados à IA, por assunto e com versão (`PROMPT_VERSIONS`) |
| `src/lib/ai.js` | Fachada: `complete`, `aiConfig`, `isConfigured`, `isLocalAI`, `enrich`, `ask`, `interpretCommand`, `listServerModels`, `testServer` |
| `src/lib/ai-ui.js` | Selo "🖥️ Ollama · llama3.2 ▾" (troca só desta vez) e `confirmReserve` |
| `src/options-ai.js` | Configurações → IA → Servidores e modelos / Modelo por tarefa |

## `settings.ai` (v2)

```js
{
  v: 2,
  servers: [{ id: 'ollama', type: 'ollama', name: 'Ollama', base: 'http://localhost:11434/v1', on: true,
              models: [{ id: 'gemma3:4b', caps: { vision: true, embed: false }, manual: false }],
              embedModel: '', visionModel: '' }],
  primary: { server: 'ollama', model: 'llama3.2' },   // Padrão
  reserve: { server: 'gemini', model: 'gemini-flash-latest' } | null,
  tasks: { media: { server: 'gemini', model: 'gemini-flash-latest' } }, // ausente = herda o Padrão
  keys: { gemini: '…' },  // por id do servidor; fora de "servers" (sincronização e backup já tratam "keys")
  autoEnrich, semantic, imagesAllowed, sharePlaces,
  provider, models, baseUrls, embedModels, visionModel, mirror, mirrorKeys // espelho do Padrão no formato antigo
}
```

- **Migração:** `sanitizeAi` (chamada por `mergeSettings`) e o passo 3 de `migrations.js`. Cada provedor antigo com chave, modelo ou endereço vira um servidor com o **mesmo id do tipo**, então `keys` e a etiqueta do índice da busca (`tipo:modelo`) continuam valendo. A "IA para imagens" da aba Mídia vira a regra da tarefa `images`.
- **Espelho:** o Padrão também é gravado em `provider/models/baseUrls`. Aparelhos com versão antiga (sincronização) continuam usando o Padrão. Se o espelho mudar por fora (versão antiga, backup antigo), `sanitizeAi` traz a mudança para o Padrão.

## Ordem de escolha

1. `override` (troca só desta vez, pelo selo)
2. regra da tarefa (`tasks[id]`)
3. Padrão (`primary`)

Candidato inválido é pulado com o motivo (`problems`: `gone`, `off`, `nokey`, `nomodel`, `novision`, `noembed`, `notext`). A **Reserva** só entra quando o escolhido falha com erro em `RETRYABLE` (`offline`, `limit`, `server`, `missing`). Se o escolhido é local (`local`/`lan`) e a Reserva é `cloud`, `complete` lança `AIError('consent')` até a pessoa autorizar (`allowCloudReserve: true`). Chave recusada (`auth`) nunca troca de servidor. A busca por significado não tem Reserva (vetores de modelos diferentes não se misturam).

Herança por capacidade: em `search`, herdar usa o `embedModel` do servidor (ou o padrão do tipo); em `images`, o `visionModel` do servidor ou, no Ollama, um modelo com visão instalado (`autoVision`, resolvido em `vision.js`).

## Contrato dos adaptadores

```js
generate(c, { system, messages, json, maxTokens }) → Promise<string>
embed(c, texts, kind /* 'doc' | 'query' */) → Promise<number[][]>
listModels(c) → Promise<[{ id, caps: { vision, embed } | null }]>
// c = { type, base, key, model }
```

Erros sempre como `AIError` (`providers/http.js`): `offline` (sem conexão), `auth` (401/403), `limit` (429), `missing` (404 ou "model not found"), `server` (5xx), `unsupported` (sem a capacidade), `invalid` (resposta fora do formato), `failed`. A chave nunca aparece na mensagem (`redact`).

## Tarefa nova

```js
import { registerTask } from './lib/ai/tasks.js';
registerTask('meeting', { icon: '📋', label: 'Reuniões', where: 'Modo reunião', needs: 'text' });
await complete(settings, { task: 'meeting', system, messages });
```

Ela aparece sozinha em Configurações → IA → Modelo por tarefa.

## Assistente "Qual é a melhor IA para o meu computador?" (0.8.1, #61)

- `src/advisor.html` + `src/advisor.js`: a página (aberta em Configurações → IA → Servidores e modelos).
- `src/lib/hw-detect.js`: junta a NeuroTab Ponte (`sys` snapshot), o navegador (`chrome.system.*`, `navigator.deviceMemory`, `userAgentData`, WebGPU) e o LibreHardwareMonitor. Cada campo guarda a fonte (`ponte`, `browser`, `lhm`, `estimate`).
- `src/lib/ai/advisor.js` (puro, testado em `tests/unit/advisor.test.js`): `finalHw` (o que a pessoa escreve vence o detectado, com aviso de divergência; "não sei" vira `null`), `budget` (reserva = máx(3 GB, 25% da RAM); Apple = memória unificada; Intel integrada não conta), `placement` (`gpu`/`mixed`/`cpu`/`no`/`nodisk`), `speed` (pelos parâmetros **ativos**, para os MoE) e `recommend` → por finalidade: Recomendada, Mais leve e Mais forte, mais a nota geral (`otimo`/`bom`/`limitado`/`ruim`) e `cloud` quando vale sugerir IA na internet.
- `src/data/ollama-models.json`: o catálogo (versão, data e, por modelo: tamanho do download, parâmetros totais e ativos, finalidades, visão, embedding, nota de português e de qualidade, versão mínima do Ollama quando conferida). **Para atualizar as recomendações sem lançar versão nova, edite esse arquivo na `main` e aumente `version`**: a extensão confere no GitHub (`catalog-store.js`) no máximo uma vez por semana ou pelo botão "Atualizar recomendações", e só aceita um catálogo válido e mais novo.
- `src/lib/ollama.js`: `/api/version`, `/api/tags`, `/api/ps` (quanto ficou na placa de vídeo), `/api/pull` (NDJSON com progresso, cancelável) e `/api/generate` para o teste de velocidade (`eval_count / eval_duration`).
- "Usar no NeuroTab" usa `addOllamaModel` (`ai/config.js`): cria o servidor Ollama se faltar, cadastra o modelo com as capacidades do catálogo e, se pedido, vira o Padrão ou a regra das tarefas da finalidade.
- O diagnóstico fica em `storage.local` → `nt_advisor` (`{ at, detected, sources, manual }`), nunca sincroniza nem vai para o backup.

## Permissões

Nenhuma nova. Cada servidor pede a origem dele ao ser salvo (`requestPermission`). Servidor por `http` na rede de casa (ex.: Ollama em outro computador) não pede `http://*/*`: o próprio servidor libera a extensão por CORS (`OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"`).

## Testes

- `tests/unit/ai-central.test.js`: migração, espelho, ordem, capacidades, Reserva e permissão, adaptadores com `fetch` simulado, erros, exportar/importar, `registerTask`.
- `tests/unit/migrations.test.js`: passo 3.
- `tests/e2e/ai-central.test.js`: cadastrar Ollama e Gemini, Padrão e Reserva, modelo por tarefa, exportar sem chave, selo de troca e a pergunta antes da Reserva na internet.
