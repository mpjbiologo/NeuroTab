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

## Widget Sistema (0.7.10) — `src/widgets/system.js`
- **Fontes**, juntadas por `mergeSys` (`src/lib/sysinfo.js`, puro e testado): Ponte > LibreHardwareMonitor (temperaturas, GPU, discos) > navegador (`chrome.system.cpu/memory`, só Chromium). `v.sources` diz quais responderam.
- **Ponte** (`src/lib/sys-ponte.js` → `ponte/sys*.go`): `connectNative` com `{type:'sys', op:'stream', payload:{interval, procs}}`; a Ponte manda um `SysSnap` a cada intervalo até a porta fechar (`op:'snapshot'` responde uma vez). Leitores sem dependências: `/proc` + `hwmon`/`thermal_zone` (Linux), `sysctl`/`vm_stat`/`pmset`/`ps` (macOS), `kernel32` + PowerShell (Windows); GPU NVIDIA por `nvidia-smi`. `notes` explica o que falta (`temp-windows`, `temp-mac`).
- **LibreHardwareMonitor:** `GET <url>/data.json` (só `http://localhost`/`127.0.0.1`, permissão pedida para a origem), lido por `parseLhm`.
- **Ciclo:** só com o widget visível (IntersectionObserver) e a aba visível; para tudo ao sair. Gráficos com os últimos 150 pontos, em memória.
- **Alertas:** `evalAlerts` (memória só depois de 60 s acima); notificações no máximo 1 por tipo a cada 15 min (`nt_sys_alerted` em `storage.session`).
- **Configuração:** `settings.system` (`sanitizeSys`).

## Baixar vídeos da Mídia (0.7.11)
- **Puro e testado:** `src/lib/media-download.js` — configuração (`settings.mediaDl`), `canDownload` (só instagram/tiktok/x; YouTube nunca), `dlTarget` (pasta/nome), `pickFxVideo` (FixTweet), `netscapeCookies`, e `findVideoInPage` (roda na página: TikTok `bitrateInfo`/`playAddr`; Instagram `video_versions` mais perto do id do post; `<video>` com src http).
- **Fluxo** (`src/lib/media-dl-run.js`, no service worker): acha o .mp4 direto (aba informada → aba já aberta com o post → aba escondida) e baixa com `chrome.downloads` (andamento por `downloads.search`); se não der e o modo permitir, NeuroTab Ponte (`connectNative`, `{type:'dl', op:'get'}`), com os cookies do site quando permitido. Andamento em `storage.session` (`nt_media_dl`); resultado em `item.media.download` (`via`, `file`, `downloadId`).
- **Ponte** (`ponte/download.go`): `tools`, `install` (SHA-256 da mesma release), `get` (yt-dlp com `--progress-template`/`--print after_move:filepath`), `reveal` (só dentro de Downloads). Testes com um yt-dlp de mentira (`download_test.go` e `tests/e2e/media-download.test.js`).
- **Permissões:** `downloads` e `cookies` opcionais; origens `https://*.instagram.com/*` etc. (o login fica em `.instagram.com`, fora de `www`).

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
