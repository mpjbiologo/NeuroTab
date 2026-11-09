# Publicar a NeuroTab no Microsoft Edge Add-ons — passo a passo

Tempo estimado: 30–40 minutos para preencher. A revisão da Microsoft costuma levar até 7 dias úteis.

## Antes de começar

1. **Ative o site (GitHub Pages)**, porque a loja exige a URL da política de privacidade:
   GitHub → repositório NeuroTab → **Settings → Pages** → *Source: Deploy from a branch* → Branch **main**, pasta **/docs** → **Save**.
   Depois de 1–2 minutos, confira se abre: https://mpjbiologo.github.io/NeuroTab/privacy.html
2. **Separe os arquivos** (todos em `docs/store/` ou no zip `edge-assets.zip`):
   - `neurotab.zip`: o pacote da extensão (não descompacte)
   - `logo-300x300.png`: logo da loja (**obrigatório**)
   - `promo-small-440x280.png`: bloco promocional pequeno (**obrigatório**)
   - `promo-marquee-1400x560.png`: bloco grande (opcional)
   - `screenshot-1/2/3-pt.png`, `-en`, `-es`: capturas 1280×800 (opcionais, mas recomendadas)

## 1. Criar a conta de desenvolvedor (gratuita)

1. Acesse https://partner.microsoft.com/dashboard/microsoftedge/overview
2. Entre com sua conta Microsoft (Outlook/Hotmail serve).
3. Escolha **Individual**, preencha nome de exibição do editor (sugestão: **Marcos de Paula Júnior** ou **mpjbiologo**), e-mail de contato e país.
4. Aceite o contrato. Não há taxa.

## 2. Criar a extensão e enviar o pacote

1. No painel do Edge: **Create new extension**.
2. Arraste o **`neurotab.zip`** em *Packages*. O painel lê a versão e as permissões.
3. Clique em **Continue**.

## 3. Availability (disponibilidade)

- **Visibility:** Public
- **Markets:** todos (deixe marcado "Select all")
- **Save**

## 4. Properties (propriedades)

| Campo | O que colocar |
|---|---|
| Category | **Productivity** |
| Privacy policy requirements | **Yes** (a extensão pode enviar dados a serviços que o usuário configura: IA, clima) |
| Privacy policy URL | `https://mpjbiologo.github.io/NeuroTab/privacy.html` |
| Website URL | `https://mpjbiologo.github.io/NeuroTab/` |
| Support contact details | `https://github.com/mpjbiologo/NeuroTab/issues` (ou um e-mail seu) |
| Mature content | **No** |

**Save**.

## 5. Store listings (página na loja)

Adicione os três idiomas: **Portuguese (Brazil)**, **English** e **Spanish**. Em cada um:

| Campo | O que colocar |
|---|---|
| Description | O texto "Descrição" do idioma em `docs/store/README.md` (tem entre 900 e 1.100 caracteres; o mínimo é 250) |
| Short description (se aparecer) | O "Resumo" do idioma |
| Extension Store logo | `logo-300x300.png` |
| Small promotional tile | `promo-small-440x280.png` |
| Large promotional tile | `promo-marquee-1400x560.png` (opcional) |
| Screenshots | As 3 capturas do idioma (`screenshot-1-pt.png` etc.) |
| YouTube video URL | deixe em branco |
| Search terms | veja abaixo |

**Search terms** (até 7 termos):

- PT: `nova aba` · `speed dial` · `segundo cérebro` · `notas` · `assistente IA` · `produtividade` · `comandos de voz`
- EN: `new tab` · `speed dial` · `second brain` · `notes` · `AI assistant` · `productivity` · `voice commands`
- ES: `nueva pestaña` · `speed dial` · `segundo cerebro` · `notas` · `asistente IA` · `productividad` · `comandos de voz`

**Save**.

## 6. Submission — notas para os revisores

Cole este texto em **Notes for certification** (em inglês, porque é para a equipe da Microsoft):

```
NeuroTab replaces the new tab page with a personal dashboard (shortcuts, notes, reminders, widgets).
No account or login is required. All user data is stored locally (chrome.storage and IndexedDB); the extension has no server.

How to test:
1. Open a new tab. Type a note in "Quick capture" and press Save.
2. Press Ctrl+K to search shortcuts and notes.
3. Click the puzzle icon (bottom-left) to add widgets (clock/timer, calculator, weather, habits, news...).
4. Click the extension icon on any web page to save the page or a note.

AI features are optional and use the user's own API key (Settings > AI & voice). Without a key everything else works.
Optional permissions (topSites, sessions, tabs) are requested only when the user adds the "Browsing" widget.
Optional host permissions are requested only when the user uses the related feature: quotes widget, traffic address search,
Bing/NASA background photos, an AI provider, an RSS feed or saving an image. They are listed (with Allow/Remove) in Settings > General > Permissions.
Voice features use the browser's Web Speech API; the continuous "wake word" is off by default and shows a privacy warning before it can be enabled.
No remote code is loaded; the code is not minified. Source: https://github.com/mpjbiologo/NeuroTab
```

Clique em **Publish**. O status passa por *In review* → *In certification* → *Published*. A Microsoft avisa por e-mail.

## Se pedirem correções

As causas mais comuns de rejeição e o que responder:

- **Permissões amplas** (`https://*/*` opcional): explique que é pedida só quando o usuário adiciona um feed RSS ou um provedor de IA com URL própria. O texto está em `README.md`, tabela "Justificativas de permissão".
- **Descrição pouco clara**: a descrição já diz que a extensão substitui a nova aba; se pedirem, deixe isso na primeira frase.
- **Política de privacidade inacessível**: confira se o GitHub Pages está ativo (passo "Antes de começar").

## Depois de publicada

- O endereço fica `https://microsoftedge.microsoft.com/addons/detail/...`. Me mande o link que eu troco o botão de download do site e do README para a loja.
- Quem instalar pela loja recebe atualizações automáticas. O aviso de versão nova via GitHub só aparece para quem instalou pelo zip.
- Para publicar uma versão nova: suba a versão no `manifest.json`, gere o zip (`./scripts/build.sh`) e, no painel, **Update → Packages → Replace**, e depois **Publish** de novo.
