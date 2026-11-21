# Design da NeuroTab

A regra visual de tudo: nova aba, configurações, popup, página de permissão e site. O código segue este documento; uma mudança de visual começa aqui.

## Princípios

1. **O conteúdo vem antes do controle.** Os botões de cada cartão (▁ ⤢ e as ações do widget) aparecem ao passar o mouse ou com o foco do teclado. Em tela de toque, ficam sempre à vista.
2. **Uma cor de destaque por tema**, usada só no que é ação principal, seleção e foco. O resto é texto e superfície.
3. **Ícones desenhados, não emojis**, no que é da interface. O que a pessoa escolhe (o emoji de um grupo, a imagem de um atalho) continua como ela escolheu.
4. **Legível sobre qualquer foto de fundo.** As superfícies são translúcidas com desfoque, e todo par de cor de texto e fundo passa no contraste AA.
5. **Movimento curto e com propósito**, e nenhum quando o sistema pede menos movimento.

## Temas

Três temas com a mesma estrutura (`src/theme.css`), escolhidos em Configurações → Geral → Aparência (`settings.theme`). O padrão é o Futurista.

| Tema | Fundo | Destaque | Letra de títulos | Cantos | Assinatura |
|---|---|---|---|---|---|
| **Futurista** | noite índigo | ciano elétrico | Space Grotesk | 8 / 12 / 16 px | brilho suave só no que está ativo (gravando, foco da busca) |
| **Sóbria** | grafite neutro | azul | Inter fino | 6 / 10 / 12 px | sem brilho; contraste e espaço |
| **Calorosa** | carvão quente | âmbar | Fraunces (serifa) | 10 / 14 / 20 px | cantos mais redondos, serifa nos títulos |

O texto corrido é sempre Inter. As fontes vão dentro da extensão (`src/fonts`, subconjunto latino, licença OFL), sem buscar nada na internet.

`theme-boot.js` aplica o tema salvo antes da página desenhar, para não piscar. `lib/theme.js` aplica a escolha e a cor do navegador (`theme-color`).

## Tokens

Todo componente usa só tokens. Uma cor solta em CSS é exceção e fica listada no teste `tests/unit/theme.test.js` (prévia de cor do atalho, mapa, QR).

