# Testes da NeuroTab

Toda mudança passa pelos testes antes de virar release. O GitHub roda tudo sozinho a cada push na `main`, em pull requests e antes de empacotar uma release (`.github/workflows/ci.yml`). Se algo falhar, a release não é publicada.

## Rodar no seu computador

Requisitos: Node.js 22 ou mais novo.

```bash
npm ci                                  # instala o Playwright (só para os testes)
npx playwright install chromium         # baixa o Chromium usado nos testes (uma vez)
npm test                                # unidade + ponta a ponta
```

Comandos separados:

| Comando | O que faz | Tempo |
|---|---|---|
| `npm run test:unit` | Funções puras: armazenamento, migrações, backup, criptografia, datas, comandos de voz, traduções, permissões | ~2 s |
| `npm run test:e2e` | Abre um Chromium com a extensão carregada da pasta e usa como uma pessoa usaria | ~4 min |
| `npm run check` | Tudo, incluindo empacotar e validar o pacote do Firefox | ~5 min |

Um arquivo só: `node --test --import ./tests/unit/setup.js tests/unit/migrations.test.js` ou `node --test tests/e2e/images.test.js`.

## Organização

```
tests/
  unit/        node:test, sem navegador. setup.js cria um chrome.* falso em memória.
  e2e/         node:test + Playwright. helpers.js abre a extensão e simula rede, microfone e voz.
  fixtures/    dados de exemplo (backup de demonstração, .spd sintético, armazenamento da v0.3)
```

Os testes não usam internet: clima, IA (Gemini), embeddings e imagens são respondidos por `tests/e2e/helpers.js`. Os embeddings falsos agrupam palavras do mesmo assunto (sono/dormir/cansado), o que permite testar a busca por significado.

## O que fica de fora (testado à mão)

Veja a matriz em [NAVEGADORES.md](NAVEGADORES.md). Em resumo: Firefox e Edge reais, microfone real, pedidos de permissão do navegador (o Playwright não clica em "Permitir"), notificações do sistema e os serviços reais (Waze, Bing, NASA, provedores de IA).

## Ao criar algo novo

- Função pura nova → teste em `tests/unit/`.
- Fluxo novo na tela → teste em `tests/e2e/` com `launch()` e `x.errors` vazio no fim.
- Mudou o formato dos dados salvos → nova migração em `src/lib/migrations.js` + teste (ver [ARMAZENAMENTO.md](ARMAZENAMENTO.md)).
- Novo acesso a site → entrada em `src/lib/permissions.js` (o teste de permissões falha se faltar).
