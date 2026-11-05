<p align="center">
  <img src="icons/icon128.png" width="96" alt="NeuroTab">
</p>

<h1 align="center">NeuroTab</h1>

<p align="center">
  <b>A nova aba que pensa com você.</b><br>
  Atalhos numa barra lateral e, no centro, um segundo cérebro com notas, lembretes, clima, cotações e IA.<br>
  Para Edge, Chrome e Firefox, em português, inglês e espanhol. Gratuita, de código aberto, sem anúncios e sem rastreamento.
</p>

<p align="center">
  <a href="https://mpjbiologo.github.io/NeuroTab/"><b>🌐 Site do projeto</b></a> ·
  <a href="https://github.com/mpjbiologo/NeuroTab/releases/latest"><b>⬇ Baixar</b></a> ·
  <a href="#-apoie-o-projeto"><b>❤ Apoiar</b></a>
</p>

<p align="center">
  <a href="https://github.com/mpjbiologo/NeuroTab/releases/latest"><img src="https://img.shields.io/github/v/release/mpjbiologo/NeuroTab?label=vers%C3%A3o&color=7c5cff" alt="Versão"></a>
  <img src="https://img.shields.io/badge/Manifest-V3-6f42c1" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Edge%20%7C%20Chrome%20%7C%20Firefox-suportados-2ea44f" alt="Edge, Chrome e Firefox">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-lightgrey" alt="MIT"></a>
</p>

![Nova aba da NeuroTab](docs/shot-home.jpg)

A NeuroTab começou como substituta da extensão **Speed Dial**, que parou de ser atualizada em 2022, e importa o backup dela com tudo dentro. Na v0.2, o centro da tela virou um **segundo cérebro**: um lugar para capturar, lembrar e encontrar o que importa.

## ✨ Recursos

| | |
|---|---|
| 🗂️ **Barra de atalhos** | Grupos com emoji à esquerda, à direita, no topo ou no rodapé. Os atalhos abrem num painel ao passar o mouse. Dá para fixar o painel, arrastar e soltar, e as cores são automáticas |
| ⚡ **Captura rápida** | Anote digitando ou falando. Uma frase como *"me lembre amanhã às 9h de ligar para o banco"* vira lembrete sozinha |
| 🧠 **Meu cérebro** | Notas, trechos, páginas, tarefas e ideias, com busca, filtros, tags e itens fixados |
| ⏰ **Lembretes** | Notificações do sistema com os botões *Concluir* e *Adiar 10 min* |
| 🤖 **Pergunte ao seu cérebro** | Chat com a IA sobre o que você salvou, com citações das fontes. Também funciona por voz |
| ✂️ **Anotar páginas** | O ícone da extensão (ou **Alt+Shift+N**) abre um painel para anotar a página. O botão direito salva trechos, páginas e links |
| 🔎 **Ctrl+K** | Uma busca só para atalhos, notas, web e perguntas à IA. **Shift+Enter** salva o texto como nota |
| ⏱ **Relógio** | Despertador com dias da semana e soneca, timer, pomodoro e cronômetro, com som e notificação |
| 🧮 **Calculadora** | Contas, porcentagem ("200 + 10%"), conversões (moedas, medidas, temperatura, datas) e calculadoras de saúde opcionais |
| 🎙 **Comandos de voz** | **Alt+Shift+V** em qualquer aba: "anotar…", "me lembre amanhã às 9h…", "timer de 10 minutos", "abrir YouTube", "como está o tempo" |
| 🌤 **Relógio e clima juntos** | O tempo fica ao lado da saudação, com previsão de 5 dias. Adicione outras cidades para ver a hora e o clima de cada fuso |
| 🗺 **Trânsito** | Mapa do Waze, seus locais favoritos (casa, trabalho…) e rotas salvas que abrem no Google Maps ou no Waze |
| 🖼 **Slides de fotos** | Fundo com fotos do seu PC, a foto do dia do Bing ou da NASA |
| ✅ **Hábitos, notícias e foco** | Hábitos com sequência de dias, feeds RSS e a tarefa principal do dia |
| 🌐 **Idiomas** | Português, inglês e espanhol, conforme o idioma do navegador (dá para trocar nas configurações). Os comandos de voz ainda são só em português |
| 🗑 **Lixeira e limpeza** | Seleção múltipla, limpar concluídas, lixeira de 30 dias |
| 📈🕘 **Mais widgets** | Clima, cotações, mais visitados e abas fechadas, atalhos em blocos. Arraste o canto ↘ para redimensionar e salve layouts com o 🧩. No **modo livre**, os widgets ficam em qualquer lugar da tela |
| 🔁 **Importar e exportar** | Importa o Speed Dial (`.spd`) e o Google Keep (via Takeout). Exporta as notas em Markdown e faz backup completo em `.json` |

