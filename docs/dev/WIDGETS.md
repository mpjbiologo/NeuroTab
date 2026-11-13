# Contrato dos widgets

Cada widget é um arquivo em `src/widgets/` registrado em `src/widgets/index.js`. Ele **não importa** módulos da nova aba (`src/newtab/*`): tudo o que precisa chega pelo `ctx`. Bibliotecas de `src/lib/` podem ser importadas à vontade.

## Definição

```js
export default {
  id: 'traffic',             // único; é o que fica salvo em settings.widgets
  title: 'Trânsito',         // nome no seletor de widgets (traduzido pela interface)
  icon: '🚦',
  description: '…',          // texto do seletor de widgets
  defaultW: 6,               // largura inicial, em 12 avos
  mount(el, ctx) { … return { destroy() { … } }; },  // obrigatório
  brainContext(settings, question) { … },            // opcional (ver abaixo)
};
```

## Ciclo de vida

1. **`mount(el, ctx)`** desenha o widget dentro de `el` (o corpo do cartão). Pode devolver `{ destroy() }`.
2. Ao **desmontar** (o painel é redesenhado, o widget é removido, o layout muda), a nova aba chama `destroy()` e, em seguida, **limpa sozinha** tudo o que foi registrado pelo escopo do widget (`lib/widget-scope.js`).
3. Montar e desmontar várias vezes **não acumula** assinaturas, temporizadores nem listeners (teste em `tests/e2e/layout.test.js`).
4. Um erro no `mount()` mostra "Erro ao carregar este widget." só naquele cartão e não afeta os outros.
5. A nova aba emite `widget.mounted` e `widget.unmounted` (`{ id, idx }`) no barramento.

### Use o escopo em vez de limpar à mão

| Em vez de | Use | Limpa sozinho ao desmontar |
|---|---|---|
| `setInterval(fn, ms)` | `ctx.every(ms, fn)` | ✔ |
| `setTimeout(fn, ms)` | `ctx.after(ms, fn)` | ✔ |
| `window.addEventListener(t, fn)` | `ctx.listen(window, t, fn)` | ✔ |
| assinar um evento | `ctx.on(evento, fn)` | ✔ |
| qualquer outra limpeza | `ctx.onCleanup(fn)` | ✔ |

Todos devolvem uma função para limpar antes, se quiser. `destroy()` continua valendo para o que for específico do widget.

## O que o `ctx` oferece

| Item | Para quê |
|---|---|
| `ctx.data`, `ctx.settings`, `ctx.items` | Dados atuais (somente leitura; sempre a versão mais recente) |
| `ctx.widget` | Configuração deste widget (ex.: `zoom`, `w`) |
| `ctx.saveWidget(patch)` | Salva configurações deste widget |
| `ctx.saveSettings(patch)` | Salva configurações gerais |
| `ctx.actions` | Área de botões no cabeçalho do cartão |
| `ctx.brain` | Biblioteca do cérebro (`lib/brain.js`) |
| `ctx.capture(item)` | Salva um item no cérebro (e organiza com IA, se ligado) |
| `ctx.openItem(item)`, `ctx.newItem(preset)` | Abre o editor de itens |
| `ctx.smartSearch(q, limite)`, `ctx.semanticOn()` | Busca (por significado, se ligada) |
| `ctx.aiReady()` | Há IA configurada? |
| `ctx.brainExtras(pergunta)` | Dados de todos os widgets para o cérebro (ver abaixo) |
| `ctx.openLinkDialog(link, preset)`, `ctx.faviconFor(link)` | Atalhos da barra |
| `ctx.openSettings(hash)` | Abre as configurações (ex.: `'#ia'`) |
| `ctx.toast(texto)` | Aviso rápido |
| `ctx.on`, `ctx.every`, `ctx.after`, `ctx.listen`, `ctx.onCleanup` | Escopo (acima) |

Mudar ou remover algo desta tabela é **mudança de contrato**: atualize este documento e os widgets que usam.

## Eventos (barramento `lib/events.js`)

| Evento | Quando | Dados |
|---|---|---|
| `data.changed` (apelido `data`) | Configurações/atalhos mudaram e foram salvos | `S.data` |
| `brain.changed` (apelido `brain`) | A lista de itens do cérebro mudou | lista de itens |
| `ask.requested` (apelido `ask`) | A busca (Ctrl+K) mandou uma pergunta ao cérebro | texto |
| `brain.item.created` | Um item novo apareceu (de qualquer lugar: nova aba, popup, menu, outra aba) | item (`id`, `type` obrigatórios) |
| `task.created` | O item novo é uma tarefa | item (`id`) |
| `task.completed` | Uma tarefa foi marcada como concluída | item (`id`) |
| `widget.mounted`, `widget.unmounted` | Ciclo de vida dos widgets | `{ id, idx }` |
| `knowledge.source.added`, `study.review.due` | Reservados para a v0.9 | `{ id, … }` |

Regras: um assinante com erro não impede os outros; nome desconhecido ou dados sem os campos obrigatórios geram erro na hora (para pegar enganos cedo). Evento novo: acrescente em `EVENTS` (`lib/events.js`) e nesta tabela.

## O cérebro lê os widgets (`brainContext`)

Um widget pode oferecer ao cérebro um resumo dos seus dados, para a IA responder perguntas sobre eles. É uma função **sem tela**: roda mesmo que o widget não esteja no painel.

```js
brainContext(settings, question) {
  // Devolva null quando a pergunta não tiver a ver com este widget (para não gastar a IA à toa)
  // ou quando a pessoa não quer compartilhar esses dados.
  return { title: 'TÍTULO DA SEÇÃO', note: 'orientação curta para a IA', text: 'os dados, em texto' };
}
```

A nova aba junta as respostas (`ctx.brainExtras(pergunta)`) e envia à IA junto das notas (`ask()` em `lib/ai.js`), tanto no widget "Pergunte ao seu cérebro" quanto na voz.

**Primeiro exemplo: widget de mapas (🚦).** `brainContext` devolve os locais e rotas salvos só quando a pergunta é sobre lugares e a opção "Enviar locais salvos à IA" está ligada (`lib/places.js`). Perguntas simples (endereço, distância em linha reta, listas) são respondidas **sem IA** por `localAnswer()`. Próximos candidatos: cotações, clima, hábitos e agenda.

## Lógica de domínio fora da tela

Regras que o cérebro, a voz ou o NeuroPilot (v0.9) também usam ficam em `src/lib/`, com testes de unidade, e o widget só as exibe. Exemplos: `lib/places.js` (mapas), `lib/weather.js` (clima), `lib/brain.js` (itens), `lib/wake-word.js` (voz), `lib/layout-geometry.js` (painel).
