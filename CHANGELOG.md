# Changelog

## v0.7.6.1 — 20 de novembro de 2026
**Contas e sincronização: suas notas iguais em todos os navegadores, criptografadas no seu Google Drive.**

- ☁️ **Nova aba "Contas e sincronização" (#27):** conecte uma ou mais contas Google. O acesso fica só no navegador; nada passa por servidores da NeuroTab. "Desconectar" revoga o acesso no Google
- 🔄 **Sincronização:** cérebro (notas, tarefas, trechos e lixeira), atalhos e grupos, configurações, agenda e hábitos, pela pasta oculta da NeuroTab no seu Google Drive (não aparece nos seus arquivos; a NeuroTab não vê os outros arquivos do Drive). Você escolhe o que sincroniza
  - **Com senha (recomendado):** tudo é criptografado no computador antes de sair; nem o Google consegue ler. **Sem senha:** mais simples, mas o conteúdo fica legível na sua conta
  - Acontece sozinha depois de cada mudança, a cada 5 minutos e ao abrir o navegador. Dá para pausar, sincronizar agora, desligar num aparelho ou apagar tudo da nuvem
  - Nada some sem querer: o que foi editado num aparelho e excluído no outro fica; se a mesma nota mudou nos dois, as duas versões ficam no cérebro
  - Chaves de API e imagens da biblioteca não sincronizam
- A agenda pela conta Google (criar e editar eventos lá) e a Microsoft (Outlook e OneDrive) vêm nas próximas versões

## v0.7.6 — 2026-11-20
**Agenda: seus compromissos na nova aba, com o Google Agenda, o Outlook e o iCloud.**

- 📅 **Widget Agenda (#26):** visualizações Próximos (14 dias), Dia, Semana e Mês. Crie, edite e exclua compromissos com local, notas, aviso e repetição (todo dia, dias úteis, toda semana, todo mês, todo ano). Numa repetição, dá para excluir só uma ocorrência ou todas
- 🔗 **Google Agenda, Outlook e iCloud por link:** cole o "endereço secreto no formato iCal" (Google), o link ICS publicado (Outlook) ou o link de agenda pública (iCloud). A agenda aparece com a cor que você escolher, só leitura, e se atualiza sozinha a cada 30 minutos, mesmo com a nova aba fechada. Cada evento tem "Abrir no serviço" e "Copiar para minha agenda". Se o link parar de funcionar, o widget diz o motivo
  - Entende repetições, exceções, eventos movidos ou cancelados, dia inteiro, eventos de vários dias e fusos horários, inclusive horário de verão e os nomes de fuso do Outlook
- 📂 **Importar e exportar .ics:** importe um arquivo para "Minha agenda" (sem duplicar ao importar de novo) e exporte a sua agenda para levar a outro serviço
- 🔔 **Avisos:** notificação antes do compromisso (padrão: 10 minutos), também para os eventos das agendas por link que têm aviso
- 🧠 **O cérebro conhece sua agenda:** "o que tenho amanhã?" e "minha agenda de hoje", por voz ou na pergunta rápida, respondem com os compromissos e as tarefas do dia, mesmo sem IA. Nas perguntas à IA, a agenda dos próximos 14 dias vai junto ("tenho algo livre na quinta?")
- Criar e editar eventos direto na conta do Google ou da Microsoft (com login) fica para uma próxima versão

## v0.7.5.3 — 2026-11-19
Leva às lojas tudo da 0.7.5.2, que não chegou a ser enviada: um teste falhou na hora da release e o envio foi pulado.
- 🔧 **Análise de imagem:** a imagem não guardada é apagada pelo fundo da extensão quando a janela de análise fecha. Antes, a própria janela tentava apagar e às vezes fechava antes de terminar (a imagem sobrava até a limpeza da nova aba)
- 📦 **Situação nas lojas:** a issue de acompanhamento agora avisa quando uma release nem chega às lojas

## v0.7.5.2 — 2026-11-19
- 🎞️ **Nova aba Mídia nas configurações:** reúne tudo de análise de imagens, e vai receber as opções de vídeos e áudios
  - **Guardar a imagem analisada na biblioteca:** "Perguntar a cada vez" (padrão), "Guardar sempre" ou "Não guardar". Antes, toda imagem analisada pelo botão direito ia para a biblioteca. Agora, sem guardar, ela não aparece na biblioteca nem no cérebro e some quando a janela de análise fecha; a janela tem o botão **💾 Guardar** para mudar de ideia
  - **IA para imagens:** escolha uma IA só para descrever imagens (por exemplo, o Ollama no computador), sem trocar a IA da conversa. Usa a chave daquele provedor, configurada na aba IA e voz
  - "Modelo para imagens", "Enviar imagens à IA sem perguntar" e "Ler o texto das imagens salvas" saíram da aba IA e voz e vieram para cá

## v0.7.5.1 — 2026-11-19
- 🧩 **Barra de organizar sempre à vista (#60):** no modo Livre, a barra com "＋ Widget", "Salvar layout" e "Concluir" ficava atrás dos widgets. Agora ela fica fixa no rodapé, por cima de tudo, nos modos Grade e Livre. A página ganha uma folga embaixo enquanto você organiza, para nenhum widget ficar escondido atrás da barra. No celular, ela se ajusta à largura da tela
- 🔧 **Descrição de imagens pela IA:** no Ollama, o modelo padrão (llama3.2) só entende texto. Ele recebia a imagem, ignorava e "descrevia" só pelo texto lido. Agora a NeuroTab confere se o modelo enxerga imagens. Se não enxergar, usa outro modelo com visão já instalado (gemma3, llava, qwen2.5vl…) ou explica o que instalar (`ollama pull gemma3`), sem enviar nada ao modelo errado. A janela de análise mostra qual modelo descreveu a imagem
  - Nova opção em Configurações → IA e voz → Imagens: **Modelo para imagens**, para escolher o modelo das imagens sem trocar o da conversa
  - Mais folga de resposta para modelos que "pensam" antes de responder (Gemini, GPT-5), que podiam devolver a descrição cortada

## v0.7.5 — 2026-11-19
**O cérebro lê as imagens, e a barra de pesquisa faz o que você escolher no Enter.**

- 🖼️ **O cérebro lê as imagens da biblioteca (#17):** o texto de cada imagem salva é lido no próprio computador, sem enviar a imagem a lugar nenhum. A imagem lida vira um item do cérebro (filtro 🖼️ Imagens): a busca, a busca por significado e as perguntas ao cérebro passam a encontrá-la, e o item tem um botão para abrir a imagem original. Excluir a imagem tira o item do cérebro. Cada imagem da biblioteca mostra se já foi lida, se não tem texto ou se deu erro
  - Na primeira vez, a NeuroTab baixa o pacote do idioma do leitor de texto (de 1,4 a 3 MB), que fica guardado. Dá para desligar em Configurações → IA e voz → Imagens
- 🔍 **Analisar imagem (#54):** no botão direito sobre uma imagem, ou no botão Analisar da biblioteca. Mostra o texto lido (com botão de copiar), o endereço encontrado e, pela IA configurada, uma descrição e a resposta a uma pergunta sobre a imagem
  - Com o Ollama (ou outra IA no computador), a descrição sai sem perguntar e nada sai do computador
  - Com IA na internet (Gemini, OpenAI, Claude…), a imagem só é enviada depois de você clicar em "Enviar e descrever". Dá para marcar "Não perguntar de novo"
- 🧭 **Traçar rota pelo botão direito (#54):** selecione um endereço numa página → NeuroTab → Traçar rota. A nova aba abre com o trajeto no widget Trânsito, com o destino no campo para corrigir se precisar. Na análise de imagem, o endereço encontrado também tem o botão Traçar rota
- ⏎ **Enter da barra de pesquisa (#57):** em Configurações → Geral → Pesquisa, escolha o que o Enter faz: pesquisar na internet (padrão), abrir o primeiro resultado, perguntar ao cérebro, salvar como nota ou salvar como tarefa. As setas ↑↓ continuam escolhendo outro item, Shift+Enter continua salvando nota, e a lista mostra "Enter" ao lado da ação que vai acontecer
  - Nova ação na lista: **Salvar como tarefa**, que já entende datas ("pagar a luz amanhã às 9h" vira tarefa com lembrete)
- O leitor de texto (Tesseract.js, Apache-2.0) vai dentro da extensão; o pacote ficou com 1,6 MB

## v0.7.4 — 2026-11-18
**Novo visual: três temas, ícones desenhados e mais fácil de usar.**

- 🎨 **Três temas** em Configurações → Geral → Aparência, com prévia (#53):
  - **Futurista** (padrão): noite índigo, ciano elétrico e letras geométricas.
  - **Sóbria**: grafite e azul, limpa como um app de trabalho.
  - **Calorosa**: carvão quente, âmbar, títulos com serifa e cantos mais redondos.
  O tema vale para a nova aba, as configurações, o botão da extensão e a página de permissão, e já aparece certo ao abrir a aba, sem piscar.
- ✏️ **Ícones desenhados** no lugar dos emojis dos botões, títulos dos widgets, abas e menus, iguais em qualquer sistema. Os emojis que você escolhe (grupos, atalhos) continuam como estão
- 🧹 **Menos poluição nos cartões:** os botões de cada widget aparecem ao passar o mouse ou ao navegar pelo teclado. Estados vazios viraram uma linha curta
- ♿ **Acessibilidade:** contraste mínimo AA em todos os temas (o botão azul antigo ficava abaixo), foco do teclado sempre visível, respeito ao "reduzir movimento" do sistema, avisos lidos por leitores de tela e nome em todo botão que só tem ícone
- ⚙️ **Configurações e popup** no mesmo visual escuro da nova aba (antes eram claras e genéricas)
- 🎙 Tela de voz: não mostra mais "Não ouvi nada" junto com o erro do microfone, e o selo 🔒/☁ ficou dentro do cartão
- 🌐 **Site** no mesmo visual: sem texto em degradê e sem brilhos, versão atual automática e títulos que faltavam traduzidos em inglês e espanhol
- Fontes (Inter, Space Grotesk, Fraunces) e ícones (Lucide) vão dentro da extensão, sem buscar nada na internet
- Regras do visual em `docs/dev/DESIGN.md`

## v0.7.3.1 — 2026-11-17
**Correção: baixar o reconhecimento de voz no computador.**

- O Edge não oferece português do Brasil no computador (só de Portugal), então o download falhava. Agora a NeuroTab usa o idioma parecido que o navegador tem (pt-BR → pt-PT, es-MX → es-ES, en-GB → en-US) e avisa nas opções. O português de Portugal entende bem a fala brasileira (#49)
- Se o download falhar, a mensagem diz o motivo (o navegador recusou, pediu outro clique ou não respondeu), o próximo clique tenta o idioma parecido e o Whisper local aparece como alternativa
- "Testar conexão" do Whisper explica que o Whisper é um programa à parte, que precisa estar instalado e aberto no computador

## v0.7.3 — 2026-11-17
**Voz no seu computador e janelas que lembram como estavam.**

- 🔒 **Voz local (#49):** em Opções → IA e voz, escolha onde a fala é reconhecida:
  - **Automático** (padrão): no computador quando o idioma já está baixado; senão, como antes.
  - **No computador**: o reconhecimento do próprio Chrome/Edge (139+), sem mandar áudio. Um botão baixa o pacote do idioma uma vez (cerca de 60 MB).
  - **Whisper local**: um servidor Whisper no seu computador (whisper.cpp, Speaches ou LocalAI), com botão para testar a conexão. Funciona também no Firefox. Junto com o Ollama, a voz inteira fica no computador.
  - **Serviço do navegador**: o de sempre (o áudio vai para o Google ou a Microsoft).
- **Somente local:** a voz nunca vai para a internet, nem para ouvir, nem para ler as respostas (só vozes instaladas no computador). Sem um jeito local de ouvir, o microfone avisa o que fazer em vez de usar a nuvem. Se a IA for de nuvem, as opções avisam
- 🔒 / ☁ na tela de voz e no indicador da palavra de ativação mostram onde a voz está sendo processada
- 🪟 **Janelas lembram o estado (#50):** um widget maximizado continua maximizado numa aba nova, ao recarregar e ao reabrir o navegador (minimizado já ficava salvo). Esc, o botão ou um clique fora desfazem. Só um widget fica maximizado por vez, e as outras abas abertas acompanham
- Correção: salvar algo num widget (minimizar, mover, maximizar) redesenhava todos os widgets da aba, apagando o que estava sendo digitado. O navegador devolve os dados com as chaves em outra ordem e a NeuroTab achava que o layout tinha mudado

## v0.7.2.3 — 2026-11-16
**Rotas que funcionam e trânsito ao vivo pelo cérebro.**

- Rotas: o servidor de rotas do OpenStreetMap recusava os pedidos e toda rota terminava em "Não achei um caminho pela rua". Agora a NeuroTab tenta três servidores gratuitos em ordem (FOSSGIS OSRM, FOSSGIS Valhalla e o servidor de demonstração do OSRM); se todos falharem, a mensagem diz o motivo de cada um. Na primeira rota depois da atualização, o navegador pede a permissão de novo, por causa dos servidores novos (#43)
- "Como está o trânsito no centro de BH?", no cérebro ou por voz, abre o mapa ao vivo do Waze no lugar citado, com o widget Trânsito maximizado, em vez de a IA dizer que não tem acesso ao trânsito. Sem lugar ("como está o trânsito?"), mostra perto de casa
- O lugar procurado pode virar favorito ali mesmo: "⭐ Salvar centro de BH"
- Siglas de cidades viram o nome inteiro na busca de endereços: BH, SP, RJ, POA, BSB, JF… ("centro de BH" vira "Centro, Belo Horizonte")
- A IA é avisada de que a NeuroTab mostra o trânsito ao vivo e traça rotas, para não responder que não consegue

## v0.7.2.2 — 2026-11-16
**A rota aparece no widget Trânsito, sem abrir outro site.**

- "Traçar rota para…" (no cérebro ou por voz) agora desenha o trajeto no próprio widget Trânsito, que se maximiza sozinho. Se o widget não estiver na tela, ele é acrescentado, sem apagar a conversa com o cérebro. Esc volta ao tamanho normal (#43)
- Mapa próprio com o caminho pelas ruas (OpenStreetMap): distância, tempo sem o trânsito de agora e passo a passo. Arraste para mover, roda do mouse ou ＋/－ para aproximar, ⟲ para enquadrar
- Novo botão 🧭 no widget: escolha a origem, digite o destino (local salvo, endereço ou nome do lugar) e o modo (carro, a pé ou bicicleta)
- Favoritos no próprio widget: botão "⭐ Salvar local" sempre à vista, "⭐ Salvar destino" depois de traçar uma rota e "🧭 Salvar rota" quando origem e destino são favoritos. Rotas salvas ganham o botão "🧭 Traçar"
- Google Maps e Waze continuam disponíveis, mas só abrem se você clicar
- O mapa usa ladrilhos do OpenStreetMap e troca de servidor sozinho se um deles recusar o acesso

## v0.7.2.1 — 2026-11-16
**Correção: o cérebro traça rotas de novo.**

- Com uma IA configurada, "traçar rota para…" era enviado à IA, que respondia que não consegue traçar rotas. Agora o pedido de rota é resolvido na própria NeuroTab, com ou sem IA: a resposta traz o trajeto e os botões do Google Maps e do Waze (#43)
- Entende mais jeitos de pedir: "qual a rota para…", "abre o mapa até…", "quero ir para…", "de casa até o centro" (origem e destino pelo texto) e o nome do assistente antes da vírgula ("Verônica, traça a rota pro trabalho"). "Traçar rota" sem destino pergunta para onde
- Voz: rota para um lugar que não está salvo no widget de mapas também abre o Google Maps, em vez de cair na IA
- "A melhor rota para emagrecer" continua indo para a IA: destino que começa com verbo não é lugar

## v0.7.2 — 2026-11-15
**O assistente ganha nome e as janelas param de se atropelar.**

- Voz: dê um nome ao assistente (ex.: Verônica) e escolha a frase de ativação, só o nome ou algo como "Acorde Verônica", com sugestões prontas em português, inglês e espanhol. A frase entende pequenos erros do reconhecimento ("Berônica", "acorda") e frases curtas só valem exatas, para não disparar à toa (#15)
- Voz: bipe curto ao ouvir a frase (opcional), "cancelar" desiste do pedido e a escuta do comando encerra sozinha se ninguém falar (5, 8 ou 15 segundos)
- Voz: o indicador mostra sempre o estado: aguardando a frase, ouvindo o comando, processando, pausada ou microfone bloqueado
- Janelas: a ordem das camadas não muda mais com o uso (antes, clicar no 🎙, num aviso ou num menu podia deixá-los por cima de janelas importantes); menus e a previsão do tempo nunca saem da tela e viram para cima quando falta espaço; Esc fecha uma coisa de cada vez, a de cima primeiro (#35)
- Documentação: `docs/dev/VOZ.md` (como a voz funciona e limites de cada navegador) e regras de camadas em `docs/dev/ARQUITETURA.md`

## v0.7.1 — 2026-11-13
**O cérebro conhece seus locais e trajetos, e os widgets ganham maximizar e minimizar.**

- Mapas: o cérebro responde sobre os locais e rotas salvos no widget 🚦 Trânsito, como "quanto tempo até o trabalho?", "qual o endereço da academia?" e "quais rotas eu tenho?". Endereço, distância em linha reta e listas funcionam até sem IA; as respostas trazem botões do Google Maps e do Waze (trânsito ao vivo) e "🛣 Tempo pela rua" (OpenStreetMap, sem trânsito, pede permissão na primeira vez). Também por voz, em português, inglês e espanhol (#43)
- Privacidade: nova opção "Enviar locais salvos à IA" (ligada por padrão; os endereços só vão quando a pergunta é sobre lugares)
- Widgets: botões para maximizar (ocupa a área útil; Esc ou clique fora restauram), minimizar (fica só o cabeçalho, sem perder nada; o estado fica salvo) e restaurar, no modo grade e no livre (#18)
- Por dentro: barramento de eventos entre as partes da nova aba (#5) e contrato dos widgets com limpeza automática ao desmontar (#6); documentação em `docs/dev/WIDGETS.md`

## v0.7.0 — 2026-11-12
**Arquitetura modular: a nova aba dividida em partes independentes, base para as próximas versões.**

- Nova aba: o arquivo principal (1.868 linhas) foi dividido em 14 módulos em `src/newtab/`, um para cada parte da tela (barra de atalhos, busca, widgets, modo livre, voz, palavra de ativação…). Nada muda no uso; mapa em `docs/dev/ARQUITETURA.md` (#14)
- Botões flutuantes: o 🎙 e o 📷 não cobrem mais a borda dos widgets no modo grade (ex.: o "Enviar" do widget "Pergunte ao seu cérebro") (#38)
- Palavra de ativação: regras separadas em `lib/wake-word.js`, com testes (base para a v0.8)
- Layout: geometria do painel (colunas, espaço livre, encaixe) separada em `lib/layout-geometry.js`, com testes

## v0.6.3 — 2026-11-12
**Manutenção: mais segurança no que aparece na tela e base pronta para as próximas versões.**

- Segurança: todo HTML que a NeuroTab coloca na página (respostas da IA, textos traduzidos, QR Code do Pix) agora passa por uma limpeza que remove scripts, eventos e links `javascript:` antes de aparecer
- Firefox: o validador da loja não aponta mais nenhum aviso (antes eram 8)
- Release: componentes do GitHub atualizados para o Node 24 (sem avisos de versão antiga)
- Testes: Firefox 160 tem reconhecimento de voz; o teste da palavra de ativação acompanha o navegador

## v0.6.2 — 2026-11-12
**Salvar imagens de qualquer site e novos jeitos de apoiar.**

- Biblioteca de imagens: "Salvar imagem na biblioteca" agora funciona com imagens que só abrem logado (ChatGPT, Gemini, Google Fotos, Drive, webmail…), endereços `blob:` e `http:`, sites que bloqueiam cópia (hotlink) e servidores que não informam o tipo da imagem. Quando o download direto não dá, a NeuroTab pega a imagem de dentro da própria página (seu login não sai do navegador) e, em último caso, recorta a imagem da parte visível da tela
- Biblioteca de imagens: o tipo da imagem é descoberto pelos primeiros bytes (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG)
- Mensagens de erro com a dica de copiar e colar quando o site não deixa extensões lerem a página
- Plano de fundo: o crédito da foto do Bing/NASA não fica mais por cima dos widgets. Virou um botão 📷 acima do botão de voz; o nome e o link aparecem ao passar o mouse (#38)
- Apoie: nova chave Pix, Ko-fi e PayPal
- Lojas: a NeuroTab está publicada no Edge, no Chrome e no Firefox; quem instala pela loja recebe as atualizações sozinho
- Release: envio automático para as lojas do Firefox, do Edge e do Chrome (e conferência das credenciais sem publicar)

## v0.6.1 — 2026-11-09
**Pronta para a loja do Firefox.**

- Firefox: declaração de dados exigida pela Mozilla desde 03/11/2026: nada é obrigatório; localização (clima e Trânsito) e envio de conteúdo à IA são opcionais e pedidos na hora de usar. Sem consentimento, nada é enviado
- Firefox: corrigido o pedido de permissão da IA, que não aparecia (o Firefox exige o pedido direto no clique)
- Firefox: versão mínima passa a ser a 140
- CI: testes num **Firefox de verdade** (Selenium) a cada push, além do Chromium
- Release: envio automático para a loja do Firefox quando as credenciais `AMO_JWT_ISSUER`/`AMO_JWT_SECRET` estiverem configuradas
- Guia de publicação: `docs/store/FIREFOX.md`

## v0.6.0 — 2026-11-09
**Fundação: testes automáticos, migrações de dados, permissões sob demanda e chaves mais protegidas.**

**Testes e CI** (#1, #16)
- 37 testes de unidade (`node:test`) e 18 de ponta a ponta (Playwright, com a extensão carregada num Chromium de verdade), sem depender de internet
- Cobrem backup e restauração, migrações, criptografia, datas e comandos de voz nos três idiomas, busca por significado, palavra de ativação, biblioteca de imagens, modo livre, camadas e permissões
- Workflow "Testes" roda a cada push e pull request; a release só é empacotada se todos passarem
- Documentação em `docs/dev/` (testes, armazenamento, segurança, permissões e matriz de navegadores)

**Migrações de dados** (#2)
- Versão do esquema em `nt_meta`; migrações sequenciais, idempotentes, gravadas de uma vez e com cópia de segurança do estado anterior
- Primeira migração: notas e tarefas antigas ganham os campos obrigatórios (tags, tipo, datas) — corrige travamentos com dados de versões antigas; clima e widgets da v0.3 convertidos
- Backups de versão mais nova são recusados com mensagem clara; os antigos são normalizados ao importar

**Permissões** (#3)
- Cotações, endereços do Trânsito e fotos do Bing/NASA deixam de ser pedidos na instalação: o acesso é pedido só quando você usa o recurso
- Novo painel **Configurações → Geral → Permissões**: o que cada acesso faz, com botões Permitir/Remover, e a lista de sites liberados individualmente
- Teste automático garante que o manifest e o mapa de permissões batem

**Chaves de API** (#4)
- Mensagens de erro dos provedores nunca mostram a chave (nem trechos dela)
- Botão 🗑 para apagar a chave salva de um provedor
- Documento `docs/dev/SEGURANCA.md` com o caminho da chave e os limites de proteção

## v0.5.7 — 2026-11-09
**Voz mais útil, colar imagens e permissões mais enxutas.**

**Voz** (#36)
- "O que eu tenho que fazer?", "o que tenho pra hoje", "quais são minhas pendências" (e equivalentes em inglês e espanhol) agora leem suas tarefas: atrasadas, de hoje e algumas sem data, em vez de irem para a IA
- Respostas longas da IA ficam numa caixa com rolagem, com listas e negrito formatados (sem asteriscos), e só fecham quando você fecha
- Corrigido erro "Cannot read properties of undefined (reading 'join')" ao perguntar à IA quando alguma nota não tinha tags

**Captura rápida** (#34)
- Cole uma imagem com **Ctrl+V**: aparece uma prévia para salvar na Biblioteca de imagens ou cancelar
- Se a área de transferência tiver texto e imagem, o texto é colado normalmente e a imagem vai para a prévia
- Validação de tipo e de tamanho (até 12 MB) e proteção contra colagem duplicada

**Biblioteca de imagens e permissões**
- Removida a permissão opcional `http://*/*`: só imagens de endereços `https://` (ou embutidas na página) podem ser salvas pelo menu; para as outras, a dica é copiar e colar na Captura rápida
- Se o navegador não aceitar o pedido de permissão direto do menu, abre uma janelinha para autorizar o site com um clique
- Código da biblioteca centralizado em `src/lib/captures.js`, usado pelo menu, pela Captura rápida e pelo widget
- Biblioteca e janela de permissão traduzidas para inglês e espanhol

## v0.5.6 — 2026-11-08
**Correção da hierarquia visual.**

- Isolado o contexto de empilhamento do conteúdo principal para impedir que widgets em modo livre ultrapassem overlays e painéis globais.
- Mantida a prioridade visual do assistente de voz, dock e notificações sobre os widgets.

## v0.5.2 — 2026-11-06
**Correção da captura de imagens.**

- Corrigida a solicitação de permissão do domínio: agora ocorre diretamente no clique do menu de contexto, preservando o gesto do usuário exigido pelo Manifest V3.
- A captura agora mostra um indicador de sucesso ou falha no ícone da extensão; ao passar o mouse, o título informa o resultado.
- Mantidas as imagens e os dados existentes na biblioteca.

## v0.5.1 — 2026-11-06
**Biblioteca visual e captura de imagens.**

- Novo comando no menu de contexto: salvar imagens diretamente na biblioteca da NeuroTab.
- Nova área/widget **Biblioteca de imagens**, com pré-visualização, data, tamanho e origem.
- Imagens armazenadas localmente no IndexedDB do navegador.
- Permissão de acesso ao domínio da imagem solicitada sob demanda (HTTP/HTTPS).
- Validação do conteúdo e limite de 12 MB por imagem.
- Exclusão de imagens salvas e liberação dos recursos temporários de visualização.
- Banco IndexedDB atualizado para a versão 3, preservando os dados existentes.

**Teste:** esta versão é destinada à avaliação funcional da captura e da biblioteca visual. Ainda é necessário validar o comportamento em Chrome, Edge e Firefox.


## v0.5.0 — 2026-11-05
**Mais inteligente e fala sua língua.**

**Busca por significado**
- Notas viram vetores (embeddings) gerados pelo seu provedor de IA: Gemini (`gemini-embedding-001`), OpenAI e OpenRouter (`text-embedding-3-small`), Ollama (`nomic-embed-text`) ou outro compatível
- Busca híbrida (palavras + significado) no widget Meu cérebro e no Ctrl+K; resultados achados pelo sentido ganham ✨
- "Pergunte ao cérebro" escolhe as notas de contexto pelo significado; com Anthropic (sem embeddings), a própria IA escolhe as notas
- Índice no IndexedDB, atualizado sozinho ao abrir uma nova aba; botões "Indexar minhas notas" e "Refazer índice"
- Desligada por padrão (Configurações → IA e voz)

**Voz**
- Comandos de voz em **inglês e espanhol**, além do português, com respostas faladas no mesmo idioma
- Lembretes e durações entendem datas e números nos três idiomas ("tomorrow at 9am", "mañana a las 9", "ten minutes")
- Conversões aceitam nomes de unidades em inglês e espanhol ("10 km to miles")
- Plano B com IA: frases fora do padrão são interpretadas pela IA e executadas
- **Palavra de ativação** (experimental, desligada por padrão): "NeuroTab, …" sem apertar nada; escuta só com a nova aba visível e em foco, desliga sozinha após 5–60 min sem uso, indicador na tela para pausar

**Backup**
- Opção "Incluir chaves de API da IA", com aviso
- Senha opcional: as chaves são criptografadas (AES-256-GCM, PBKDF2) dentro do arquivo; sem a senha, o resto do backup é restaurado sem as chaves

## v0.4.0 — 2026-11-05
**O mundo na sua nova aba.**

**Relógio e clima**
- O clima agora fica ao lado da saudação (sem widget separado); clique para ver a previsão de 5 dias
- Várias cidades: cada uma mostra hora local, diferença de fuso e temperatura; reordene e escolha a principal
- O antigo ajuste de cidade do clima é migrado automaticamente

**Novos widgets**
- 🗺 **Trânsito**: mapa do Waze, locais favoritos com ícone (casa, trabalho…) buscados por endereço, rotas salvas que abrem no Google Maps ou no Waze (carro, transporte, a pé, bicicleta); comando de voz "rota para o trabalho"
- 🖼 **Fotos**: miniatura do slide atual; o fundo pode virar **slides** com fotos do PC (guardadas no navegador), foto do dia do Bing ou da NASA
- ✅ **Hábitos**: metas diárias, sequência de dias e semana em pontinhos
- 📰 **Notícias**: feeds RSS/Atom com sugestões (g1, BBC Brasil, Agência Brasil, Tecnoblog…)
- 🎯 **Foco do dia**: uma tarefa principal que reinicia a cada dia

**Idiomas**
- Extensão em português, inglês e espanhol, conforme o idioma do navegador (Configurações → Geral → Idioma)
- A IA responde no idioma escolhido; datas e números seguem o formato local
- Site do projeto também traduzido, com seletor PT/EN/ES
- Comandos de voz continuam só em português

**Firefox e lojas**
- Pacote para Firefox 128+ gerado automaticamente (`neurotab-firefox.zip`)
- Política de privacidade, textos, capturas e guia para publicar no Edge, Firefox, Opera e Chrome (`docs/store`)

## v0.3.1 — 2026-11-05
- **Modo livre**: widgets podem ser colocados em qualquer lugar da tela (arraste pelo título), com sobreposição e camadas
- Encaixe magnético nas bordas de outros widgets e no centro da tela, com guias visuais (Alt desliga o encaixe)
- Relógio e busca também podem ser movidos e redimensionados no modo 🧩
- Ao ativar o modo livre, a posição atual da grade é preservada; "🧲 Reorganizar" refaz a grade
- Layouts salvos guardam o modo e as posições
- Em janelas estreitas (< 700 px) volta automaticamente à grade

## v0.3.0 — 2026-11-05
**Organização e voz.**

**Layout**
- Widgets **redimensionáveis**: puxe o canto ↘ (largura em colunas, altura livre; duplo clique volta à altura automática)
- **Responsivo**: 12, 6 ou 1 coluna conforme a largura; em janelas estreitas a barra de atalhos vai para o rodapé
- **Layouts salvos** (ex.: Trabalho, Casa) no modo 🧩

**Novos widgets**
- ⏱ **Relógio**: despertador (dias da semana, soneca, 5 sons), timer, pomodoro e cronômetro — com notificação e som
- 🧮 **Calculadora**: porcentagem ("200 + 10%", "15% de 200"), conversões de moedas, medidas, temperatura e datas; histórico; calculadoras de saúde opcionais (IMC, TMB/GET, água)
- 🕘 **Navegação**: sites mais visitados e abas fechadas recentemente (permissão pedida só ao usar)

**Notas e tarefas**
- **Lixeira de 30 dias** (filtro 🗑): restaurar, apagar de vez, esvaziar
- **Seleção múltipla**: concluir, adicionar tag, exportar .md ou excluir vários de uma vez
- 🧹 **Limpar concluídas** no widget de lembretes; limpeza geral nas configurações

**Voz**
- **Comandos de voz** com **Alt+Shift+V** em qualquer aba (ou Alt+M / botão 🎙 na nova aba): anotar, lembretes, timer, pomodoro, despertador, abrir atalhos, pesquisar, horas, clima, cotações, tarefas do dia, contas — e perguntas à IA
- **Escolha da voz** de leitura, velocidade e tom

**Outros**
- 🔔 **Aviso de atualização** (consulta o GitHub) e janela de **novidades** após atualizar
- Busca Ctrl+K calcula na hora ("2^10 + 5", "100 usd em brl")

## v0.2.0 — 2026-11-04
O centro da nova aba virou um **segundo cérebro**.

**Novo layout**
- Atalhos numa barra de grupos (esquerda, direita, topo ou rodapé); os atalhos abrem num painel ao passar o mouse ou clicar
- 📌 Fixar o painel aberto (posições laterais)
- Centro com relógio, saudação e **widgets** que você escolhe, reordena (arrastar) e redimensiona (P/M/G) pelo botão 🧩
- Busca universal **Ctrl+K**: atalhos, notas, web, perguntar à IA e Shift+Enter para salvar como nota

**Widgets**
- ⚡ Captura rápida (texto ou voz) com detecção de lembretes em português ("me lembre amanhã às 9h…")
- 🧠 Meu cérebro: notas, trechos, páginas, tarefas e ideias, com busca, filtros, tags e fixados
- ⏰ Lembretes e tarefas: atrasados, hoje, próximos
- 🤖 Pergunte ao seu cérebro: chat com as notas, com citações; ditado e leitura em voz alta
- 🌤️ Clima (Open-Meteo) · 📈 Cotações (moedas, cripto e B3) · 🔲 Atalhos em blocos

**Captura em qualquer página**
- Ícone da extensão abre um painel para anotar a página (com o texto selecionado já citado), salvar para ler depois e adicionar aos atalhos (atalho: Alt+Shift+N)
- Botão direito → NeuroTab → salvar trecho, página ou link no cérebro

**IA (opcional, com a sua chave)**
- Google Gemini (padrão), OpenAI, Anthropic, OpenRouter, Ollama (local) e qualquer API compatível com OpenAI
- Organiza automaticamente: título, resumo, tags, tipo e lembrete
- Chaves ficam só no navegador e não entram no backup

**Lembretes**
- Notificações do sistema com "Concluir" e "Adiar 10 min"; lembretes perdidos avisam ao abrir o navegador

**Integrações**
- Importar notas do Google Keep (via Google Takeout)
- Exportar notas em Markdown (Obsidian, Notion, Logseq…)
- Backup agora inclui as notas

**Apoie**
- Pix com QR Code e "copia e cola" gerados na extensão
- Página do projeto em GitHub Pages (`docs/`)

## v0.1.0 — 2026-11-02
Primeira versão: Speed Dial com grupos, blocos coloridos, plano de fundo, arrastar e soltar, menu do botão direito e importação do backup `.spd`.
