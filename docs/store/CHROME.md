# Publicar a NeuroTab na Chrome Web Store: passo a passo

Preencher leva de 30 a 40 minutos. A revisão do Google costuma levar de alguns dias a 3 semanas. Como a extensão pede acesso opcional a `https://*/*`, ela pode cair em revisão detalhada e demorar mais.

## Antes de começar

Arquivos (todos em `chrome-assets.zip`):

| Arquivo | Onde vai | Obrigatório? |
|---|---|---|
| `neurotab.zip` | Pacote (não descompacte). É **o mesmo pacote 0.6.1 enviado ao Edge** | Sim |
| `icon-128.png` | Store listing → *Store icon* (128×128) | Sim |
| `screenshot-1/2/3-pt.png` (e `-en`, `-es`) | Store listing → *Screenshots* (1280×800) | Pelo menos 1 |
| `promo-small-440x280.png` | Store listing → *Small promo tile* | Sim |
| `promo-marquee-1400x560.png` | Store listing → *Marquee promo tile* | Não |

Política de privacidade: https://mpjbiologo.github.io/NeuroTab/privacy.html

## 1. Criar a conta de desenvolvedor (taxa única de US$ 5)

1. Acesse https://chrome.google.com/webstore/devconsole e entre com a sua conta Google.
2. Aceite o contrato de desenvolvedor e pague a **taxa de registro de US$ 5** (cartão; é paga uma vez só).
3. Em **Account**:
   - **Publisher name:** `Marcos de Paula Júnior` (ou `mpjbiologo`).
   - **Contact email:** um e-mail seu. O Google manda um link de confirmação, e **sem confirmar não dá para publicar**.
   - Se aparecer **Trader / Non-trader** (exigência da União Europeia): marque **Non-trader**, porque a extensão é gratuita e você não a vende como empresa.
   - **Save changes**.

## 2. Enviar o pacote

1. **Items → + New item**.
2. Arraste o **`neurotab.zip`**. O painel lê nome, versão (0.6.1) e permissões e abre o rascunho.

## 3. Aba "Store listing"

| Campo | O que colocar |
|---|---|
| Description | O texto "Descrição" de `docs/store/README.md` (o mesmo usado no Edge) |
| Category | **Productivity** → **Tools** (se pedir subcategoria; se não, só *Productivity*) |
| Language | **Portuguese (Brazil)** |
| Store icon | `icon-128.png` |
| Global promo video | em branco |
| Screenshots | `screenshot-1-pt.png`, `screenshot-2-pt.png`, `screenshot-3-pt.png` |
| Small promo tile | `promo-small-440x280.png` |
| Marquee promo tile | `promo-marquee-1400x560.png` |
| Official URL | deixe *None* (exigiria verificar o domínio no Search Console) |
| Homepage URL | `https://mpjbiologo.github.io/NeuroTab/` |
| Support URL | `https://github.com/mpjbiologo/NeuroTab/issues` |
| Mature content | **Não** |

**Inglês e espanhol:** o nome e o resumo já vêm traduzidos do próprio pacote (pastas `_locales`). Para traduzir também a descrição e as capturas, use o seletor de idioma no topo da aba (*Add language* → English / Spanish) e cole os textos correspondentes do `README.md`.

**Save draft**.

## 4. Aba "Privacy" (a mais importante para a aprovação)

### Single purpose (finalidade única)

```
NeuroTab replaces the browser's new tab page with a personal dashboard: speed-dial shortcuts, notes, tasks and reminders, with optional widgets and an optional AI assistant (using the user's own API key) that searches and summarizes the user's own notes. Every feature lives on the new tab page or saves content to it.
```

### Permission justification (uma caixa por permissão)

