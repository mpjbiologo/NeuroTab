# Central do botão direito e recorte de tela (0.9.0)

Issues: #55 (visão), #56 (trecho como nota, tarefa ou lembrete), #12 (imagens e arquivos), #37 (recorte de tela).

## Peças

- `src/lib/menu-actions.js` (puro, `tests/unit/menu-actions.test.js`): o catálogo `ACTIONS` (id, ícone, rótulo, contextos, grupo, se abre revisão ou usa IA), `menuPlan(menu, groups, t)` (favoritas direto em "NeuroTab", IA em "🤖 IA ▸", o resto em "Mais ▸"; "Adicionar aos atalhos ▸" com os grupos), `actionsFor` (prévia), `sanitizeMenu` (`settings.menu = { order, hidden, fav }`), `extractData` (telefone, e-mail, datas, horários, preços e endereços, sem IA) e `aiPrompt`.
- `src/background.js`: `rebuildMenus()` cria os itens pelo plano; `onMenuClick()` despacha por id (`nt-<ação>`). As ações de imagem chamam `captureImage` antes de qualquer `await`, para o pedido de permissão do site não perder o gesto. `globalThis.__nt` expõe `onMenuClick`, `startSnip` e `rebuildMenus` para os testes (o Playwright não clica no menu do navegador).
- `src/capture.html` + `src/capture.js`: a janelinha de revisão. O fundo guarda o pedido em `chrome.storage.session` e abre `capture.html#<chave>`. Tipos: nota, tarefa, lembrete, nota sobre a página, juntar a uma nota, dados extraídos, imagem com anotação e as ações de IA (`settings.menuCloudOk` guarda os serviços na internet já liberados).
- `src/lib/snip.js` (puro): `toPixels` (retângulo CSS → pixels da foto, com zoom e DPR), `scrollPlan` (página inteira, até 20 telas) e `stitchScale` (altura máxima 16 384 px).
- `src/snip-content.js`: a camada de seleção (shadow DOM fechado, z-index máximo) e os ajudantes da captura rolada (rolar, esconder barras fixas depois da primeira foto, progresso com Cancelar, restaurar). A cópia de `toPixels` aqui é conferida pelo teste.
- `src/lib/snip-run.js`: `startSnip(tab, { full, openReview })` no fundo: `captureVisibleTab` (activeTab; ~2 fotos/s), injeta a camada, recorta ou junta as fotos com `OffscreenCanvas` e salva na biblioteca (`source: 'region'`).
- Atalhos: `Alt+Shift+S` (comando `snip`); botões no popup; Configurações → Captura → Menu do botão direito (`src/options-menu.js`).

## Limites

- Páginas internas do navegador e lojas de extensões não deixam injetar nem fotografar: aparece a dica do Win+Shift+S / Cmd+Shift+4 e colar na Captura rápida.
- "Copiar" grava a imagem na área de transferência pela página; se o navegador recusar, a imagem fica na biblioteca e abre a janelinha.
