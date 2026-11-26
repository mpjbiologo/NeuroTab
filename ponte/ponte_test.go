package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func frame(t *testing.T, m Msg) []byte {
	b, _ := json.Marshal(m)
	var buf bytes.Buffer
	_ = binary.Write(&buf, binary.LittleEndian, uint32(len(b)))
	buf.Write(b)
	return buf.Bytes()
}

func TestFraming(t *testing.T) {
	var out bytes.Buffer
	w := &writer{w: &out}
	if err := w.send(Msg{Type: "ready", URLs: []string{"http://192.168.0.2:41414"}, Port: 41414}); err != nil {
		t.Fatal(err)
	}
	m, err := readMsg(&out)
	if err != nil || m.Type != "ready" || m.Port != 41414 || m.URLs[0] != "http://192.168.0.2:41414" {
		t.Fatalf("ida e volta: %+v %v", m, err)
	}
	// tamanho absurdo é recusado
	var bad bytes.Buffer
	_ = binary.Write(&bad, binary.LittleEndian, uint32(maxIn+1))
	if _, err := readMsg(&bad); err == nil {
		t.Fatal("devia recusar mensagem grande demais")
	}
}

func TestIsNative(t *testing.T) {
	cases := map[string]bool{"chrome-extension://abc/": true, "/x/com.neurotab.ponte.json": true, geckoID: true, "--uninstall": false, "": false}
	for a, want := range cases {
		if got := isNative([]string{a}); got != want {
			t.Errorf("%q: %v", a, got)
		}
	}
	if isNative(nil) {
		t.Error("sem argumentos = instalador")
	}
}

func TestServer(t *testing.T) {
	var got []json.RawMessage
	h := newHub("token-de-teste-1234567890", "Notebook", func(p json.RawMessage) { got = append(got, p) })
	srv := httptest.NewServer(h.routes())
	defer srv.Close()

	// página abre sem token; a API não
	r, _ := http.Get(srv.URL + "/")
	if r.StatusCode != 200 || !strings.Contains(r.Header.Get("Content-Type"), "text/html") {
		t.Fatal("página")
	}
	for _, tok := range []string{"", "errado", "token-de-teste-123456789X"} {
		req, _ := http.NewRequest("GET", srv.URL+"/api/items", nil)
		req.Header.Set("X-NT-Token", tok)
		r, _ := http.DefaultClient.Do(req)
		if r.StatusCode != 401 {
			t.Fatalf("token %q devia ser recusado: %d", tok, r.StatusCode)
		}
	}

	// ao vivo
	req, _ := http.NewRequest("GET", srv.URL+"/api/events?t=token-de-teste-1234567890", nil)
	ev, err := http.DefaultClient.Do(req)
	if err != nil || ev.StatusCode != 200 {
		t.Fatal("events", err)
	}
	defer ev.Body.Close()
	lines := make(chan string, 10)
	go func() {
		s := bufio.NewScanner(ev.Body)
		for s.Scan() {
			if strings.HasPrefix(s.Text(), "data: ") {
				lines <- s.Text()
			}
		}
	}()
	time.Sleep(100 * time.Millisecond)

	// o computador manda um item
	h.add(json.RawMessage(`{"v":1,"id":"pc1","at":1,"from":{"id":"pc","name":"Notebook"},"text":"do computador"}`))
	// o celular manda outro
	body := `{"text":"do celular","from":{"id":"cel-1","name":"Celular"}}`
	req, _ = http.NewRequest("POST", srv.URL+"/api/send", strings.NewReader(body))
	req.Header.Set("X-NT-Token", "token-de-teste-1234567890")
	r, _ = http.DefaultClient.Do(req)
	if r.StatusCode != 200 {
		t.Fatal("send", r.StatusCode)
	}
	if len(got) != 1 || !strings.Contains(string(got[0]), `"do celular"`) || !strings.Contains(string(got[0]), `"id":"lan-`) {
		t.Fatalf("chegou na extensão: %s", got)
	}
	// vazio é recusado
	req, _ = http.NewRequest("POST", srv.URL+"/api/send", strings.NewReader(`{"text":"  "}`))
	req.Header.Set("X-NT-Token", "token-de-teste-1234567890")
	r, _ = http.DefaultClient.Do(req)
	if r.StatusCode != 400 {
		t.Fatal("vazio", r.StatusCode)
	}

	for i := 0; i < 2; i++ {
		select {
		case <-lines:
		case <-time.After(2 * time.Second):
			t.Fatal("ao vivo não chegou")
		}
	}
	// lista: mais novo primeiro, com o nome do computador
	req, _ = http.NewRequest("GET", srv.URL+"/api/items", nil)
	req.Header.Set("X-NT-Token", "token-de-teste-1234567890")
	r, _ = http.DefaultClient.Do(req)
	var list struct {
		Name  string
		Items []Payload
	}
	_ = json.NewDecoder(r.Body).Decode(&list)
	if list.Name != "Notebook" || len(list.Items) != 2 || list.Items[0].Text != "do celular" {
		t.Fatalf("lista: %+v", list)
	}
	// limite de itens
	for i := 0; i < keep+10; i++ {
		h.add(json.RawMessage(`{"id":"x"}`))
	}
	if len(h.items) != keep {
		t.Fatal("limite", len(h.items))
	}
}

