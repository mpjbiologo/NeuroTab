# Arquitetura da nova aba

A nova aba (`src/newtab.html`) é montada por `src/newtab.js`, que só **inicializa**. Cada parte da tela fica num módulo em `src/newtab/`. A lógica que não depende da tela fica em `src/lib/`, com testes de unidade. Os widgets ficam em `src/widgets/`.

## Antes (até a v0.6.3)

Um único `src/newtab.js` com **1.868 linhas** e 13 seções: inicialização, aparência, relógio e clima, barra de atalhos, busca, widgets, grade, modo livre, layouts salvos, editor de itens, novidades, voz e palavra de ativação. Todas liam e alteravam as mesmas variáveis do arquivo (`data`, `items`, `editing`, `drag`…), então mexer numa parte podia quebrar outra sem aviso.

## Depois (v0.7.0)

| Arquivo | Linhas | Responsabilidade | Usa (módulos da nova aba) |
|---|---:|---|---|
| `newtab.js` | 106 | Inicialização: carrega dados, liga cada parte, reage a mudanças no armazenamento | todos |
| `newtab/state.js` | 22 | **Estado compartilhado** `S` (ver abaixo) e referências fixas da página | — |
| `newtab/context.js` | 40 | Contexto entregue aos widgets (dados, configurações, cérebro, ações) | state, editor, rail |
| `newtab/appearance.js` | 94 | Tema, barra lateral, plano de fundo e slides de fotos | state, rail |
| `newtab/hero.js` | 178 | Relógio, saudação, clima e outras cidades | state, context |
| `newtab/rail.js` | 323 | Barra de atalhos: grupos, painel de links, arrastar e soltar | state, context |
| `newtab/search.js` | 115 | Busca universal (Ctrl+K) | state, context, editor, widgets |
| `newtab/widgets.js` | 58 | Montagem dos widgets; escolhe grade ou modo livre | state, context, grid, free |
| `newtab/grid.js` | 47 | Modo grade | state, widgets, free, rail |
| `newtab/free.js` | 431 | Modo livre: arrastar, redimensionar, camadas, encaixe | state, widgets, grid, layouts |
| `newtab/layouts.js` | 82 | Layouts salvos e seletor de widgets | state, widgets, free |
| `newtab/editor.js` | 75 | Editar/criar item do cérebro | state, context |
| `newtab/updates.js` | 42 | Aviso de versão nova e novidades | state |
| `newtab/voice.js` | 143 | Assistente de voz: ouvir, executar, responder | state, context, wake |
| `newtab/wake.js` | 134 | Palavra de ativação (escuta contínua) | state, voice |

```
newtab.js (inicialização)
 ├─ appearance ── rail
 ├─ hero
 ├─ rail
 ├─ search ── editor, widgets
 ├─ widgets ── grid ⇄ free ── layouts
 ├─ editor
 ├─ updates
 └─ voice ⇄ wake
 (todos usam state; os que falam com widgets usam context)
```

### Bibliotecas puras extraídas (com testes de unidade)

| Biblioteca | O que faz | Testes |
|---|---|---|
| `lib/wake-word.js` | Acha a palavra de ativação no que foi ouvido ("neuro tab, anotar café" → "anotar café"), variações aceitas, prazo e regra de quando escutar | `tests/unit/wake-word.test.js` |
| `lib/layout-geometry.js` | Colunas da grade pela largura, largura de cada widget, sobreposição com folga, primeiro espaço livre, posição livre mais próxima, encaixe nas guias | `tests/unit/layout-geometry.test.js` |
| `lib/safe-html.js` | Limpa HTML antes de entrar na página (v0.6.3) | `tests/e2e/safe-html.test.js` |

## Regras

1. **Estado compartilhado só em `S`.** Variáveis que mais de uma parte **altera** ficam em `S` (`newtab/state.js`): `S.data`, `S.items`, `S.activeId`, `S.bgCache`, `S.drag`, `S.editing`, `S.mounted`, `S.widgetsSig`, `S.gridCols`, `S.zTop`, `S.voiceSession`. Imports de JavaScript não podem ser reatribuídos, por isso elas não são exportadas soltas.
2. **Estado de uma parte só fica nela.** Ex.: `heroSig` (hero), `slideshow` (appearance), `wake` (wake), `guides` (free).
3. **Widgets não importam módulos da nova aba.** Eles recebem o `ctx` (`newtab/context.js`) ao montar. Mudanças no `ctx` são mudanças de contrato (ver #5 e #6).
4. **Lógica sem tela vai para `src/lib/`**, com teste de unidade. O módulo da nova aba só liga a lógica à página.
5. **Nada roda ao carregar um módulo** além de declarações (e pegar elementos da página em `state.js`). Quem liga cada parte é `init()` em `newtab.js`. Isso evita problemas de ordem entre módulos que se importam (ex.: `grid` ⇄ `free`, `voice` ⇄ `wake`).

## Como a divisão foi feita

Por **análise de escopo** do código (espree + eslint-scope), não por recorte manual: cada referência a cada variável foi localizada, as alteradas por várias seções viraram `S.*`, cada seção virou um módulo com os imports que realmente usa, e o que uma seção usa de outra passou a ser exportado/importado. Depois, uma verificação confirmou que nenhum nome ficou indefinido e nenhum import ficou sem uso. Todos os testes (unidade, ponta a ponta no Chromium e Firefox) passaram sem nenhuma alteração.

## Próximos passos

- **Contratos dos módulos e do ciclo de vida dos widgets** (#5, #6): formalizar o que entra no `ctx` e os eventos entre partes.
- **v0.8 (voz)** mexe em `voice.js`, `wake.js` e `lib/wake-word.js`.
- **Recorte de tela (#37)** pode usar `lib/layout-geometry.js` para a seleção de área.
