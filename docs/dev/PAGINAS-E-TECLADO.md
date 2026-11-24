# Teclado e páginas (0.9.2.1, #75)

## Atalhos de teclado da nova aba

- `lib/hotkeys.js`:
  - `HOTKEY_ACTIONS` traz as ações e o atalho padrão de cada uma;
  - `settings.hotkeys` guarda o que a pessoa mudou (`''` = desligado);
  - `pageN` guarda só os modificadores (`'Alt'` → Alt+1…9).
- A tecla é lida pela **posição física** (`e.code`) para letras e números: no Mac, o Alt troca o caractere (Alt+Z = "Ω"). Na pontuação vale o que está escrito na tecla (`e.key`), porque no ABNT2 o "[" fica em outro lugar; se o Alt do Mac trocou o caractere, cai na posição física.
- `bindHotkeys(handlers, getCustom)` escuta um único `keydown` e lê `settings.hotkeys` a cada tecla, então a mudança vale na hora.
  - Combinações sem Ctrl/Alt nunca disparam em campos de texto.
  - As ações com `inFields` (busca, voz, dock) disparam também nos campos.
- Na nova aba, `newtab/keys.js` faz o registro: os módulos chamam `registerHotkey('clean', fn)`. Para mostrar o atalho atual numa dica, use `withKey(texto, id, padrão)`.
- `conflictsFor` avisa sobre: outra ação, teclas do navegador (`RESERVED`), programas conhecidos (`KNOWN_APPS`: NVIDIA Alt+Z, AMD Alt+R…) e combinação sem modificador.
- **Atalhos em qualquer aba** (`commands` do manifesto):
  - no Firefox, `commands.update` ali mesmo;
  - no Chrome e no Edge, a extensão não pode mudar: só mostra os atuais e abre a página de atalhos do navegador.

## Várias páginas de widgets

- `lib/pages.js` reúne as funções puras.
  - `settings.widgets`, `layoutMode` e `freeFixed` são **sempre os da página aberta**; o resto do código não muda.
  - `settings.pages` guarda todas as páginas, e o registro da página aberta é atualizado ao trocar (`storeLive`).
  - `settings.page` é o id da página aberta. Com uma página só, `pages` fica vazio.
- `newtab/pages.js` cuida da interface:
  - o indicador `#pager` sob o relógio (pontinhos, abas ou só setas), as setas ao passar o mouse e o deslizar (roda horizontal ou toque, ignorando o que rola de lado);
  - os atalhos e a voz;
  - a barra de páginas no modo de edição (`#pageEdit`) e o menu ⇄ de cada widget.
- `goPage` grava **antes** de animar. Assim, uma gravação de outra aba no meio da animação não traz a página antiga de volta.
- O que dá para configurar fica em `settings.pagesNav = { style, start, swipe, clockAll }`.
- Uma página nova abre vazia. Ao apagar uma página, os widgets podem ir para a primeira, e a posição do modo livre não vai junto.

## Testes

`tests/unit/hotkeys-pages.test.js` e `tests/e2e/hotkeys-pages.test.js`.
