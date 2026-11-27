# Área de transferência (0.7.7, #51)

Histórico do que a pessoa copia, **só neste computador**. Não sincroniza, não vai para o backup e não entra no contexto da IA: só vira dado do cérebro quando a pessoa converte um item em nota, tarefa ou imagem da biblioteca.

## Peças

| Arquivo | O que faz |
|---|---|
| `src/lib/clipboard.js` | Tipos (texto, link, e-mail, telefone, cor, código, imagem), proteção de senhas, repetidos, prazos, limites, pesquisa, redução de imagens. |
| `src/lib/clipboard-share.js` | Gancho do compartilhamento com outros aparelhos (sem alvos ainda, veja abaixo). |
| `src/widgets/clipboard.js` | Widget: lista, pesquisa, filtro, ações, colar, pausa, configurações. |
| `src/clip-content.js` | Nível 2: no `copy`/`cut` de uma página, manda o texto selecionado e o site ao fundo. Registrado só quando a pessoa liga. |
| `src/offscreen.js` + `src/clip-ticker.js` | Nível 3 (Chrome/Edge): lê a área de transferência a cada 1,5 s (`execCommand('paste')`), com o relógio num worker (o Chrome desacelera timers de documentos ocultos). |
| `src/background.js` | Liga/desliga cada nível (`syncClipboard`), recebe `clip:copy` e `clip:monitor`, ● no ícone, prazos (`clipprune`, `onStartup`). |
| `src/newtab/search.js` | Itens de texto aparecem na busca Ctrl+K (Enter copia). |

## Níveis de captura

| Nível | Como | Permissão (opcional, pedida no widget) | Navegadores |
|---|---|---|---|
| 1. Colar no widget / botão 📋 | evento `paste` no quadro; `navigator.clipboard.read()` no botão | nenhuma para colar; `clipboardRead` para o botão | todos |
| 2. Ao copiar em sites | content script registrado com `scripting.registerContentScripts` em `https://*/*`; abas já abertas recebem o script na hora | `https://*/*` | todos (não roda em janela anônima; `sender.tab.incognito` é recusado) |
| 3. Acompanhar tudo | documento oculto com motivo `CLIPBOARD` | `clipboardRead` | Chrome/Edge com o navegador aberto; Firefox só com a nova aba aberta e visível (o widget lê a cada 2 s) |

O primeiro item lido ao ligar o nível 3 só marca o ponto de partida: o que já estava copiado não entra.

## Dados

- `nt_clipboard`: `{ items: [{ id, key, kind, text, image: { data (WebP em data URL), w, h, type, size }, source: { url, title }, via, deviceId, origin, pinned, count, createdAt, updatedAt }] }`
- `nt_clipboard_cfg`: `{ paused, sites, monitor, retention, max, maxImages, protect, ignore[], share: { enabled, targets[] } }`
- `nt_device`: `{ id }` deste aparelho (reaproveita o da sincronização, se houver).

`key` evita repetidos (`txt:<texto>` ou `img:<impressão>`): o repetido sobe para o topo e soma `count`. O mesmo Ctrl+C que chega pelo site e pelo acompanhamento em menos de 4 s conta uma vez.

## Prazos

| Opção | Comportamento |
|---|---|
| **Ao fechar o navegador ou desligar o computador** (padrão) | No `runtime.onStartup` o histórico começa vazio |
| 1 hora, 1 dia, 7 dias, 30 dias | Itens mais antigos saem ao gravar, ao abrir o widget e a cada 30 min |
| Nunca | Só quando a pessoa apaga |

Itens fixados (★) nunca saem sozinhos. Limites: 200 itens (50 a 500), 30 imagens; imagens reduzidas a 1600 px em WebP.

## Proteção

- Nível 2 ignora campos de senha e campos com `autocomplete` de senha, código de uso único e cartão.
- `looksSensitive` recusa, quando a proteção está ligada (padrão): cartão (Luhn), códigos de 4 a 8 dígitos, JWT, chaves conhecidas (`sk-`, `AIza`, `ghp_`, `AKIA`…), tokens longos e "senhas" (8 a 64 caracteres, sem espaço, com 3 tipos de caractere). Pix copia e cola (`000201…`) passa.
- Sites ignorados: bancos, gerenciadores de senha e telas de login (lista editável).
- Colar à mão (`force`) passa pela proteção: foi a pessoa que colou.

