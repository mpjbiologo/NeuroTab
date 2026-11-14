# Voz: comandos, nome do assistente e palavra de ativação

## Partes

| Parte | Arquivo | O que faz |
|---|---|---|
| Regras sem tela | `src/lib/wake-word.js` | nome do assistente, frase de ativação, tolerância a erros, cancelar, prazos, estado do indicador (com testes) |
| Comando de voz | `src/newtab/voice.js` | abre a tela de voz, ouve um pedido, executa (`lib/assistant.js`) e responde falando |
| Palavra de ativação | `src/newtab/wake.js` | escuta contínua, só com a nova aba visível e em foco |
| Comandos | `src/lib/assistant.js` | entende o pedido (pt/en/es) e, sem regra, pergunta à IA |

## Nome do assistente e frase de ativação (#15)

- **Nome** (`settings.assistantName`, padrão "NeuroTab"): aparece na tela de voz ("Verônica: pode falar…") e no indicador.
- **Frase** (`settings.wakePhrase`): só o nome ("Verônica") ou uma frase ("Acorde Verônica"). Vazia = o nome. Trocar o nome leva a frase junto se ela ainda era o nome antigo. Sugestões prontas nas configurações, nos três idiomas.
- **Tolerância:** o reconhecimento de voz erra nomes ("Berônica", "Veronica", "acorda"). Frases com 6 letras ou mais aceitam 1 erro; com 11 ou mais, 2 erros. Frases curtas (ex.: "Ana") só valem exatas, para não disparar à toa. A frase padrão "NeuroTab" usa uma lista fixa de variações conhecidas.
- **Depois da frase:**
  - com o pedido junto ("Acorde Verônica, anotar café") → executa direto;
  - só a frase → abre a escuta do comando, que encerra sozinha se ninguém falar em `wakeCommandSecs` (5, 8 ou 15 s; padrão 8);
  - "cancelar", "esquece", "never mind"… → desiste sem fazer nada.
- **Sinal sonoro** (`wakeBeep`, ligado por padrão): dois tons curtos gerados na hora (Web Audio), sem arquivo de som.

### Estados do indicador (`#wakePill`, atributo `data-state`)

| Estado | Texto | Quando |
|---|---|---|
| `off` | (escondido) | palavra de ativação desligada ou navegador sem reconhecimento de voz |
| `waiting` | Ouvindo “Acorde Verônica” | aguardando a frase |
| `listening` | Verônica: ouvindo o comando… | depois da frase, esperando o pedido |
| `processing` | Verônica: processando… | executando o pedido / respondendo |
| `paused` | Palavra de ativação pausada | pausada pelo clique, aba sem foco ou prazo vencido |
| `error` | Permitir microfone | microfone bloqueado |

## Privacidade e limites (por navegador)

- **Nada é gravado.** O reconhecimento devolve texto; o áudio não é guardado pela NeuroTab.
- **Chrome e Edge:** o reconhecimento de voz do navegador envia o áudio aos servidores do Google ou da Microsoft. Com a palavra de ativação ligada, isso acontece continuamente enquanto a nova aba estiver aberta e em foco. Por isso: é opcional, vem desligada, pede confirmação, mostra o indicador o tempo todo e desliga sozinha após X minutos sem uso.
- **Firefox:** sem reconhecimento de voz até a versão 159 (as opções de voz somem). A partir da 160 ele existe e as opções aparecem; comportamento real a conferir manualmente (ver `NAVEGADORES.md`).
- **Escuta em segundo plano:** não existe. O navegador só deixa ouvir com a página visível e em foco; a NeuroTab não tenta contornar isso.
- **Detecção local da frase (sem enviar áudio):** os navegadores não oferecem hoje uma palavra de ativação local confiável pela Web Speech API. Alternativas a avaliar no futuro: reconhecimento no próprio aparelho, se o navegador passar a oferecer, ou um detector local de palavra-chave empacotado na extensão. A detecção fica isolada em `lib/wake-word.js` (`afterWake`/`matchesWake`) para poder ser trocada.

## Testes

- Unidade: `tests/unit/wake-word.test.js` (frase composta, tolerância, frases curtas, cancelar, prazos, estados).
- Ponta a ponta (voz simulada): `tests/e2e/semantic-voice.test.js` — palavra de ativação padrão; nome e frase composta com bipe, estados, cancelar e tempo esgotado.
