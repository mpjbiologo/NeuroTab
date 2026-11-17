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
