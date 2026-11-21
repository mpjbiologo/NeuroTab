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

## Compartilhar com outros aparelhos (planejado)

O código já está pronto para isso: cada item tem `deviceId` e `origin`, `addClip({ via: 'remote' })` marca o que veio de fora, `shareItem` nunca devolve um item remoto, e `registerShareTarget` acrescenta destinos sem mexer no widget.

Desenho previsto, **sem servidor da NeuroTab**:

1. **Entre computadores:** um arquivo `nt-clipboard.json` na pasta oculta do Drive (depois, OneDrive), criptografado com a mesma chave da sincronização, com os últimos N itens marcados para compartilhar. Cada aparelho lê no ciclo da sincronização.
2. **Celular:** uma página do site (`/NeuroTab/cola/`) que entra com a mesma conta Google (o mesmo cliente OAuth, escopo `drive.appdata`), pede a senha da sincronização, mostra os itens e envia texto para o computador. Nada para instalar.
3. **Rede local (avaliar):** só com um ajudante instalado no computador, porque extensões não abrem portas.

Regras: desligado por padrão; a pessoa escolhe o que compartilha (tudo ou só os fixados); imagens só sob pedido; o que vem de outro aparelho aparece com o nome dele.

## Testes

- `tests/unit/clipboard.test.js`: tipos, proteção, sites ignorados, repetidos e eco, recusas, prazos (incluindo "ao desligar"), limites, limpar, pesquisa e o gancho do compartilhamento.
- `tests/e2e/clipboard.test.js`: widget (colar, copiar de novo, fixar, virar tarefa com lembrete, pesquisar, configurar, limpar) e a captura de verdade com as permissões concedidas (copiar num site com a origem, botão que escreve direto, senha recusada, pausa e o ● no ícone).

## Justificativa para as lojas

**clipboardRead (opcional):**
> Used only by the optional Clipboard widget, after the user turns on "Monitor everything I copy" or clicks "Paste" in the widget. NeuroTab keeps a local history of copied text and images on the user's computer so they can copy it again or turn it into a note. Nothing is sent to any server, synced or shared; passwords and codes are ignored when recognized.

**https://\*/\* (opcional, já existente):** também usado pela opção "When copying on websites" do mesmo widget, para guardar localmente o texto copiado e o site de origem.