## Compartilhar com outros aparelhos (0.7.7.2)

Cada pessoa liga os caminhos que quiser (vários ao mesmo tempo) e escolhe as regras no botão 📤 do widget.

| Peça | O que faz |
|---|---|
| `src/lib/clipboard-share.js` | Configuração (`share` dentro de `nt_clipboard_cfg`), regras (`shouldShare`), formato que viaja (`toPayload`/`cleanPayload`), cifra do ntfy, link de pareamento. |
| `src/lib/clipboard-transports.js` | ☁️ nuvem (Drive), 🔔 ntfy e ✈️ Telegram: `send(payload)` e `poll(state)`. |
| `src/lib/clipboard-sync.js` | `dispatchShares` (envia o que deve sair e marca `sharedAt`/`sharedVia`/`shareError`) e `pollShares` (traz o que chegou, como item `origin: 'remote'` com `from`). |
| `src/widgets/clipboard-share-ui.js` | Tela 📤, QR de um item, downloads da Ponte. |
| `src/background.js` | Envia 0,4 s depois de cada mudança no histórico, confere a cada 30 s (`clipshare`), conecta a Ponte (`connectNative`). |
| `docs/cola/` | Página do celular no site (nuvem e ntfy), sem instalar nada. |
| `ponte/` | NeuroTab Ponte em Go: instalador + servidor na rede local (página do celular embutida). |

### Regras
- **O que enviar:** só o que a pessoa manda (botão 📤, padrão) · os fixados · tudo o que for copiado.
- **Imagens:** não · só as pequenas (até 300 KB, padrão) · todas. O ntfy leva só texto; o QR, só texto até 1.500 caracteres.
- **Sentido:** enviar e receber · só enviar · só receber.
- O que chegou de outro aparelho **nunca é reenviado** (sem eco), e o próprio aparelho ignora o que ele mesmo mandou (`from.id`).

### Formato que viaja
`{ v: 1, id, at, from: { id, name }, kind, text, image: { data, w, h, type } | null }` — validado na chegada (`cleanPayload`: tamanho, tipo de imagem, campos).

### Caminhos

| Caminho | Como | Privacidade | Recebe |
|---|---|---|---|
| 📷 QR | o widget desenha o QR (vendor `qrcode.js`) | nada sai do computador | — |
| ☁️ Minha nuvem | `nt-clipboard.json` na pasta oculta do Drive (últimos 50), cifrado com a chave da sincronização; precisa da sincronização ligada | Google não lê (com senha) | a cada 30 s |
| 🔔 ntfy | tópico aleatório (`nt-…`, 144 bits) num servidor ntfy (padrão ntfy.sh, pode ser próprio). Cifrado (`NT1:` + envelope AES-GCM) com chave de 256 bits que só vai no `#` do link de pareamento. Opção "texto aberto" para ler nas notificações do app ntfy | servidor não lê (a não ser no modo aberto) | 30 s; na hora com a nova aba aberta (EventSource) |
| ✈️ Telegram | bot da pessoa (token do @BotFather); `getMe` + `/start` acham a conversa; `sendMessage`/`sendPhoto`, `getUpdates` | Telegram lê | a cada 30 s |
| 🏠 Rede local | `connectNative('com.neurotab.ponte')`; a Ponte abre `http://IP:41414` (ou a próxima porta livre) com token de 192 bits no `#` do QR | não sai da rede; HTTP simples na rede local (use em redes de confiança) | na hora (SSE) |

Na primeira leitura de um caminho, só entram itens dos últimos 10 minutos (um aparelho novo não recebe o histórico inteiro).

