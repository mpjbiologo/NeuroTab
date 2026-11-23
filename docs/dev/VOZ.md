# Voz: comandos, nome do assistente e palavra de ativação

## Partes

| Parte | Arquivo | O que faz |
|---|---|---|
| Regras sem tela | `src/lib/wake-word.js` | nome do assistente, frase de ativação, tolerância a erros, cancelar, prazos, estado do indicador (com testes) |
| Comando de voz | `src/newtab/voice.js` | abre a tela de voz, ouve um pedido, executa (`lib/assistant.js`) e responde falando |
| Palavra de ativação | `src/newtab/wake.js` | escuta contínua, só com a nova aba visível e em foco |
| Comandos | `src/lib/assistant.js` | entende o pedido (pt/en/es) e, sem regra, pergunta à IA |
| Motores de voz | `src/lib/speech-engine.js` | escolhe onde a fala é reconhecida (no computador, Whisper local ou serviço do navegador) e devolve um objeto no formato do `SpeechRecognition` (com testes) |

## Onde a voz é processada (#49)

Opções → IA e voz → **Onde a fala é reconhecida** (`settings.voiceEngine`):

| Motor | Valor | Onde o áudio vai | Precisa de |
|---|---|---|---|
| Automático (padrão) | `auto` | no computador quando o idioma já está baixado; senão, o serviço do navegador | — |
| No computador | `device` | fica no computador (`processLocally`) | Chrome/Edge 139+ e o pacote do idioma (~60 MB, baixado uma vez pelo botão nas opções) |

**Idiomas no computador:** cada navegador oferece só alguns. O Edge, por exemplo, não tem pt-BR, só pt-PT (além de en-US, de-DE, it-IT, es-ES e ko-KR). Quando falta o idioma exato, a NeuroTab usa um parecido (`deviceLangCandidates`: pt-BR → pt-PT, es-MX → es-ES, en-GB → en-US), que entende bem a mesma língua. Se o navegador recusar o download, as opções mostram o motivo, o próximo clique tenta o idioma parecido e o Whisper local aparece como alternativa.
| Whisper local | `whisper` | só para o endereço local configurado | um servidor Whisper rodando no computador (abaixo) |
| Serviço do navegador | `cloud` | Google (Chrome) ou Microsoft (Edge) | internet |

**Somente local** (`settings.voiceLocalOnly`): a nuvem nunca é usada. Sem motor local disponível, o microfone avisa o que fazer em vez de cair para a nuvem. A leitura das respostas também fica só com as vozes instaladas no computador (`localService`). Se a IA configurada for de nuvem, as opções avisam: para tudo ficar local, use o Ollama.

O indicador mostra onde está sendo processado: **🔒** no computador, **☁** serviço do navegador (na tela de voz e na pílula da palavra de ativação).

### Whisper local

O Ollama não transcreve áudio; ele responde ao texto. Para a fala ficar no computador fora do Chrome/Edge (ou com mais precisão), rode um servidor Whisper. A NeuroTab grava o microfone, separa cada fala pelo silêncio, converte para WAV 16 kHz mono e envia **só para o endereço configurado**. Dois formatos são aceitos:

