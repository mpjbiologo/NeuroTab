# Mídia: sites, pastas e biblioteca (0.9.3.1, #45)

Levantamento de **onde e como** a NeuroTab baixa mídia, e o que fica de fora. A lista vive em `src/lib/media-sites.js` (`DL_SITES`, `DRM_HOSTS`) e, na Ponte, em `ponte/download.go` (`dlSites`); um teste unitário garante que as duas listas são iguais.

## Regras

1. **Só o que o site entrega sem proteção.** Nada de contornar DRM, paywall, controle de acesso ou login de outra pessoa.
2. **YouTube nunca** (política da Chrome Web Store, do Edge Add-ons e do AMO para extensões). Vale também para `music.youtube.com`.
3. **Serviços com DRM** (Netflix, Prime Video, Disney+, Max, Globoplay, Spotify, Deezer, Apple Music/TV, Tidal, Crunchyroll, Paramount+, Star+, Amazon Music, MUBI, Telecine, Pluto TV) são **recusados com aviso** (`code: 'drm'`), antes de qualquer pedido.
4. **Login:** só o seu, e só os cookies do site do próprio link (`cookieDomainsFor`), num arquivo temporário que a Ponte apaga logo depois.
5. **Uso pessoal:** a interface lembra de respeitar os direitos de quem criou.

## Compatibilidade

| Site | Vídeo | Só o áudio | Fotos do post | Sem a Ponte (navegador) | Como |
|---|---|---|---|---|---|
| Instagram | ✓ | ✓ (Ponte) | ✓ | quase sempre | `.mp4` da página (`video_versions`) ou yt-dlp; fotos em `image_versions2` / `carousel_media` |
| TikTok | ✓ | ✓ (Ponte) | ✓ | quase sempre | `.mp4` da página (`bitrateInfo`) ou yt-dlp; fotos em `imagePost.images` |
| X (Twitter) | ✓ | ✓ (Ponte) | ✓ | quase sempre | FixTweet (`api.fxtwitter.com`): `.mp4` e fotos em resolução original (`name=orig`) |
| Reddit, Facebook, Threads, Bluesky, Vimeo, Dailymotion, Twitch (clipes e vídeos), Kwai, Pinterest, LinkedIn, Rumble | ✓ | ✓ (Ponte) | — | só se a página tiver um `<video>` com arquivo direto | yt-dlp na Ponte (vídeo e áudio separados são juntados pelo ffmpeg) |
| SoundCloud | — | ✓ (Ponte) | — | não | yt-dlp, só faixas que o site toca sem assinatura |
| Arquivo direto em qualquer site https (`.mp4`, `.webm`, `.mp3`, `.m4a`, `.ogg`, `.wav`, `.flac`, `.jpg`, `.png`, `.webp`…) | ✓ | ✓ | ✓ | sim | `chrome.downloads`, sem Ponte |
| YouTube | ✗ | ✗ | ✗ | — | recusado (lojas) |
| Streaming com DRM | ✗ | ✗ | ✗ | — | recusado (DRM) |

**Limitações conhecidas** (lições do [Kora](https://github.com/Joaovitor12j/kora), de Joao V Santos, MIT):
- O Instagram muda com frequência e quase sempre pede login para o vídeo; carrosséis inteiros só aparecem com a página aberta e o login feito.
- O TikTok bloqueia clientes sem "impersonação"; o yt-dlp oficial para Windows já vem com o `curl_cffi`, e a Ponte atualiza o yt-dlp pelo botão Atualizar.
- Vídeos em pedaços (HLS/DASH, `blob:`) não têm arquivo direto: só a Ponte baixa.
- Sem ffmpeg, "só o áudio" fica no formato original do site (geralmente `.m4a` ou `.webm`), e vídeo com áudio separado cai para a melhor versão já junta.

## Pastas

| Tipo | Configuração (`settings.mediaDl`) | Padrão |
|---|---|---|
| Vídeo | `folder` | `NeuroTab` |
| Imagens (fotos dos posts e imagens da biblioteca) | `imageFolder` | `NeuroTab/Imagens` |
| Áudio | `audioFolder` | `NeuroTab/Áudios` |

- Sempre **dentro de Downloads**: o `chrome.downloads` não grava fora dela, e a Ponte confere com `inside()`. Para outro lugar: "Perguntar onde salvar" (vídeos pelo navegador) ou a pasta de downloads do próprio navegador.
- `byCategory` cria uma subpasta por categoria. `cleanFolder` limpa o caminho (sem `..`, até 3 níveis); `safeFileName` tira caracteres proibidos e nomes reservados do Windows.
- Nome repetido: `conflictAction: 'uniquify'` no navegador e `--no-overwrites` no yt-dlp — nada é apagado.
- Formato do áudio (`audioFormat`): `mp3`, `m4a` (convertidos pelo ffmpeg) ou `original`.

## Fluxo

- `downloadMedia(id, { what })` em `media-dl-run.js`, com `what` = `video` | `audio` | `photos`. O registro fica no item: `media.download`, `media.audio`, `media.photos` (`{ via, file | files, count, downloadId, at }`). O andamento fica em `nt_media_dl` (sessão), com a chave `dlKey(id, what)`.
- Páginas da extensão pedem as permissões no clique com `startMediaDownload` (`media-dl-client.js`), num pedido só.
- Ponte: `{"type":"dl","op":"get","payload":{…,"audio":true,"format":"mp3"}}` → `yt-dlp -f ba/b [-x --audio-format mp3]`.

## Biblioteca de mídias (`src/media.html`)

Imagens da biblioteca (IndexedDB), posts e vídeos salvos (itens 🎬 do cérebro) e o que foi baixado, numa tela só: abas Tudo / Imagens / Posts e vídeos / No computador, busca, categoria, salvar imagens no computador (uma ou várias), baixar vídeo/áudio/fotos, mostrar na pasta e apagar com confirmação. Abre pelo widget Biblioteca de imagens, pela janela de um item Mídia e por Configurações → Mídia.

## Testes

- `tests/unit/media-sites.test.js`: sites, YouTube, DRM, arquivos diretos, listas iguais na extensão e na Ponte, nomes seguros, pastas, fotos do X.
- `ponte/download_test.go` (`TestMoreSitesAndAudio`): sites novos, recusas e argumentos do áudio com e sem ffmpeg.
- `tests/e2e/media-library.test.js`: abas, busca, fotos de um post do TikTok na pasta das imagens, salvar imagem, excluir com confirmação, DRM.
- `tests/e2e/media-download.test.js`: só o áudio pela Ponte de verdade, na pasta dos áudios.