func TestNativeSession(t *testing.T) {
	pr, pw := io.Pipe()
	outR, outW, _ := os.Pipe()
	inR, inW, _ := os.Pipe()
	_ = pr
	_ = pw
	done := make(chan error, 1)
	go func() { done <- runNative(inR, outW) }()
	// hello sem token é recusado em outra sessão; aqui manda certo
	_, _ = inW.Write(frame(t, Msg{Type: "hello", Token: "token-de-teste-1234567890", Port: 47123, Name: "PC"}))
	m, err := readMsg(outR)
	if err != nil || m.Type != "ready" || m.Port < 47123 {
		t.Fatalf("ready: %+v %v", m, err)
	}
	_, _ = inW.Write(frame(t, Msg{Type: "item", Payload: json.RawMessage(`{"v":1,"id":"a","text":"oi"}`)}))
	time.Sleep(100 * time.Millisecond)
	req, _ := http.NewRequest("GET", "http://127.0.0.1:"+itoa(m.Port)+"/api/items", nil)
	req.Header.Set("X-NT-Token", "token-de-teste-1234567890")
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var list struct{ Items []Payload }
	_ = json.NewDecoder(r.Body).Decode(&list)
	if len(list.Items) != 1 || list.Items[0].Text != "oi" {
		t.Fatalf("item do PC na lista: %+v", list)
	}
	inW.Close() // navegador fechou
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("não fechou com o navegador")
	}
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestInstallLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("teste do instalador no Linux")
	}
	home := t.TempDir()
	_ = os.MkdirAll(filepath.Join(home, ".config", "google-chrome"), 0o755)
	_ = os.MkdirAll(filepath.Join(home, ".mozilla"), 0o755)
	self := filepath.Join(t.TempDir(), "ponte")
	_ = os.WriteFile(self, []byte("binario"), 0o755)
	done, err := install(home, self, []string{"devid123"}, func(string, ...string) error { return nil })
	if err != nil || strings.Join(done, ",") != "Chrome,Firefox" {
		t.Fatalf("instalou em %v (%v)", done, err)
	}
	var cm, fm map[string]any
	b, _ := os.ReadFile(filepath.Join(home, ".config", "google-chrome", "NativeMessagingHosts", hostName+".json"))
	_ = json.Unmarshal(b, &cm)
	b, _ = os.ReadFile(filepath.Join(home, ".mozilla", "native-messaging-hosts", hostName+".json"))
	_ = json.Unmarshal(b, &fm)
	if cm["path"] != filepath.Join(home, ".local", "share", "neurotab", "neurotab-ponte") || !strings.Contains(string(mustJSON(cm["allowed_origins"])), "chrome-extension://devid123/") {
		t.Fatalf("manifesto chromium: %v", cm)
	}
	if !strings.Contains(string(mustJSON(fm["allowed_extensions"])), geckoID) {
		t.Fatalf("manifesto firefox: %v", fm)
	}
	if b, _ := os.ReadFile(cm["path"].(string)); string(b) != "binario" {
		t.Fatal("programa não foi copiado")
	}
	uninstall(home, func(string, ...string) error { return nil })
	if _, err := os.Stat(filepath.Join(home, ".mozilla", "native-messaging-hosts", hostName+".json")); err == nil {
		t.Fatal("desinstalar devia remover")
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func TestRankAddrs(t *testing.T) {
	ip := func(s string) net.IP { return net.ParseIP(s) }
	cands := []addrCand{
		{IP: ip("172.16.0.2"), Iface: "CloudflareWARP", HW: false},
		{IP: ip("172.24.80.1"), Iface: "vEthernet (WSL)", HW: true},
		{IP: ip("192.168.1.2"), Iface: "Wi-Fi", HW: true},
		{IP: ip("192.168.56.1"), Iface: "VirtualBox Host-Only Network", HW: true},
		{IP: ip("8.8.8.8"), Iface: "Wi-Fi", HW: true},
		{IP: ip("192.168.1.2"), Iface: "Wi-Fi", HW: true},
	}
	got := rankAddrs(cands, 41414, "172.16.0.2")
	if len(got) != 4 {
		t.Fatalf("esperava 4 endereços privados sem repetir, veio %d: %+v", len(got), got)
	}
	if got[0].URL != "http://192.168.1.2:41414" || got[0].Virtual {
		t.Fatalf("o Wi-Fi tem de vir primeiro: %+v", got)
	}
	for _, a := range got[1:] {
		if !a.Virtual {
			t.Fatalf("%s devia ser marcado como virtual", a.Iface)
		}
	}
	eth := rankAddrs([]addrCand{{IP: ip("10.0.0.5"), Iface: "eth0", HW: true}, {IP: ip("172.17.0.1"), Iface: "docker0", HW: true}}, 1, "")
	if eth[0].Iface != "eth0" {
		t.Fatalf("Ethernet antes do Docker: %+v", eth)
	}
}

func TestProfilesAndFirewall(t *testing.T) {
	p := parseProfiles("Wi-Fi|Public\r\nEthernet|Private\r\n")
	a := []LanAddr{{Iface: "Wi-Fi"}, {Iface: "Ethernet"}}
	markPublic(a, p)
	if !a[0].PublicNet || a[1].PublicNet {
		t.Fatalf("perfil da rede: %+v", a)
	}
	s := firewallScript(`C:\Users\M\AppData\Local\NeuroTab\neurotab-ponte.exe`)
	for _, want := range []string{`program="C:\Users\M\AppData\Local\NeuroTab\neurotab-ponte.exe"`, "profile=private,domain", "localport=41414-41423", "delete rule name=all"} {
		if !strings.Contains(s, want) {
			t.Fatalf("faltou %q em:\n%s", want, s)
		}
	}
}
