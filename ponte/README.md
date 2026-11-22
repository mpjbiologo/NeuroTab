# NeuroTab Ponte

Programinha opcional que leva a **área de transferência da NeuroTab** para o celular pela **rede local** (mesmo Wi-Fi), sem internet e sem conta, e faz o **diagnóstico de rede** do widget Rede (0.7.9): ping de verdade (roteador e internet), DNS clássico por UDP (inclusive o da operadora), aparelhos na rede local (tabela ARP, com varredura opcional da /24), programas com conexões abertas e o uso total da placa de rede.

No diagnóstico, cada pedido chega por native messaging (`{"type":"net","op":"info|ping|dns|devices|procs|usage"}`), é respondido e o programa fecha. Usa só comandos do sistema (`ping`, `arp`, `ss`/`lsof`/PowerShell) com endereços validados; nada sai do computador além dos próprios pings e consultas de DNS.

- **Instalar:** baixe o arquivo do seu sistema na [última release](https://github.com/mpjbiologo/NeuroTab/releases/latest) e abra (no macOS/Linux, `chmod +x` antes). Ele se copia para uma pasta da NeuroTab e se registra no Chrome, Edge, Chromium, Brave e Firefox.
- **Usar:** na NeuroTab, widget Área de transferência → 📤 → ligue **Rede local** e salve. O navegador abre a Ponte sozinho quando precisa; o QR "Abrir no celular" leva o celular à página.
- **Remover:** rode o programa com `--uninstall`.
- **Desenvolvimento:** `--extension-id=ID` libera uma extensão carregada sem empacotar.

Segurança: a página e a API ficam só na rede local, protegidas por um código de acesso de 192 bits que vai no QR. A conexão na rede local é HTTP simples: use em redes de confiança.

Compilar: `go build .` · Testar: `go test ./...` (detalhes em `docs/dev/AREA-DE-TRANSFERENCIA.md`).
