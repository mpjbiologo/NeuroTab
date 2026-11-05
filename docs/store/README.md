# Publicar a NeuroTab nas lojas

Material pronto nesta pasta:

| Arquivo | Uso |
|---|---|
| `screenshot-1/2/3-{pt,en,es}.png` | Capturas 1280×800 (todas as lojas) |
| `promo-small-440x280.png` | Bloco promocional pequeno (Chrome / Edge) |
| `promo-marquee-1400x560.png` | Banner grande (opcional) |
| `../icon.png` | Ícone 128×128 |
| Política de privacidade | https://mpjbiologo.github.io/NeuroTab/privacy.html |

Pacotes (gerados por `./scripts/build.sh` ou baixados da release no GitHub):
- `neurotab.zip`: Edge, Chrome, Opera, Brave
- `neurotab-firefox.zip`: Firefox

---

## 1. Microsoft Edge Add-ons (gratuito, recomendado primeiro)

1. Acesse https://partner.microsoft.com/dashboard/microsoftedge e entre com uma conta Microsoft.
2. Cadastre-se como desenvolvedor (individual; sem custo).
3. **Create new extension** → envie `neurotab.zip`.
4. **Availability**: Public, todos os mercados.
5. **Properties**: categoria *Productivity*; URL da política de privacidade (acima); site `https://mpjbiologo.github.io/NeuroTab/`; suporte `https://github.com/mpjbiologo/NeuroTab/issues`.
6. **Store listings**: adicione Português (Brasil), English e Español com os textos abaixo, as capturas do idioma e o bloco 440×280.
7. **Submit**. A revisão costuma levar de 1 a 7 dias úteis.

## 2. Firefox Add-ons (AMO, gratuito)

1. Acesse https://addons.mozilla.org/developers/ e entre com uma conta Firefox.
2. **Submit a New Add-on** → *On this site* → envie `neurotab-firefox.zip`.
3. A AMO pede o **código-fonte** quando há código minificado. A NeuroTab não é minificada, então responda "No". Se pedirem mesmo assim, envie o zip do repositório.
4. Preencha nome, resumo e descrição (abaixo), categoria *Tabs* ou *Productivity*, licença MIT e a URL de privacidade.
5. A versão automática sai em minutos; a revisão humana pode levar alguns dias.

## 3. Opera Add-ons (gratuito)

1. https://addons.opera.com/developer/ → *Upload new extension* → envie `neurotab.zip`.
2. Mesmos textos e capturas. A revisão é manual e pode demorar algumas semanas.

## 4. Chrome Web Store (opcional, taxa única de US$ 5)

1. https://chrome.google.com/webstore/devconsole → pague a taxa de registro.
2. **New item** → envie `neurotab.zip`.
3. Aba **Privacy**: preencha as justificativas de permissão (abaixo), marque que **não** coleta dados de usuário e informe a URL da política.
4. **Store listing**: textos, capturas, bloco 440×280 e banner 1400×560.

> Depois de publicada, a loja atualiza a extensão sozinha. O aviso de atualização via GitHub continua útil para quem instalou pelo zip.

---

## Textos da listagem

### Português (Brasil)

**Nome:** NeuroTab — nova aba com segundo cérebro

**Resumo (até 132 caracteres):**
Atalhos, notas, lembretes, IA, clima, trânsito e voz numa nova aba bonita e privada. Sucessora moderna do Speed Dial.

**Descrição:**
A NeuroTab troca a nova aba do navegador por um painel pessoal: seus atalhos numa barra lateral e, no centro, um "segundo cérebro" com o que importa no seu dia.

• Atalhos em grupos, com importação do backup do Speed Dial (.spd)
• Notas, ideias e tarefas com busca, tags e lixeira de 30 dias; importação do Google Keep e exportação em Markdown
• Lembretes com linguagem natural ("amanhã às 9h") e notificações
• IA opcional (Gemini, OpenAI, Claude, OpenRouter ou Ollama local): organiza notas e responde perguntas sobre elas
• Comandos de voz em português, inglês e espanhol, palavra de ativação opcional e leitura em voz alta
• Busca por significado: encontra notas pelo sentido, não só pelas palavras
• Relógio e clima juntos, com outras cidades e fusos horários
• Trânsito com seus locais e rotas favoritas (Waze e Google Maps)
• Widgets: cotações, despertador, timer, pomodoro, calculadora, hábitos, notícias RSS, foco do dia, slides de fotos
• Widgets redimensionáveis, em grade ou soltos em qualquer lugar da tela
• Em português, inglês e espanhol