<p align="center"><img src="docs/shot-panel.jpg" width="49%" alt="Painel de atalhos"> <img src="docs/shot-voice.jpg" width="49%" alt="Comando de voz"></p>

### 🤖 IA: use a que preferir
A IA é **opcional**. Ela organiza as notas (título, resumo, tags e lembrete) e responde perguntas sobre elas. Você usa a **sua chave**, e as chamadas vão direto do seu navegador para o provedor escolhido:

- **Google Gemini** (padrão, tem camada gratuita). Para obter uma chave: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- **OpenAI** (ChatGPT) · **Anthropic** (Claude) · **OpenRouter** (centenas de modelos)
- **Ollama**, que roda no seu computador, offline e sem chave. Inicie com `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`
- Qualquer API compatível com OpenAI: LM Studio, Groq, Mistral, DeepSeek…

Para configurar, abra **⚙ Configurações → IA e voz**, escolha o provedor, cole a chave e clique em **Salvar e testar**.

## 📥 Instalação

1. Baixe o `neurotab.zip` da [última versão](https://github.com/mpjbiologo/NeuroTab/releases/latest) e descompacte numa pasta fixa.
2. Abra `edge://extensions` (ou `chrome://extensions`).
3. Ative o **Modo de desenvolvedor** e clique em **Carregar sem pacote**. Escolha a pasta.
4. Abra uma nova aba. O Edge pergunta se você quer manter a alteração: clique em **Manter alterações**.

### Firefox
Baixe o `neurotab-firefox.zip`. Para testar, abra `about:debugging#/runtime/this-firefox` → **Carregar extensão temporária** e escolha o zip (ela some ao fechar o Firefox). Para uso permanente, instale pela loja de complementos do Firefox quando a NeuroTab for publicada lá. Requer Firefox 128 ou mais novo.

Para **atualizar**: a NeuroTab avisa quando sai versão nova. Baixe o zip, substitua os arquivos na mesma pasta e clique em ↻ na página de extensões. Seus dados são mantidos.

> **Despertador e timer** tocam com o navegador aberto e o computador ligado — a extensão não consegue acordar o PC.

### Vindo do Speed Dial?
No Speed Dial antigo, vá em **Settings → Import/Export** e exporte o `.spd`. Na NeuroTab, vá em **Configurações → Backup** e escolha esse arquivo.

### Notas do Google Keep
O Google só libera a API do Keep para contas empresariais (Workspace). Para contas pessoais:
1. Em [takeout.google.com](https://takeout.google.com/), exporte só o **Keep**.
2. Na NeuroTab, abra **Configurações → Notas e integrações** e escolha a pasta `Takeout/Keep`.

## 🗺 Roteiro

| Versão | O que vem |
|---|---|
| **v0.1** ✅ | Speed Dial completo e importação do `.spd` |
| **v0.2** ✅ | Segundo cérebro: widgets, captura, lembretes, IA multi-provedor, voz, Keep, anotar páginas |
| **v0.3** ✅ | Widgets redimensionáveis e responsivos, relógio/despertador, calculadora, navegação, lixeira, comandos de voz, aviso de atualização |
| **v0.4** ✅ | Relógio + clima com várias cidades e fusos, trânsito com locais e rotas, slides de fotos, hábitos, notícias RSS, foco do dia, tradução (pt/en/es), versão para Firefox, material para as lojas |
| **v0.5** | Agenda, Google Fotos e OneDrive, comandos de voz em outros idiomas, palavra de ativação, sincronização, busca por significado |
| — | Publicação nas lojas do Edge, Firefox, Opera e Chrome ([guia](docs/store/README.md)) |

Ideias são bem-vindas nas [Issues](https://github.com/mpjbiologo/NeuroTab/issues).

## 🔒 Privacidade

Tudo fica **no seu navegador**. A NeuroTab não tem servidor, não pede conta e não coleta dados. A chave da IA fica só no navegador e **não entra no backup**. Detalhes na [política de privacidade](https://mpjbiologo.github.io/NeuroTab/privacy.html).

| Permissão | Para quê |
|---|---|
| `storage`, `unlimitedStorage` | Guardar atalhos, notas e fundo |
| `contextMenus` | Mostrar o menu "NeuroTab" no botão direito |
| `activeTab`, `scripting` | Ler o título e o texto selecionado da página quando **você** clica no ícone |
| `alarms`, `notifications` | Disparar lembretes, despertadores e timers |
| `offscreen` | Tocar o som do despertador e do timer |
| `topSites`, `sessions`, `tabs` *(opcionais)* | Widget Navegação — pedidas só se você usar o widget |
| GitHub API | Verificar se há versão nova |
| `favicon` | Mostrar os ícones dos sites |
| Open-Meteo, AwesomeAPI, brapi.dev | Buscar clima, cidades e cotações |
| OpenStreetMap Nominatim | Buscar endereços dos locais do widget Trânsito |
| Bing, NASA | Fotos do dia nos slides de fundo |
| Feeds RSS *(opcionais)* | Pedida para cada site de notícias que você adicionar |
| DuckDuckGo *(só no Firefox)* | Ícones dos sites, já que o Firefox não tem a API de favicons |
| Provedor de IA *(opcional)* | Pedida só quando você configura a IA |

## ❤ Apoie o projeto

A NeuroTab é feita nas horas vagas e vai continuar gratuita. Se ela é útil para você:

<img src="docs/pix.svg" width="160" align="right" alt="QR Code Pix">

- **Pix:** `prof.marcosbiologo@hotmail.com`. O QR Code ao lado também funciona, assim como a aba **❤ Apoie** nas configurações
- ⭐ Dê uma estrela no repositório
- 🐛 [Sugira ideias ou relate problemas](https://github.com/mpjbiologo/NeuroTab/issues)

<br clear="right">

## 🛠 Desenvolvimento

O projeto não tem etapa de build: é HTML, CSS e JavaScript puros (módulos ES).

```
manifest.json            Manifest V3
src/newtab.*             Nova aba (barra de atalhos, busca, widgets)
src/widgets/             Um arquivo por widget, registrados em index.js
src/popup.*              Painel do ícone (anotar página)
src/options.*            Configurações
src/background.js        Menus, lembretes (alarms) e notificações
src/lib/store.js         Atalhos, configurações, importação do .spd
src/lib/brain.js         Notas, busca, lembretes em PT-BR, Keep, Markdown
src/lib/ai.js            Provedores de IA (Gemini, OpenAI, Anthropic, OpenRouter, Ollama…)
src/lib/pix.js           Pix copia e cola + QR Code
src/config.js            Links do projeto e dados do Pix
docs/                    Site do projeto (GitHub Pages)
```

**Para criar um widget:** copie um arquivo de `src/widgets/`, exporte `{ id, title, icon, description, mount(el, ctx) }` e registre-o em `src/widgets/index.js`.

**Para lançar uma versão:**
1. Atualize `version` no `manifest.json` e o `CHANGELOG.md`.
2. No GitHub, abra **Releases → Draft a new release**, crie a tag `vX.Y.Z` e publique.

O Actions anexa o `neurotab.zip` à release automaticamente.

## 📄 Licença

[MIT](LICENSE) © Marcos de Paula Júnior

*A NeuroTab é um projeto independente. Ela não tem relação com os autores da extensão "Speed Dial" nem usa código dela: apenas lê o formato de backup para facilitar a migração. O gerador de QR Code é de Kazuhiko Arase (MIT).*
