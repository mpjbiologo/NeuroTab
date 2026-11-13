# Permissões

A fonte da verdade é `src/lib/permissions.js`; o teste `tests/unit/permissions.test.js` falha se o `manifest.json` tiver um acesso sem recurso correspondente (ou o contrário). Na extensão, tudo isso aparece em **Configurações → Geral → Permissões**, com botão para permitir ou remover.

## Permissões de API

| Permissão | Para quê |
|---|---|
| `storage`, `unlimitedStorage` | Guardar atalhos, notas e configurações no navegador |
| `contextMenus` | Menu "NeuroTab" do botão direito (salvar trecho, página, link e imagem) |
| `activeTab`, `scripting` | Ler o título e o texto selecionado da aba atual quando você usa o popup ou o menu; no "Salvar imagem na biblioteca", ler a imagem de dentro da página (login, `blob:`) ou recortá-la de uma captura da parte visível da aba. Só no clique |
| `favicon` (só Chromium) | Ícones dos atalhos |
| `alarms`, `notifications` | Lembretes, despertador, timer e pomodoro |
| `offscreen` (só Chromium) | Tocar o som do alarme em segundo plano |
| `topSites`, `sessions`, `tabs` (opcionais) | Widget "Navegação": mais visitados e abas fechadas; pedidas ao adicionar o widget |

## Acesso a sites

| Recurso | Sites | Quando é pedido |
|---|---|---|
| Clima e fusos horários | `api.open-meteo.com`, `geocoding-api.open-meteo.com` | Sempre (instalação) |
| Aviso de versão nova | `api.github.com` | Sempre (não é usado em instalações pela loja) |
| Cotações e conversão de moedas | `economia.awesomeapi.com.br`, `brapi.dev` | Botão "Permitir" no widget Cotações |
| Endereços do widget Trânsito | `nominatim.openstreetmap.org` | Ao buscar um endereço |
| Distância e tempo pela rua | `routing.openstreetmap.de` | Ao clicar em "🛣 Tempo pela rua" numa resposta do "Pergunte ao seu cérebro" |
| Fotos do dia nos slides | `www.bing.com`, `api.nasa.gov` | Ao escolher Bing ou NASA como origem das fotos |
| Provedores de IA | Gemini, OpenAI, Anthropic, OpenRouter | Ao salvar o provedor em IA e voz |
| IA local | `localhost`, `127.0.0.1` | Ao configurar Ollama/LM Studio |
| Outros sites | `https://*/*` (opcional, um site por vez) | Ao adicionar um feed, salvar uma imagem pelo menu ou usar IA com endereço próprio |

Não há acesso obrigatório a "todos os sites" nem a endereços `http://` (exceto o computador local, para IA local).

## Diferenças entre navegadores

- **Firefox** não tem `favicon` nem `offscreen`: os ícones vêm do DuckDuckGo (`icons.duckduckgo.com`, acesso extra só no pacote do Firefox) e o som toca na página de fundo. O pacote é gerado por `scripts/firefox-manifest.mjs`.
- **Consentimento de dados (Firefox 140+):** o pacote do Firefox declara `required: ["none"]` e `optional: ["locationInfo", "websiteContent"]`. A localização é pedida ao adicionar uma cidade ou buscar um endereço; o envio de conteúdo à IA, ao salvar o provedor. Sem consentimento, o clima não é buscado e a IA não é chamada. No Chromium esse consentimento não existe e as verificações sempre passam.
- Recusar uma permissão desliga só aquele recurso; o resto continua funcionando.
