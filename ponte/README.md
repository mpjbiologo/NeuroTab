# NeuroTab Ponte

Programinha opcional que leva a **área de transferência da NeuroTab** para o celular pela **rede local** (mesmo Wi-Fi), sem internet e sem conta, e faz o **diagnóstico de rede** do widget Rede (0.7.9): ping de verdade (roteador e internet), DNS clássico por UDP (inclusive o da operadora), aparelhos na rede local (tabela ARP, com varredura opcional da /24), programas com conexões abertas e o uso total da placa de rede.

Desde a 0.7.10, alimenta também o **widget Sistema** (`{"type":"sys","op":"snapshot|stream"}`): uso do processador (total e por núcleo), memória e troca, discos, bateria, programas que mais gastam e temperaturas (Linux pelo `hwmon`; NVIDIA pelo `nvidia-smi`). No modo `stream` a Ponte fica aberta mandando uma leitura a cada intervalo até a extensão fechar a conexão. No Windows as temperaturas não ficam acessíveis a programas comuns: o widget as lê do LibreHardwareMonitor.

Desde a 0.7.11, **baixa vídeos da Mídia** (`{"type":"dl","op":"tools|install|get|reveal"}`): roda o [yt-dlp](https://github.com/yt-dlp/yt-dlp) (e o ffmpeg, para juntar áudio e vídeo) só para endereços `https` do Instagram, do TikTok e do X — o YouTube é recusado — e grava em `Downloads/<pasta escolhida>`. Os argumentos são montados sem shell, com o endereço depois de `--`. Os cookies do site, quando a pessoa permite, vão num arquivo temporário (0600) apagado no fim. `install` baixa o yt-dlp (todos os sistemas) e o ffmpeg (Windows) das releases oficiais no GitHub para a pasta de cache do usuário (`neurotab-ponte/bin`) e só grava se o SHA-256 bater com a lista de somas da mesma release. `reveal` só abre arquivos dentro da pasta Downloads. Fechar a conexão cancela o download.

No diagnóstico, cada pedido chega por native messaging (`{"type":"net","op":"info|ping|dns|devices|procs|usage"}`), é respondido e o programa fecha. Usa só comandos do sistema (`ping`, `arp`, `ss`/`lsof`/PowerShell) com endereços validados; nada sai do computador além dos próprios pings e consultas de DNS.

- **Instalar:** baixe o arquivo do seu sistema na [última release](https://github.com/mpjbiologo/NeuroTab/releases/latest) e abra (no macOS/Linux, `chmod +x` antes). Ele se copia para uma pasta da NeuroTab e se registra no Chrome, Edge, Chromium, Brave e Firefox.
- **Usar:** na NeuroTab, widget Área de transferência → 📤 → ligue **Rede local** e salve. O navegador abre a Ponte sozinho quando precisa; o QR "Abrir no celular" leva o celular à página.
- **Remover:** rode o programa com `--uninstall`.
- **Desenvolvimento:** `--extension-id=ID` libera uma extensão carregada sem empacotar.

Segurança: a página e a API ficam só na rede local, protegidas por um código de acesso de 192 bits que vai no QR. A conexão na rede local é HTTP simples: use em redes de confiança.

Compilar: `go build .` · Testar: `go test ./...` (detalhes em `docs/dev/AREA-DE-TRANSFERENCIA.md`).