| Permissão | Texto |
|---|---|
| storage | Stores the user's shortcuts, notes, tasks, reminders and settings locally in the browser. Nothing is sent to a developer server (there is none). |
| unlimitedStorage | Users can save background photos and images and keep a large notes library locally; the default quota is too small for that. |
| contextMenus | Adds a "Save to NeuroTab" item to the right-click menu to save selected text, a link or the current page as a note. |
| activeTab | When the user clicks the toolbar button or a context menu item, reads the title and URL of the current tab to save it as a note. For "Save image to library", it can also read that image from the page or, as a last resort, capture the visible tab and crop just that image. Only on that user action; everything stays local. |
| scripting | Together with activeTab, and only on user action: reads the text the user selected to save it, and reads the image the user right-clicked from inside the page (needed for images behind a login or created by the page, such as blob: URLs). |
| favicon | Shows each site's icon on the speed-dial shortcuts. |
| alarms | Fires the user's reminders, alarms, timers and pomodoro sessions, and a daily check for a new version (notice only). |
| notifications | Shows the user's reminder, alarm and timer notifications. |
| offscreen | Plays the alarm/timer sound from the background when the new tab is not open. |
| Host permission | open-meteo.com: weather widget and city search. api.github.com: shows a notice when a new version exists (it never downloads code). All other hosts are optional and requested at runtime only when the user turns on the related feature: quotes widget (awesomeapi.com.br, brapi.dev), traffic address search (nominatim.openstreetmap.org), Bing/NASA background photos, the AI provider the user configures (Gemini, OpenAI, Anthropic, OpenRouter, local Ollama) and https://*/* for an RSS feed or a custom AI endpoint the user adds, or to save an image from a site. The user can revoke them in Settings > Permissions. |

As permissões opcionais **topSites**, **sessions** e **tabs** também têm caixa própria:

| Permissão | Texto |
|---|---|
| topSites | Optional permission, requested only when the user adds the "Browsing" widget to the new tab page. It reads the browser's list of most-visited sites (chrome.topSites.get) to show them as quick links inside the widget. The list is displayed locally on the new tab page only; it is never stored outside the browser or sent to any server. Users who don't add the widget are never asked for this permission, and it can be removed at any time in Settings > Permissions. |
| sessions | Optional permission, requested only when the user adds the "Browsing" widget. It lists the recently closed tabs and windows (chrome.sessions.getRecentlyClosed) and lets the user reopen one with a click (chrome.sessions.restore). The data is shown locally on the new tab page only; it is never stored or sent anywhere. It can be removed at any time in Settings > Permissions. |
| tabs | Optional permission, requested together with "sessions" only when the user adds the "Browsing" widget. Without the "tabs" permission, Chrome returns recently closed tabs without their title and URL, so the widget could not show which page each entry is. It is used only to display the title and address of recently closed tabs on the new tab page; the extension does not read, monitor or modify the user's open tabs, and nothing is stored or sent anywhere. It can be removed at any time in Settings > Permissions. |

### Remote code

**No, I am not using remote code.**

Justificativa (se pedir):

```
All JavaScript is included in the package. The extension does not load or eval external scripts; network requests only fetch data (weather, quotes, RSS, AI responses as text).
```

### Data usage (o que a extensão "coleta")

O Chrome chama de "coleta" qualquer dado que **saia do computador**, mesmo que vá para um serviço escolhido pelo usuário e não para você. Por isso, para bater com a política de privacidade, marque:

- [x] **Location**: as coordenadas das cidades escolhidas vão para o Open-Meteo (clima) e o endereço digitado vai para o Nominatim (trânsito).
- [x] **Website content**: quando o usuário usa a IA, o texto das notas e páginas salvas vai para o provedor que ele configurou, com a chave dele.

Deixe **desmarcados** os demais (informações pessoais, saúde, financeiras, autenticação, comunicações, histórico de navegação, atividade do usuário). O widget "Navegação" lê mais visitados e abas fechadas, mas esses dados não saem do navegador.

Marque as três certificações:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://mpjbiologo.github.io/NeuroTab/privacy.html`

**Save draft**.

## 5. Aba "Distribution"

- **Payments:** Free of charge
- **Visibility:** Public
- **Distribution:** All regions

## 6. Aba "Test instructions" (se aparecer)

Não precisa de login. Cole em *Additional instructions*:

```
No account or login is required. All user data is stored locally (chrome.storage and IndexedDB); the extension has no server.

How to test:
1. Open a new tab. Type a note in "Quick capture" and press Save.
2. Press Ctrl+K to search shortcuts and notes.
3. Click the puzzle icon (bottom-left) to add widgets (clock/timer, calculator, weather, habits, news...).
4. Click the extension icon on any web page to save the page or a note.

AI features are optional and use the user's own API key (Settings > AI & voice). Without a key everything else works.
Optional permissions and hosts are requested only when the user turns on the related feature, and are listed with Allow/Remove in Settings > General > Permissions.
The daily GitHub check only shows a "new version available" notice; it never downloads or runs code. Store installs are updated by the Web Store.
Voice features use the browser's Web Speech API; the continuous wake word is off by default and shows a privacy warning before it can be enabled.
The code is not minified. Source: https://github.com/mpjbiologo/NeuroTab
```

## 7. Enviar

Clique em **Submit for review**. Na janela de confirmação, deixe marcado **publicar automaticamente após a aprovação** (ou desmarque se quiser escolher o dia). O Google avisa por e-mail.