### Página do celular (`docs/cola/`)
- `#nuvem`: login Google no próprio site (fluxo implícito, escopo `drive.appdata`, mesmo cliente OAuth). Lê `nt-sync-meta.json`, pede a senha da sincronização (PBKDF2 igual ao da extensão; `sync-crypto.js` é cópia idêntica, conferida por teste), lê e grava `nt-clipboard.json`. **Precisa** no cliente OAuth: origem JavaScript `https://mpjbiologo.github.io` e URI de redirecionamento `https://mpjbiologo.github.io/NeuroTab/cola/`.
- `#ntfy&s=…&t=…&k=…&n=…`: guarda o canal no aparelho, apaga o `#` da barra, lê as últimas 24 h e fica ao vivo.

### NeuroTab Ponte (`ponte/`)
- Sem argumentos (duplo clique): copia o programa para `%LOCALAPPDATA%\NeuroTab`, `~/Library/Application Support/NeuroTab` ou `~/.local/share/neurotab` e registra o host `com.neurotab.ponte` no Chrome, Edge, Chromium, Brave e Firefox (registro do Windows ou `NativeMessagingHosts/` do perfil). `--uninstall` remove; `--extension-id=ID` libera uma extensão carregada sem empacotar.
- Chamada pelo navegador: recebe `hello { token, port, name }`, responde `ready { urls, port, version }`, repassa `item` para a página e manda `incoming` quando o celular envia. Fecha quando o navegador fecha a conexão.
- Endereços (0.9.2.2, `ponte/lanaddr.go`): `ready` traz `addrs: [{ url, ip, iface, virtual, publicNet }]`, o melhor primeiro (192.168 > 10 > 172.16–31; Wi-Fi/Ethernet ganham, VPN/virtuais — nome conhecido, sem MAC ou ponto a ponto — perdem; o IP de saída do sistema desempata). No Windows, `Get-NetConnectionProfile` marca as redes Públicas. `urls` continua, na mesma ordem. A extensão monta a lista com `lanTargets` (ordena por IP quando a Ponte é antiga) e o QR leva só o recomendado.
- Firewall (Windows): a instalação grava `liberar-firewall.cmd` e roda com `Start-Process -Verb RunAs` (apaga as regras do programa, inclusive "Bloquear", e cria "NeuroTab Ponte": entrada, TCP 41414–41423, perfis privado e domínio). `--firewall` refaz só essa parte.
- Espelho (0.9.2.4): com `share.lan.mirror` (ligado por padrão), o fundo manda à Ponte os 30 itens mais recentes deste computador (`lanMirrorItems`: sem os de outros aparelhos, regra de imagens, nunca no "só receber"), ao conectar e a cada mudança, independentemente de "o que compartilhar". `lanSent` guarda os ids já entregues nesta conexão (a Ponte só guarda na memória; ao reabrir, recebe tudo de novo). Não precisa de Ponte nova.
- API: `GET /` (página), `GET /api/items`, `POST /api/send`, `GET /api/events` (SSE). Tudo em `/api` exige o token (`X-NT-Token` ou `?t=`), comparado em tempo constante; corpo até 12 MB.
- A release compila para Windows, macOS (Intel e Apple) e Linux (x64 e ARM) e anexa os arquivos + `SHA256SUMS`.

## Testes

- `tests/unit/clipboard.test.js`: tipos, proteção, sites ignorados, repetidos e eco, recusas, prazos (incluindo "ao desligar"), limites, limpar, pesquisa e o gancho do compartilhamento.
- `tests/unit/clipshare.test.js`: regras, formato, nuvem (dois computadores, eco, primeira leitura), ntfy (cifra, chave errada, texto aberto), Telegram (conectar, texto, foto, outras conversas).
- `tests/e2e/clipshare.test.js`: tela 📤 e QR; **rede local de verdade** (extensão ↔ Ponte compilada ↔ página do celular, nos dois sentidos); página do celular do site nos modos ntfy e nuvem.
- `ponte/ponte_test.go`: formato das mensagens, token, envio, ao vivo, sessão completa e instalador.
- `tests/e2e/clipboard.test.js`: widget (colar, copiar de novo, fixar, virar tarefa com lembrete, pesquisar, configurar, limpar) e a captura de verdade com as permissões concedidas (copiar num site com a origem, botão que escreve direto, senha recusada, pausa e o ● no ícone).