| Servidor | Endereço | Formato |
|---|---|---|
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`whisper-server`) | `http://127.0.0.1:8080/inference` | campos `file`, `language`, `response_format=json` |
| [Speaches](https://github.com/speaches-ai/speaches) (faster-whisper) | `http://127.0.0.1:8000/v1/audio/transcriptions` | formato OpenAI (`file`, `model`, `language`) |
| [LocalAI](https://localai.io) | `http://127.0.0.1:8080/v1/audio/transcriptions` | formato OpenAI |

Exemplo com whisper.cpp:

```sh
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build && cmake --build build -j --config Release
sh ./models/download-ggml-model.sh small        # ou base / medium
./build/bin/whisper-server -m models/ggml-small.bin --host 127.0.0.1 --port 8080 -l auto
```

Depois, nas opções: escolha **Whisper local**, clique em **whisper.cpp** e em **🔌 Testar conexão** (o navegador pede acesso ao `localhost` uma vez).

Detalhes da gravação (`WhisperRecognizer`): fala começa com 120 ms acima do limiar de volume e termina após 0,9 s de silêncio; trechos com menos de 0,25 s são descartados; uma fala é cortada em 30 s. No comando de voz, sem fala em 8 s, encerra com "Não ouvi nada". Na palavra de ativação (escuta contínua), cada fala é transcrita e procurada a frase.


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

## Conversa por voz e visual (0.8.2, #40 e #39)

- `src/lib/voice-session.js` (puro, testado em `tests/unit/voice-session.test.js`): `greetingFor` (frase padrão nos 3 idiomas ou a própria, com `{nome}`/`{name}`/`{nombre}`; sem nome, o marcador some junto com a vírgula), `isGoodbye` (o texto todo tem de ser a despedida: "anotar obrigado ao João" não encerra), `silenceClock` (`kick` a cada fala, inclusive parcial; `pause` enquanto pensa e fala; vence uma vez) e os estados (`wake`, `greeting`, `listening`, `thinking`, `speaking`, `error`, `closed`).
- `src/newtab/voice.js`: `startConversation({ greet, first })` roda dentro de `whileWakePaused` (a palavra de ativação fica parada a conversa toda). Ciclo: saudação falada → **só depois** abre o microfone → pedido (encerra após 1,6 s de pausa) → executa → fala → volta a ouvir. O navegador encerra a escuta de tempos em tempos: reabre com espera crescente se a escuta cair muito rápido. Microfone bloqueado ou motor indisponível encerram com a mensagem.
- `src/newtab/wake.js`: só a frase → conversa com saudação; frase + pedido → executa direto (saudação só com "sempre cumprimentar"); com "Conversar depois de chamado" desligado, volta ao comportamento de um pedido só.
- Botão 🎙 / Alt+M: um pedido só, ou a conversa sem saudação com "Conversa também pelo botão".
- `src/lib/voice-viz.js`: canvas 2D a ~30 quadros/s, parado com a aba escondida. Estilos `orb`, `bars`, `line`, `particles` e `classic` (sem canvas, o círculo em CSS de antes). O volume vem de `openMeter()` (`getUserMedia` + `AnalyserNode`) aberto só com a tela de voz aberta e fechado ao fechar; negado ou desligado → onda simulada. A fala pulsa pelo `onboundary` (`speak(text, opts, { onWord })`); vozes que não avisam as palavras usam o ritmo simulado. `prefers-reduced-motion` → só o brilho muda.
- Configurações → Voz → **Conversa e visual**: `voiceConversation`, `voiceGreet`, `voiceGreeting`, `voiceGreetAlways`, `voiceSilenceSecs` (30/60/120), `voiceConvButton`, `voiceViz`, `voiceVizMic`.
- Testes e2e: `tests/e2e/voice-conversation.test.js` (voz simulada com fala de 600 ms para conferir a ordem fala → microfone; microfone falso do Chromium para o medidor).

## Modo conversa (0.8.3, #44)

- O mesmo ciclo da conversa de #40 (`startConversation({ kind: 'chat' })` em `newtab/voice.js`), com: liga/desliga pelo 💬, Alt+C ou "modo conversa"; histórico (`lib/chat-history.js`: últimas 6 trocas inteiras + resumo curto do começo, mandado ao `ask()` com `historyMax`); `runCommand(..., { chat: true })` manda o que não for comando direto para a IA (sem a interpretação nem a pesquisa na web); "anota isso" guarda a última resposta; desliga após `voiceChatIdleMin` (10 min) sem fala, trocando de aba, Esc ou "pode parar"; oferece salvar a conversa como nota.
- Aviso da primeira vez (`voiceChatNoticed`): custo (cada fala é uma chamada à IA) e privacidade.
- `voiceChatBargeIn`: falar por cima corta a resposta (medidor do microfone > 0,45 por 400 ms).
- Botões 💬 e 📋 (`newtab/modes.js`) ficam acima do 🎙, na mesma faixa reservada do #38; com a tela de voz aberta continuam clicáveis.

## Modo reunião (0.8.3, #41)

- Página própria `src/meeting.html` (o reconhecimento de voz não funciona escondido nem em documento offscreen). Estado ao vivo em `storage.local` → `nt_meeting_live` (o 📋 da nova aba e o selo REC do ícone); a reunião em IndexedDB (`meetings`, salva a cada trecho) e o áudio em pedaços de 10 s (`meeting_audio`).
- Online: `getDisplayMedia` (a pessoa escolhe a aba e marca "Compartilhar áudio da aba"; sem permissão nova) + microfone, misturados em `lib/audio-mix.js` (ganho + compressor). A faixa misturada vai para `SpeechRecognition.start(track)` (Chrome/Edge 135+) ou para o `WhisperRecognizer.start(track)`. Se a aba parar de compartilhar, segue só com o microfone.
- `lib/meeting.js` (puro): tempo sem pausas, trechos com horário, ⭐ (botão, Alt+K ou "marca isso", ligada ao trecho), divisão em partes de 12 mil letras, prompts, validação do JSON da IA (`parseSummary`), nota em Markdown e retomada (`isInterrupted`).
- Tarefa de IA `meeting` ("Resumo de reuniões") na central.
- Palavra de ativação e conversa não rodam com a reunião gravando (`meetingLive()`).

## Privacidade e limites (por navegador)

- **Nada é gravado.** O reconhecimento devolve texto; o áudio não é guardado pela NeuroTab.
- **Chrome e Edge (motor `cloud`, ou `auto` sem o idioma baixado):** o reconhecimento de voz do navegador envia o áudio aos servidores do Google ou da Microsoft. Com a palavra de ativação ligada, isso acontece continuamente enquanto a nova aba estiver aberta e em foco. Por isso: é opcional, vem desligada, pede confirmação, mostra o indicador o tempo todo e desliga sozinha após X minutos sem uso.
- **Firefox:** sem reconhecimento de voz até a versão 159 (as opções de voz somem). A partir da 160 ele existe e as opções aparecem; comportamento real a conferir manualmente (ver `NAVEGADORES.md`).
- **Escuta em segundo plano:** não existe. O navegador só deixa ouvir com a página visível e em foco; a NeuroTab não tenta contornar isso.
- **Detecção local da frase (sem enviar áudio):** com o motor "no computador" ou "Whisper local", a palavra de ativação também roda sem mandar áudio para fora. A detecção da frase continua em `lib/wake-word.js` (`afterWake`/`matchesWake`).

## Testes

- Unidade: `tests/unit/wake-word.test.js` (frase composta, tolerância, frases curtas, cancelar, prazos, estados).
- Unidade: `tests/unit/speech-engine.test.js` (escolha do motor, WAV, separação das falas, pedido ao Whisper, texto da resposta).
- Ponta a ponta: `tests/e2e/voice-local.test.js` — Whisper local com o microfone falso do Chrome (um tom, silêncio e a transcrição simulada no `127.0.0.1`), servidor fora do ar, `processLocally` e "somente local", e as opções.
- Ponta a ponta (voz simulada): `tests/e2e/semantic-voice.test.js` — palavra de ativação padrão; nome e frase composta com bipe, estados, cancelar e tempo esgotado.
