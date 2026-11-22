# Widget Rede e "Salvar mídia" (0.7.9)

## Widget Rede (#52) — `src/widgets/network.js`
- **Medições pelo navegador** (`src/lib/net.js`, puras e testadas com `fetch` simulado):
  - velocidade pelos endpoints da Cloudflare (`/__down?bytes=N`, `/__up`), percentil 90 das transferências ≥ 1 MB;
  - latência por HTTP (a 1ª amostra abre a conexão e é descartada), jitter = média das variações seguidas;
  - DNS seguro (RFC 8484, mensagem montada em `dnsQuery`).
- **Servidor próprio:** qualquer HTTPS com as mesmas rotas. Permissões: recurso `network` em `lib/permissions.js`; endereços próprios são pedidos sob demanda (`https://*/*` opcional).
- **NeuroTab Ponte** (`src/lib/net-ponte.js` → `ponte/netdiag.go`): `chrome.runtime.sendNativeMessage(..., {type:'net', op})` com `info`, `ping`, `dns`, `devices`, `procs`, `usage`. Cada pedido abre a Ponte, responde e fecha. Ponte antiga (sem `net`) → aviso para atualizar.
- **Monitor:** na aba, a cada `monitor.every` s; em segundo plano (alarme `netmon`, 1/min) só com `monitor.background`. Aviso de travada no máximo a cada 10 min.
- **Dados:** `nt_net` (testes, amostras, nomes dos aparelhos, último DNS), só local.

## Salvar mídia (#67)
Adaptado do [Kora](https://github.com/Joaovitor12j/kora) (MIT, Joao V Santos). Créditos em `THIRD-PARTY-NOTICES.md` e em Configurações → Sistema → Sobre e créditos.

| Arquivo | Papel |
|---|---|
| `src/lib/media-links.js` | extrair, reconhecer a plataforma e padronizar links (porte de `urls.py`, mesmos casos de teste) |
| `src/lib/media.js` | categorias, pedido à IA, validação da resposta, item do cérebro, FixTweet, nota do Obsidian |
| `src/lib/media-extract.js` | função injetada na página (mundo MAIN): YouTube (player + legendas json3), Instagram (og:tags), TikTok (`__UNIVERSAL_DATA_FOR_REHYDRATION__` + legendas VTT), X (DOM), artigos (maior bloco de parágrafos + ld+json) |
| `src/lib/media-save.js` | fluxo no service worker: ler (aba aberta, aba escondida para links com permissão, ou FixTweet), deduplicar pela URL padronizada, salvar item `type: 'media'` e resumir |
| `src/newtab/media-panel.js` | detalhes na janela do item (categoria, pontos-chave, Resumir/Reprocessar, .md) |
| `src/options-media.js` | Configurações → Mídia → Salvar mídia e a página Sobre e créditos |

- **Item:** `type: 'media'` com `media = { platform, author, published, caption, content, contentType, duration, points, category, status: 'pendente'|'processado', error, ai }`. O `text` junta legenda e conteúdo para a busca e as perguntas.
- **IA:** local resume na hora; na internet, só com `settings.mediaSave.cloudOK` ou autorização no botão (`media:summarize` com `allowCloud`). Sem autorização, `error: 'cloud'`.
- **Categorias:** guardadas em `mediaSave.categoryList` (pares), porque o armazenamento do navegador reordena as chaves de objetos.
- **Mensagens:** `media:save` (`{ url }` ou `{ tabId }`) e `media:summarize`.
