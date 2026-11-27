package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const tok = "0123456789abcdef0123"

func mediaHub(t *testing.T) (*Hub, *httptest.Server, string) {
	t.Helper()
	dl := t.TempDir()
	t.Setenv("NEUROTAB_DOWNLOAD_DIR", dl)
	h := newHub(tok, "PC", nil)
	srv := httptest.NewServer(h.routes())
	t.Cleanup(srv.Close)
	return h, srv, dl
}

func get(t *testing.T, url string, hdr map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestServeFileRangeAndSafety(t *testing.T) {
	h, srv, dl := mediaHub(t)
	video := filepath.Join(dl, "NeuroTab", "aula.mp4")
	_ = os.MkdirAll(filepath.Dir(video), 0o755)
	_ = os.WriteFile(video, []byte("0123456789"), 0o644)
	if err := h.registerFile(hubFile{ID: "v1", Name: "aula.mp4", Mime: "video/mp4", Path: video}); err != nil {
		t.Fatal(err)
	}
	// fora de Downloads: recusado
	outside := filepath.Join(t.TempDir(), "senha.txt")
	_ = os.WriteFile(outside, []byte("x"), 0o644)
	if err := h.registerFile(hubFile{ID: "x", Name: "senha.txt", Path: outside}); err == nil {
		t.Fatal("arquivo fora de Downloads não pode ser registrado")
	}
	if err := h.registerFile(hubFile{ID: "y", Name: "a", Path: filepath.Join(dl, "..", "fora.txt")}); err == nil {
		t.Fatal("caminho com .. não pode")
	}
	// sem token
	if r := get(t, srv.URL+"/api/file/v1", nil); r.StatusCode != 401 {
		t.Fatalf("sem token: %d", r.StatusCode)
	}
	// não registrado
	if r := get(t, srv.URL+"/api/file/nada?t="+tok, nil); r.StatusCode != 404 {
		t.Fatalf("não registrado: %d", r.StatusCode)
	}
	// Range (o vídeo toca enquanto baixa)
	r := get(t, srv.URL+"/api/file/v1?t="+tok, map[string]string{"Range": "bytes=2-5"})
	b, _ := io.ReadAll(r.Body)
	if r.StatusCode != 206 || string(b) != "2345" || r.Header.Get("Content-Type") != "video/mp4" {
		t.Fatalf("range: %d %q %s", r.StatusCode, b, r.Header.Get("Content-Type"))
	}
	if r.Header.Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(r.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("faltam cabeçalhos de segurança")
	}
	// HTML nunca é servido como página
	_ = h.registerFile(hubFile{ID: "h1", Name: "x.html", Mime: "text/html", Data: []byte("<script>alert(1)</script>")})
	r = get(t, srv.URL+"/api/file/h1", map[string]string{"X-NT-Token": tok})
	if r.Header.Get("Content-Type") != "application/octet-stream" || !strings.HasPrefix(r.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("html: %s %s", r.Header.Get("Content-Type"), r.Header.Get("Content-Disposition"))
	}
	// ?dl=1 baixa
	r = get(t, srv.URL+"/api/file/v1?dl=1&t="+tok, nil)
	if !strings.HasPrefix(r.Header.Get("Content-Disposition"), "attachment") {
		t.Fatal("dl=1 devia baixar")
	}
}

func TestRegisterFromMsgLimits(t *testing.T) {
	h, _, _ := mediaHub(t)
	raw, _ := json.Marshal(fileMsg{ID: "img", Name: "foto.png", Mime: "image/png", Data: base64.StdEncoding.EncodeToString([]byte("PNG"))})
	if err := h.registerFromMsg(raw); err != nil {
		t.Fatal(err)
	}
	if f := h.file("img"); f == nil || f.Size != 3 || f.Mime != "image/png" {
		t.Fatalf("%+v", f)
	}
	for i := 0; i < maxFiles+5; i++ {
		_ = h.registerFile(hubFile{ID: "n" + string(rune('a'+i%26)) + strings.Repeat("x", i), Name: "a.png", Data: []byte("x")})
	}
	if len(h.files) > maxFiles {
		t.Fatalf("limite de arquivos: %d", len(h.files))
	}
}

func TestUploadFromPhone(t *testing.T) {
	var got []string
	h, srv, dl := mediaHub(t)
	h.uploaded = func(p json.RawMessage, path string) { got = append(got, path) }
	up := func(name, ct, body string) *http.Response {
		req, _ := http.NewRequest("POST", srv.URL+"/api/upload", strings.NewReader(body))
		req.Header.Set("X-NT-Token", tok)
		req.Header.Set("X-NT-Name", name)
		req.Header.Set("X-NT-From-Name", "Celular%20da%20Ana")
		req.Header.Set("Content-Type", ct)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	if r := up("f%C3%A9rias.jpg", "image/jpeg", "JPG1"); r.StatusCode != 200 {
		t.Fatalf("upload: %d", r.StatusCode)
	}
	if r := up("f%C3%A9rias.jpg", "image/jpeg", "JPG2"); r.StatusCode != 200 {
		t.Fatalf("upload 2: %d", r.StatusCode)
	}
	if r := up("..%2F..%2Fsegredo", "video/mp4", "MP4"); r.StatusCode != 200 {
		t.Fatalf("upload 3: %d", r.StatusCode)
	}
	dir := filepath.Join(dl, "NeuroTab", "Do celular")
	a, _ := os.ReadFile(filepath.Join(dir, "férias.jpg"))
	b, _ := os.ReadFile(filepath.Join(dir, "férias (1).jpg"))
	if string(a) != "JPG1" || string(b) != "JPG2" {
		t.Fatalf("não pode substituir: %q %q", a, b)
	}
	if len(got) != 3 || !inside(dir, got[2]) || !strings.HasSuffix(got[2], ".mp4") {
		t.Fatalf("caminhos: %v", got)
	}
	// o celular vê o que mandou, com o arquivo para abrir
	h.mu.Lock()
	var p struct {
		Kind  string            `json:"kind"`
		From  map[string]string `json:"from"`
		Files []hubFile         `json:"files"`
	}
	_ = json.Unmarshal(h.items[0], &p)
	h.mu.Unlock()
	if p.Kind != "media" || p.From["name"] != "Celular da Ana" || len(p.Files) != 1 || p.Files[0].Mime != "video/mp4" {
		t.Fatalf("payload: %+v", p)
	}
	if r := get(t, srv.URL+"/api/file/"+p.Files[0].ID+"?t="+tok, nil); r.StatusCode != 200 {
		t.Fatalf("arquivo enviado: %d", r.StatusCode)
	}
	// sem token e grande demais
	req, _ := http.NewRequest("POST", srv.URL+"/api/upload", strings.NewReader("x"))
	if r, _ := http.DefaultClient.Do(req); r.StatusCode != 401 {
		t.Fatalf("sem token: %d", r.StatusCode)
	}
	req, _ = http.NewRequest("POST", srv.URL+"/api/upload", strings.NewReader("x"))
	req.Header.Set("X-NT-Token", tok)
	req.ContentLength = maxUpload + 1
	if r, err := http.DefaultClient.Do(req); err == nil && r.StatusCode != 413 {
		t.Fatalf("grande demais: %d", r.StatusCode)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 3 {
		t.Fatalf("sobrou arquivo temporário: %d", len(entries))
	}
}

func TestReadForExt(t *testing.T) {
	dl := t.TempDir()
	t.Setenv("NEUROTAB_DOWNLOAD_DIR", dl)
	p := filepath.Join(dl, "NeuroTab", "big.bin")
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	data := []byte(strings.Repeat("abc", readChunk/2))
	_ = os.WriteFile(p, data, 0o644)
	var out []byte
	var done bool
	err := readForExt(dlReq{Path: p}, func(v any) error {
		m := v.(map[string]any)
		if m["stage"] == "chunk" {
			b, _ := base64.StdEncoding.DecodeString(m["data"].(string))
			out = append(out, b...)
		} else if m["stage"] == "done" {
			done = true
		}
		return nil
	})
	if err != nil || !done || string(out) != string(data) {
		t.Fatalf("leitura: %v %v %d/%d", err, done, len(out), len(data))
	}
	if err := readForExt(dlReq{Path: p, Max: 10}, func(any) error { return nil }); err == nil {
		t.Fatal("max devia recusar")
	}
	if err := readForExt(dlReq{Path: "/etc/passwd"}, func(any) error { return nil }); err == nil {
		t.Fatal("fora de Downloads devia recusar")
	}
}
