# Imagens no cérebro (0.7.5)

Como a NeuroTab lê as imagens da biblioteca (#17) e a janela **Analisar imagem** (#54).

## Peças

| Arquivo | O que faz |
|---|---|
| `src/lib/vision.js` | Lê o texto (Tesseract, no computador) e descreve pela IA configurada (`describeImage`). Decide se precisa pedir autorização (`visionNeedsConsent`). |
| `src/lib/address.js` | `findAddress(texto)`: endereço em pt, es e en (rua, avenida, calle, street…) e CEP. Usado pelo botão direito e pela análise. |
| `src/lib/image-index.js` | Liga a biblioteca (IndexedDB `captures`) ao cérebro: `analyzeCapture`, `syncBrainItem`, `deleteCapture`, `captureStatus`, `pruneOrphans`. |
| `src/newtab/image-reader.js` | Na nova aba, lê as imagens novas, uma por vez, quando a página está à toa. Só uma aba lê por vez (Web Locks). |
| `src/analyze.html` + `analyze.js` | Janela de análise: texto, endereço → rota, descrição e pergunta pela IA. |
| `src/vendor/tesseract/` | Tesseract.js e o núcleo WebAssembly (SIMD + LSTM), copiados sem alteração por `scripts/vendor-tesseract.mjs`. |

## Regras

- **Guardar ou não (Configurações → Mídia, `settings.media.save`).** "Analisar imagem" pelo botão direito salva a imagem como temporária (`temp: true`) quando a opção não é "Guardar sempre". Temporária não aparece na biblioteca, não é lida pela nova aba e não vira item do cérebro. `keepCapture` guarda; `discardTemp` apaga ao fechar a janela; `purgeTemp` limpa as esquecidas (mais de 6 h) quando a nova aba abre.
- **IA para imagens (`settings.media.provider`).** `visionSettings()` troca só o provedor das chamadas de imagem; a chave vem de `settings.ai.keys` daquele provedor.

- **A imagem não sai do computador para ler o texto.** Só o pacote do idioma é baixado, uma vez, do jsDelivr (`@tesseract.js-data/<idioma>@1.0.0`, formato `best_int`), e fica guardado pelo próprio Tesseract no IndexedDB da extensão.
- **IA na internet só recebe a imagem com autorização.** A janela de análise mostra para onde vai a imagem e só envia no clique ("Enviar e descrever"). "Não perguntar de novo" grava `settings.ai.imagesAllowed`. IA local (Ollama ou URL em localhost) não pergunta.
- **Leitura automática é só a local.** A descrição pela IA é sempre pedida pela pessoa.
- **O item do cérebro guarda só texto.** Tipo `image`, com `captureId`. O texto junta a descrição, o texto lido e o endereço. Sem nenhum texto, nenhum item é criado (a biblioteca mostra "Sem texto").
- **Excluir a imagem exclui o item.** `deleteCapture` faz as duas coisas; `pruneOrphans` limpa itens de imagens que sumiram por fora.
- Nas perguntas ao cérebro, o item vem marcado como "texto lido de uma imagem salva, pode ter erros", para a IA não tratá-lo como fonte completa.

## Imagem para a IA

`complete()` (`src/lib/ai.js`) aceita `content` como lista de partes: `{ type: 'text', text }` e `{ type: 'image', mime, data }` (base64). Cada provedor recebe no seu formato: Gemini (`inline_data`), Anthropic (`image` com `source.base64`) e OpenAI e compatíveis, incluindo Ollama (`image_url` com `data:`). A imagem vai redimensionada (até 1600 px, JPEG).

## WebAssembly

O leitor usa WebAssembly, por isso o manifest tem `content_security_policy.extension_pages` com `'wasm-unsafe-eval'` (sem `unsafe-eval`). O worker é carregado do próprio pacote (`workerBlobURL: false`).

## Testes

- `tests/unit/vision.test.js`: endereços, limpeza do texto, idioma, autorização e formato da imagem por provedor.
- `tests/e2e/image-brain.test.js`: leitura real de uma imagem desenhada na página, item no cérebro, busca, exclusão, análise com IA na internet (autorização) e com Ollama (sem perguntar), rota no Trânsito. Nos testes, o pacote do idioma vem de `node_modules/@tesseract.js-data` (devDependency).

## Atualizar o Tesseract

```
npm i -D --save-exact tesseract.js@X tesseract.js-core@Y
node scripts/vendor-tesseract.mjs
npm test
```