Privacidade: sem conta, sem servidor, sem analytics. Seus dados ficam no navegador. Código aberto no GitHub.

### English

**Name:** NeuroTab — new tab with a second brain

**Summary:**
Shortcuts, notes, reminders, AI, weather, traffic and voice in a beautiful, private new tab. A modern Speed Dial successor.

**Description:**
NeuroTab replaces your browser's new tab with a personal dashboard: shortcuts in a side bar and, in the center, a "second brain" with what matters in your day.

• Grouped shortcuts, with import from Speed Dial backups (.spd)
• Notes, ideas and tasks with search, tags and a 30-day trash; Google Keep import and Markdown export
• Reminders with notifications
• Optional AI (Gemini, OpenAI, Claude, OpenRouter or local Ollama): organizes notes and answers questions about them
• Voice commands in English, Portuguese and Spanish, an optional wake word, and read-aloud
• Search by meaning: find notes by what they mean, not just the words
• Clock and weather together, with other cities and time zones
• Traffic with your favorite places and routes (Waze and Google Maps)
• Widgets: quotes, alarm, timer, pomodoro, calculator, habits, RSS news, daily focus, photo slideshow
• Resizable widgets, in a grid or placed anywhere on the screen
• In English, Portuguese and Spanish

Privacy: no account, no server, no analytics. Your data stays in your browser. Open source on GitHub.

### Español

**Nombre:** NeuroTab — nueva pestaña con segundo cerebro

**Resumen:**
Accesos directos, notas, recordatorios, IA, clima, tráfico y voz en una nueva pestaña bonita y privada. Sucesora de Speed Dial.

**Descripción:**
NeuroTab cambia la nueva pestaña del navegador por un panel personal: tus accesos directos en una barra lateral y, en el centro, un "segundo cerebro" con lo importante de tu día.

• Accesos directos en grupos, con importación de copias de Speed Dial (.spd)
• Notas, ideas y tareas con búsqueda, etiquetas y papelera de 30 días; importación de Google Keep y exportación en Markdown
• Recordatorios y notificaciones
• IA opcional (Gemini, OpenAI, Claude, OpenRouter u Ollama local): organiza notas y responde preguntas sobre ellas
• Comandos de voz en español, portugués e inglés, palabra de activación opcional y lectura en voz alta
• Búsqueda por significado: encuentra notas por su sentido, no solo por las palabras
• Reloj y clima juntos, con otras ciudades y husos horarios
• Tráfico con tus lugares y rutas favoritas (Waze y Google Maps)
• Widgets: cotizaciones, alarma, temporizador, pomodoro, calculadora, hábitos, noticias RSS, foco del día, presentación de fotos
• Widgets redimensionables, en cuadrícula o en cualquier lugar de la pantalla
• En español, portugués e inglés

Privacidad: sin cuenta, sin servidor, sin analítica. Tus datos se quedan en el navegador. Código abierto en GitHub.

---

## Justificativas de permissão (Chrome / Edge, em inglês)

**Single purpose:** Replaces the new tab page with a personal dashboard of shortcuts, notes, reminders and widgets.

| Permission | Justification |
|---|---|
| storage, unlimitedStorage | Stores the user's shortcuts, notes, tasks, settings and background photos locally. |
| contextMenus | "Save to NeuroTab" right-click menu for selected text, links and pages. |
| activeTab, scripting | Reads the title, URL and selected text of the current tab when the user saves it from the popup or menu. |
| favicon | Shows site icons for shortcuts. |
| alarms | Fires reminders, alarms, timers and pomodoro, and the periodic update check. |
| notifications | Shows reminder, alarm and timer notifications. |
| offscreen | Plays the alarm/timer sound from the background. |
| topSites, sessions, tabs (optional) | "Browsing" widget: most-visited sites and recently closed tabs. Requested only when the user enables the widget. |
| Host: open-meteo.com | Weather and city search. |
| Host: awesomeapi.com.br, brapi.dev | Currency and stock quotes widget. |
| Host: nominatim.openstreetmap.org | Address search for saved places in the traffic widget. |
| Host: bing.com, api.nasa.gov | Photo-of-the-day background slideshow. |
| Host: api.github.com | Checks GitHub for new releases. |
| Optional hosts (AI providers, https://*/*) | Requested only when the user configures an AI provider or adds an RSS feed. |

**Remote code:** No. All code is included in the package.

**Data usage:** The extension does not collect or transmit user data to the developer. User content is sent only to third-party services the user explicitly configures (e.g., their own AI provider key).