| Grupo | Tokens | Uso |
|---|---|---|
| Superfícies | `--bg`, `--surface`, `--surface-strong`, `--surface-solid`, `--field` | página, cartão translúcido, painéis e menus, diálogos, campos |
| Tons | `--tint-1` · `--tint-2` · `--tint-3` | fundo de botão, passar o mouse, selecionado |
| Bordas | `--border`, `--border-strong` | separação leve; campos e diálogos |
| Texto | `--text`, `--text-2`, `--text-3` | principal; secundário; marcador de campo (todos ≥ 4,5:1) |
| Destaque | `--accent`, `--on-accent`, `--accent-text`, `--accent-soft`, `--accent-2` | botão principal; texto sobre ele; destaque como texto; fundo de selecionado; acento secundário |
| Estado | `--ok`, `--warn`, `--bad`, `--on-bad` | concluído; atenção; erro e gravação |
| Tipo | `--fs-2xs` 11 · `--fs-xs` 12 · `--fs-sm` 13 · `--fs-md` 14 · `--fs-lg` 16 · `--fs-xl` 18 · `--fs-2xl` 22 · `--fs-3xl` 28 px | só estes oito tamanhos (o relógio e números grandes usam `clamp`) |
| Fontes | `--font-ui`, `--font-display`, `--display-weight`, `--display-track` | corpo; títulos, relógio e nomes de widget |
| Espaço | `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-8` 32 px | |
| Forma | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` | botões e chips; cartões internos; widgets e diálogos |
| Profundidade | `--shadow-card`, `--shadow-pop`, `--blur` | cartões; menus e diálogos; desfoque das superfícies |
| Foco | `--ring`, `--active-glow` | anel de foco do teclado; brilho do que está ativo (vazio na Sóbria) |
| Movimento | `--ease-out`, `--dur-1` · `--dur-2` · `--dur-3` | |

O contraste de cada tema é conferido por `node scripts/theme-contrast.mjs` e pelo teste de unidade.

## Ícones

- Conjunto [Lucide](https://lucide.dev) (licença ISC), traço único de 1,75. Ficam embutidos em `src/lib/icon-data.js`, gerado por `node scripts/build-icons.mjs` (a lista emoji → ícone está no próprio script).
- **Como usar:** escreva o emoji no começo do texto do botão, como sempre (`'⭐ Salvar local'`, `'🗑'`). O iconizador (`lib/icons.js`) troca pelo ícone em botões, chips, títulos de widget, abas, menus e estados vazios, inclusive no que aparece depois. Botão que fica só com o ícone ganha `aria-label` a partir do `title`.
- **Não troca:** grupos da barra, seletor de emoji, atalhos, chat e textos da pessoa. Para impedir num elemento, use a classe `no-icon` ou o atributo `data-emoji`.
- Ícone novo: acrescente o emoji e o nome do Lucide no mapa de `scripts/build-icons.mjs` e rode o script.

## Componentes

- **Cartão de widget:** `--surface` com `--blur`, borda `--border`, raio `--radius-lg`. O título usa `--font-display` e ícone em `--accent-text`; as ações aparecem ao passar o mouse ou com o foco.
- **Botão principal (`.btn.primary`):** `--accent` com texto `--on-accent`, peso 600. Use um por área.
- **Chip:** fundo `--tint-1`, texto `--text-2`. O selecionado usa `--accent-soft`, borda do destaque e texto `--accent-text`.
- **Campos:** fundo `--field`, borda `--border`. No foco do teclado, a borda vira `--accent` com halo `--accent-soft`.
- **Foco do teclado:** sempre visível (`--ring`) em botões, links, chips e abas; nunca `outline: none` sem substituto.
- **Estado vazio (`.empty`):** uma linha com o ícone do widget e, quando houver, uma ação. A explicação longa vai no `title`.
- **Avisos (`.toast`):** `role="status"` e `aria-live="polite"`.

## Acessibilidade e movimento

- `prefers-reduced-motion`: animações e transições caem para quase zero (`theme.css`).
- Contraste AA em todos os temas (teste automático).
- Seleção de texto, cursor, barras de rolagem, caixas de marcar e controles deslizantes seguem o destaque do tema.

## Site

O site (`docs/index.html`) usa o tema Futurista com as mesmas cópias do tema, das fontes e dos ícones em `docs/assets`. Depois de mexer no tema ou nos ícones, rode `node scripts/sync-site.mjs`; o teste avisa se a cópia ficar desatualizada.

## Editor visual e estilo dos atalhos (0.7.8)

O editor (Configurações → Aparência → Editor visual, #58) **não cria outro sistema de cores**: ele só sobrepõe tokens do tema.

- `settings.look` (validado por `src/lib/look.js` → `sanitizeLook`) guarda só o que a pessoa mudou: cores em hex, `opacity` (20–100), `radius` (0–28), `shadow`, `density` e `widgetStyle`. Vazio/`null` = o valor do tema.
- `lookVars(look)` traduz em tokens (`--accent`, `--surface`, `--radius-md`, `--shadow-card`, `--dens`…). `lib/theme.js → applyLook(settings)` aplica no `<html>` da nova aba, das configurações e do popup, e guarda em `localStorage.nt_look` para o `theme-boot.js` aplicar antes de desenhar (sem piscar).
- O estilo dos widgets vai em `html[data-wstyle]` (`glass` | `solid` | `outline` | `minimal`); a densidade multiplica espaços por `var(--dens, 1)`.
- Antes de aplicar, a página resolve as cores finais (inclusive oklch e `color-mix`) num canvas de 1 px e roda `lookWarnings` (contraste WCAG). `options.html#reset-tema` ignora o `nt_look` guardado e volta ao padrão.
- Temas salvos: `settings.customThemes = [{ id, name, base, look }]`; arquivo `{ format: 'neurotab-theme', v: 1, name, base, look }`.

Os blocos de atalho (#59) ficam em `src/tiles.css`, usado pela nova aba e pelas prévias. `lib/tiles.js → paintTiles(raiz, settings)` põe `--tile-gap`, `--tile-op`, `--tile-scale` e `data-tfill/tborder/tshadow` na raiz; cada bloco tem `data-shape`, `--c` (cor) e `--ct` (texto legível sobre ela). Ícone próprio por atalho: `link.icon = { kind: 'image' | 'emoji' | 'letter', … }` (imagem só como PNG/JPEG/WebP/GIF em data URL, reduzida para 64 px); `link.shape` sobrepõe o formato geral.
