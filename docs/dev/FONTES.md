# Fontes e documentos (0.9.3, #9)

Uma **fonte** é de onde veio um conhecimento: um link, artigo, artigo científico, livro, vídeo, post, áudio, PDF, documento ou arquivo. Na NeuroTab ela é **um item do cérebro**, por isso entra sem código extra na busca, na busca por significado, na lixeira (30 dias), na sincronização entre computadores e no backup.

## O que é fonte

| Item | Vira fonte? | Tipo (`kind`) quando não informado |
|---|---|---|
| `source` (novo, 📚) | sempre | `link` |
| `page` (página salva) | sempre | `pdf` se a URL termina em .pdf; `paper` para doi.org, arXiv, SciELO, PubMed…; senão `link` |
| `media` (Salvar mídia, #67) | sempre | `video` (YouTube ou vídeo), `post` (Instagram, TikTok, X), `article` |
| trecho, nota, ideia, tarefa, imagem | não — **ligam-se** a uma fonte | — |

## Contrato (`src/lib/sources.js`)

Metadados em `item.src` (todos opcionais, limpos por `cleanSrc`):

```js
src = {
  kind: 'link' | 'article' | 'paper' | 'book' | 'video' | 'post' | 'audio' | 'pdf' | 'doc' | 'file',
  author: '',      // até 300 caracteres
  published: '',   // "2024", "2024-05" ou "2024-05-17"
  publisher: '',   // editora, revista ou site
  project: '',     // até 80 caracteres; filtra a lista e sugere nos formulários
  ident: '',       // DOI, ISBN, número de processo…
  file: { name, size, mime, modified, pages?, textChars? }, // só os dados; o arquivo não é copiado
}
```

- **Origem preservada:** o link fica em `item.url`; a data de captura é `item.createdAt`. `sourceMeta(item)` devolve os metadados completos, completando com o que `media` já guarda (autor, data de publicação).
- **Ligação:** um item se liga a uma fonte pela **URL padronizada** (`canonicalize` de `media-links.js`: sem rastreio, sem `www`, sem barra final) ou por `item.sourceId`. `linkedItems(fonte, itens)`.
- **Sem duplicar:** `findSourceByUrl` — criar uma fonte com um link que já tem fonte abre a existente.
- **Funções:** `listSources(itens, { kind, project, q })` (busca sem IA por título, autor, editora, projeto, identificador, nome do arquivo e texto), `projectsOf`, `uncitedLinks` (links citados em trechos e notas sem fonte), `createSource`, `updateSource` (mescla `src`; o que não veio é mantido), `removeSource` (lixeira).
- **Busca geral:** `searchItems` (brain.js) e `itemText` (semantic.js) incluem `srcText(item)`, então "Silva" acha o artigo do autor Silva em qualquer busca do cérebro.

## Arquivos locais (`src/lib/source-files.js`)

- O arquivo **nunca é copiado** para a extensão: ficam nome, tamanho, tipo, data de modificação e, quando dá, o texto.
- Texto simples (txt, md, csv, json, html, xml, srt, vtt, rtf…): lido direto e limpo (`plainFromFile`).
- PDF: texto pelo pdf.js que já vem na extensão (`finance/import-pdf.js`), até 40 páginas; título, autor e data dos metadados do PDF. PDF escaneado, com senha ou ilegível: só os dados, com aviso.
- Limites: lê arquivos até 50 MB; guarda até 60.000 caracteres de texto por fonte (`MAX_TEXT`), para não pesar a sincronização.

## Interface

- **Meu cérebro → 📚 Fontes:** filtros por tipo e projeto, ＋ Nova fonte, 📎 De um arquivo, contagem de itens ligados (🔗), projeto (📁) e "Links citados sem fonte" com ＋ Fonte.
- **Editor do item:** seção 📚 Fonte (tipo, autores, data, editora, projeto, DOI/ISBN, arquivo e itens ligados) nas fontes, páginas e mídias; nos outros itens, "Fonte deste item".
- **Apagar uma fonte** pede confirmação, diz quantos itens ligados continuam no cérebro e manda para a lixeira.

## Busca por significado

Opcional (Configurações → IA). Os metadados entram no texto indexado; como o índice guarda um hash do texto, fontes editadas são reindexadas sozinhas. "Reconstruir índice" refaz tudo.

## Backup e limites

O backup (Configurações → Backup) leva os itens do cérebro com `src` e `sourceId`. **Não leva os arquivos** (PDFs, vídeos, áudios): só os dados e o texto lido. Para restaurar o arquivo, guarde-o à parte; a fonte continua mostrando o nome dele.

## Testes

- `tests/unit/sources.test.js`: limpeza, tipos deduzidos, ligação por URL e `sourceId`, filtros, projetos, busca, links sem fonte, arquivos, criar/atualizar/remover.
- `tests/e2e/sources.test.js`: aba Fontes, filtros, busca pelo autor, link citado → fonte, sem duplicar, ligar nota, PDF com metadados, apagar com confirmação.