## Se rejeitarem

O e-mail traz um código de violação. Os mais prováveis:

- **Purple Potassium** (permissões em excesso): responda com a tabela de justificativas acima, lembrando que `https://*/*` é **opcional** e só é pedida em tempo de uso.
- **Yellow Zinc** (ficha incompleta): falta captura, ícone ou descrição em algum idioma adicionado.
- **Purple Lithium / Purple Nickel** (privacidade): confira se as caixas de *Data usage* batem com a política de privacidade e se a URL abre.

## Depois de publicada

- O endereço fica `https://chromewebstore.google.com/detail/neurotab/<id>`. Me mande o link para eu trocar os botões de download do site e do README.
- Quem instala pela loja recebe atualizações automáticas.
- Versão nova: use o envio automático abaixo. O caminho manual continua valendo: suba a versão no `manifest.json`, gere o zip (`./scripts/build.sh`) e, no painel, **Package → Upload new package** e depois **Submit for review**.

## Envio automático de versões novas (configurar uma vez)

Depois de configurado, cada release publicada no GitHub roda os testes, gera o zip e o envia sozinha para a Chrome Web Store (job **loja-chrome** do workflow *Release*). O Google revisa como sempre e, aprovada, todos os usuários recebem a atualização automaticamente, sem perder dados.

Usamos uma **conta de serviço** do Google Cloud: é um "robô" com uma chave que não vence. (O outro caminho do Google, OAuth com app em modo de teste, gera um token que expira em 7 dias.)

### 1. Ativar a API no Google Cloud

1. Abra https://console.cloud.google.com/ com a mesma conta Google da Chrome Web Store.
2. No topo, **Selecionar projeto → Novo projeto**, nome `neurotab-publicacao` → **Criar** (e selecione-o).
3. Na barra de busca, digite **Chrome Web Store API** → **Ativar**.

### 2. Criar a conta de serviço e a chave

1. Menu ☰ → **IAM e administrador → Contas de serviço → + Criar conta de serviço**.
2. Nome: `neurotab-ci` → **Criar e continuar**. Não precisa dar nenhum papel/permissão: clique em **Continuar** e **Concluir**.
3. Copie o **e-mail** da conta criada (algo como `neurotab-ci@neurotab-publicacao.iam.gserviceaccount.com`).
4. Clique na conta → aba **Chaves → Adicionar chave → Criar nova chave → JSON → Criar**. O navegador baixa um arquivo `.json`. Guarde-o com cuidado: ele dá acesso à publicação.

> Se aparecer "a criação de chaves está desativada por uma política da organização", me avise: dá para usar o caminho alternativo com OAuth (segredos `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` e `CWS_REFRESH_TOKEN`, que o script também aceita).

### 3. Autorizar a conta de serviço na Chrome Web Store

1. Abra https://chrome.google.com/webstore/devconsole → **Account** (ou **Publisher → Settings**).
2. Em **Service accounts**, adicione o e-mail da conta de serviço e salve.
3. Na mesma página, copie o **Publisher ID**.
4. O **Extension ID** é o código de 32 letras no endereço da NeuroTab na loja (`.../detail/neurotab/<ID>`) ou no painel, em **Items**.

### 4. Guardar os segredos no GitHub

Repositório → **Settings → Secrets and variables → Actions → New repository secret**:

| Nome | Valor |
|---|---|
| `CWS_PUBLISHER_ID` | o Publisher ID |
| `CWS_EXTENSION_ID` | o Extension ID |
| `CWS_SERVICE_ACCOUNT` | **o conteúdo inteiro** do arquivo `.json` da chave (abra no Bloco de Notas, copie tudo, de `{` a `}`) |

Depois de salvar o segredo, apague o arquivo `.json` do computador (ou guarde num lugar seguro). Sem esses segredos o job apenas avisa que pulou o envio; nada quebra.

### 5. Lançar uma versão

O mesmo da release do Edge: suba a versão, publique a release no GitHub e acompanhe em **Actions → Release** os jobs **loja-edge** e **loja-chrome**.

### Se o job loja-chrome falhar

O log explica a causa em português. As mais comuns:

- **HTTP 403**: o e-mail da conta de serviço não foi adicionado em *Service accounts* no Developer Dashboard, ou a API não foi ativada no projeto.
- **Já existe uma versão em revisão**: espere a revisão terminar e, em Actions, use **Re-run failed jobs** só no loja-chrome.
- **A versão precisa ser maior**: falta subir a versão no `manifest.json`.
