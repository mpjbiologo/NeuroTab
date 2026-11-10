# Changelog

## v0.6.2 — (a lançar junto com a aprovação do Firefox)
**Salvar imagens de qualquer site e novos jeitos de apoiar.**

- Biblioteca de imagens: "Salvar imagem na biblioteca" agora funciona com imagens que só abrem logado (ChatGPT, Gemini, Google Fotos, Drive, webmail…), endereços `blob:` e `http:`, sites que bloqueiam cópia (hotlink) e servidores que não informam o tipo da imagem. Quando o download direto não dá, a NeuroTab pega a imagem de dentro da própria página (seu login não sai do navegador) e, em último caso, recorta a imagem da parte visível da tela
- Biblioteca de imagens: o tipo da imagem é descoberto pelos primeiros bytes (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG)
- Mensagens de erro com a dica de copiar e colar quando o site não deixa extensões lerem a página
- Apoie: nova chave Pix, Ko-fi e PayPal
- Release: envio automático para as lojas do Edge e do Chrome (e conferência das credenciais sem publicar)

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
