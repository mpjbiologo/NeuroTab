# Changelog

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
