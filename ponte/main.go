// NeuroTab Ponte — leva a área de transferência da NeuroTab para o celular pela rede local (0.7.7.2).
//
// Dois jeitos de rodar:
//   - aberto pela pessoa (duplo clique / terminal): instala e registra no Chrome, Edge, Brave, Chromium e Firefox;
//   - aberto pelo navegador (native messaging): abre um servidor no Wi-Fi com a página do celular, protegido pelo
//     token que a extensão gerou, e fecha sozinho quando o navegador fecha.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

var version = "dev" // preenchido na compilação (-ldflags "-X main.version=…")

const hostName = "com.neurotab.ponte"

func main() {
	args := os.Args[1:]
	if isNative(args) {
		if err := runNative(os.Stdin, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, "neurotab-ponte:", err)
			os.Exit(1)
		}
		return
	}
	os.Exit(runInstaller(args))
}

// O Chrome/Edge chamam com "chrome-extension://…/"; o Firefox com o caminho do manifesto e o id da extensão.
func isNative(args []string) bool {
	for _, a := range args {
		if strings.HasPrefix(a, "chrome-extension://") || strings.HasSuffix(a, ".json") || a == geckoID {
			return true
		}
	}
	return false
}

func runNative(in *os.File, out *os.File) error {
	w := &writer{w: out}
	r := bufio.NewReader(in)
	first, err := readMsg(r)
	if err != nil {
		return err
	}
	if first.Type != "hello" || len(first.Token) < 16 {
		_ = w.send(Msg{Type: "error", Message: "a extensão não mandou o token"})
		return fmt.Errorf("sem hello")
	}
	port := first.Port
	if port < 1024 || port > 65535 {
		port = 41414
	}
	hub := newHub(first.Token, first.Name, func(p json.RawMessage) { _ = w.send(Msg{Type: "incoming", Payload: p}) })
	l, real, err := listen(port)
	if err != nil {
		_ = w.send(Msg{Type: "error", Message: "não consegui abrir a porta " + fmt.Sprint(port) + ": " + err.Error()})
		return err
	}
	srv := &http.Server{Handler: hub.routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(l) }()
	_ = w.send(Msg{Type: "ready", URLs: lanURLs(real), Port: real, Version: version})
	for {
		m, err := readMsg(r)
		if err != nil { // navegador fechou a conexão
			_ = srv.Close()
			return nil
		}
		switch m.Type {
		case "item":
			if len(m.Payload) > 0 {
				hub.add(m.Payload)
			}
		case "bye":
			_ = srv.Close()
			return nil
		}
	}
}
