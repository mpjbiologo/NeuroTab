# Publicar a NeuroTab na loja do Firefox (AMO) — passo a passo

**Etapa 1 (manual, uma vez):** criar a página da extensão no site da Mozilla.
**Etapa 2 (automática, sempre):** cada release do GitHub envia a versão nova sozinha.

A loja é gratuita. A revisão costuma levar de algumas horas a poucos dias.

---

## Etapa 1 — primeira publicação (uns 20 minutos)

### 1. Conta de desenvolvedor
1. Acesse https://addons.mozilla.org/developers/ e entre (ou crie uma **conta Mozilla**).
2. Aceite o **Contrato de Distribuição** quando o site pedir.
3. Na primeira vez, pode ser necessário definir um **nome de exibição** (sugestão: *Marcos de Paula Júnior*).

### 2. Enviar o pacote
1. Clique em **Submit a New Add-on** (Enviar novo complemento).
2. **Como distribuir?** → **On this site** (neste site).
3. **Plataforma:** só **Firefox for desktop**.
4. Envie o arquivo **`neurotab-firefox.zip`** da release mais recente no GitHub. Não use o `neurotab.zip`, que é o do Edge/Chrome.
5. A validação automática deve passar sem erros (pode mostrar alguns avisos; é normal).
6. **Código-fonte:** a pergunta "Do you need to submit source code?" → **No**. A NeuroTab não é minificada nem compilada; o código enviado é o próprio código-fonte.

### 3. Página da extensão
Preencha com os textos abaixo. O idioma padrão da página é **Português (do Brasil)**; depois de salvar, use **Manage localizations** para adicionar English e Español.

| Campo | O que colocar |
|---|---|
| Name | O nome vem do pacote: *NeuroTab — nova aba com segundo cérebro* |
| Add-on URL (slug) | `neurotab` |
| Summary | Texto "Resumo" de `docs/store/README.md` |
| Description | Texto "Descrição" de `docs/store/README.md` |
| Categories | **Tabs** |
| Support email | um e-mail seu para suporte (opcional) |
| Support website | `https://github.com/mpjbiologo/NeuroTab/issues` |
| License | **MIT License** |
| Privacy policy | Marque que tem política e cole o link: `https://mpjbiologo.github.io/NeuroTab/privacy.html` |
| Notes to reviewer | o texto abaixo (em inglês) |

**Notes to reviewer:**

```
NeuroTab replaces the new tab page with a personal dashboard (shortcuts, notes, reminders, widgets).
No account or server; all data is stored locally (storage.local and IndexedDB).
The code is not minified or transpiled; the package is the source. Repository: https://github.com/mpjbiologo/NeuroTab

Data collection (data_collection_permissions): required "none"; optional "locationInfo" (city coordinates sent to
Open-Meteo for weather, addresses sent to OpenStreetMap Nominatim for the Traffic widget) and "websiteContent"
(note/clip text sent to the AI provider the user configures with their own API key). Both are requested with
permissions.request() in a click handler, only when the user adds a city / searches an address / saves an AI provider.
Without consent, nothing is sent.

Optional host permissions are requested per feature (quotes, traffic, slideshow photos, AI providers, RSS feeds, images).
Voice commands use the Web Speech API, which Firefox does not provide; those options are hidden on Firefox.

How to test: open a new tab, type a note in "Captura rápida" and press Salvar; Ctrl+K searches shortcuts and notes;
the puzzle icon (bottom-left) adds widgets.
```

### 4. Capturas de tela
Em **Images**, envie as capturas `docs/store/screenshot-1-pt.png`, `-2-pt.png` e `-3-pt.png`. Elas também estão no `edge-assets.zip`. O ícone vem do pacote.

### 5. Enviar para revisão
Clique em **Submit Version**. A Mozilla avisa por e-mail quando aprovar. A página fica em `https://addons.mozilla.org/firefox/addon/neurotab/`.

---

## Etapa 2 — atualizações automáticas pelo GitHub

Depois que a primeira versão estiver no ar:

1. Na loja, abra **Tools → Manage API Keys** (https://addons.mozilla.org/developers/addon/api/key/) e clique em **Generate new credentials**.
2. Copie o **JWT issuer** e o **JWT secret**. O secret aparece uma vez só.
3. No GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Crie dois secrets:
   - `AMO_JWT_ISSUER` → o JWT issuer
   - `AMO_JWT_SECRET` → o JWT secret

Pronto. A partir daí, cada release publicada no GitHub:

1. confere a versão e roda todos os testes, inclusive no **Firefox de verdade**;
2. gera os pacotes;
3. **envia a versão nova para a loja do Firefox**.

A Mozilla revisa e, aprovada, todo mundo recebe a atualização sozinho, com os dados intactos. Acompanhe a revisão no painel da loja ou pelo e-mail.

> As credenciais não vencem sozinhas. Se um dia vazarem, gere novas na mesma página e troque os secrets no GitHub.

---

## Quem já usa a versão do zip

A versão da loja é uma instalação nova, com dados próprios. Para levar tudo:

1. Na versão atual: **Configurações → Backup**. Marque **Incluir chaves de API**, defina uma senha e clique em **Baixar backup**.
2. Instale pela loja e remova a versão temporária.
3. Na versão da loja: **Configurações → Backup → Importar** e digite a senha.