## Justificativa para as lojas

**clipboardRead (opcional):**
> Used only by the optional Clipboard widget, after the user turns on "Monitor everything I copy" or clicks "Paste" in the widget. NeuroTab keeps a local history of copied text and images on the user's computer so they can copy it again or turn it into a note. Nothing is sent to any server, synced or shared; passwords and codes are ignored when recognized.

**nativeMessaging (opcional):**
> Used only when the user turns on "Local network" sharing in the optional Clipboard widget and installs the companion app NeuroTab Ponte, to send clipboard items to the user's own phone on the same Wi-Fi. No data goes to any server.

**https://\*/\* (opcional, já existente):** também usado pela opção "When copying on websites" do mesmo widget, para guardar localmente o texto copiado e o site de origem.

## Mídias nos seus aparelhos (0.9.3.2, #80)

Fotos, vídeos e áudios usam os mesmos caminhos, as mesmas chaves e as mesmas regras (sentido, nome do aparelho).

**Formato:** o envelope v1 ganha `kind: 'media'`, `media: { title, url, platform, summary, category, author }` e
`files: [{ id, name, mime, size, drive?, ntfy?, enc? }]`. O `text` leva "📎 título + link": aparelho com versão antiga
mostra como texto e nada quebra. Regras e validação em `src/lib/media-share.js` (`cleanMediaPayload` nunca confia no formato);
a parte que age em `src/lib/media-share-run.js`.

| Caminho | O que vai | Limite | Cifra |
|---|---|---|---|
| 🏠 Rede local | sozinho: as 20 mais recentes da Biblioteca de mídias + as mandadas com 📤 | 500 MB do celular para o PC | rede local, código de acesso |
| ☁️ Nuvem | só com 📤; um arquivo `nt-media-<uuid>` na pasta oculta do Drive | 25 MB (configurável), apagado em 7 dias (configurável) | AES-GCM com a chave da sincronização (`NTB1` + iv + dados); sem senha de sincronização, sem cifra |
| 🔔 ntfy | só com 📤; anexo (`PUT`, tag `nt-file`) + mensagem NT1 com o link do anexo | 15 MB (o ntfy.sh apaga em 3 h) | AES-GCM com a chave do QR |
| ✈️ Telegram | só com 📤; `sendPhoto/sendVideo/sendAudio/sendDocument` | 50 MB | nenhuma (o Telegram lê; avisado na tela) |

Maior que o limite do caminho: vai só o link e o resumo (com aviso no texto). `src/lib/bytes-crypto.js` é copiado igual
em `docs/cola/bytes-crypto.js` (um teste confere).

**Ponte (`ponte/media.go`):** a extensão registra cada arquivo (`{type:'file', payload:{id,name,mime,path|data}}`) antes
do envelope. `GET /api/file/<id>` serve só o que foi registrado, só dentro de Downloads, com `Range` (o vídeo toca sem
baixar tudo), `nosniff`, CSP `sandbox` e `?dl=1` para baixar. Nunca lista pastas; id desconhecido ou `..` = 404.
`POST /api/upload` grava em `Downloads/NeuroTab/Do celular` (arquivo temporário, depois renomeia; nome repetido ganha
" (1)"; até 500 MB) e manda `{type:'incoming', payload, path}` para a extensão. A operação `read` do `dl` lê um arquivo
de Downloads em pedaços de 600 KB (a mensagem da Ponte para a extensão tem até 1 MB) — usada pelo 📤 e para levar as
fotos do celular para a biblioteca.

**Do celular:** cada arquivo vira uma entrada em `nt_media_inbox` (só neste computador; aba 📥 Do celular da Biblioteca).
Pela rede local o arquivo já está na pasta; pela nuvem/ntfy, as imagens (até 12 MB) entram sozinhas na biblioteca e o
resto é salvo pelo botão ⬇ Salvar no computador (a página baixa, decifra e grava em `NeuroTab/Do celular`).
A limpeza da nuvem roda no alarme `clipshare`, no máximo uma vez por hora.
