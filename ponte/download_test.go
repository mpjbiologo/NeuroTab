package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestAllowedURL(t *testing.T) {
	ok := []string{"https://www.instagram.com/reel/ABC/", "https://www.tiktok.com/@a/video/1", "https://vm.tiktok.com/ZM1/", "https://x.com/a/status/1", "https://twitter.com/a/status/1"}
	for _, u := range ok {
		if _, _, err := allowedURL(u); err != nil {
			t.Errorf("%s: %v", u, err)
		}
	}
	for u, code := range map[string]string{
		"https://www.youtube.com/watch?v=1": "youtube", "https://youtu.be/1": "youtube", "https://m.youtube.com/shorts/1": "youtube",
		"http://www.instagram.com/reel/A": "site", "https://evil.com/x.com": "site", "https://instagram.com.evil.com/a": "site", "file:///etc/passwd": "site", "": "site",
	} {
		_, c, err := allowedURL(u)
		if err == nil || c != code {
			t.Errorf("%q: esperava %s, veio %q (%v)", u, code, c, err)
		}
	}
}

func TestSafePaths(t *testing.T) {
	if got := safeRel("../../etc/NeuroTab/ia"); got != filepath.Join("etc", "NeuroTab", "ia") {
		t.Errorf("safeRel: %q", got)
	}
	if got := safeRel(`C:\Windows\..\x`); got != filepath.Join("C", "Windows", "x") {
		t.Errorf("safeRel windows: %q", got)
	}
	if safeRel("") != "NeuroTab" || safeRel("../..") != "NeuroTab" {
		t.Error("safeRel vazio")
	}
	if got := safeName(`a/b:c*?"<>|.`); got != "a b c" {
		t.Errorf("safeName: %q", got)
	}
	if safeName("...") != "video" {
		t.Error("safeName vazio")
	}
	root := t.TempDir()
	if !inside(root, filepath.Join(root, "NeuroTab", "a.mp4")) || inside(root, filepath.Join(root, "..", "x")) || inside(root, root) {
		t.Error("inside")
	}
	if d := parseUserDirs("# c\nXDG_DOWNLOAD_DIR=\"$HOME/Baixados\"\n", "/home/m"); d != "/home/m/Baixados" {
		t.Errorf("user-dirs: %q", d)
	}
}

func TestParseLineAndFormat(t *testing.T) {
	ev, ok := parseLine("NTP  45.3%|  12.34MiB|NA")
	if !ok || ev.Stage != "download" || ev.Pct != 45.3 || ev.Size != "12.34MiB" {
		t.Errorf("progresso: %+v", ev)
	}
	ev, _ = parseLine("NTP   3.0%|NA|~ 80.00MiB")
	if ev.Size != " 80.00MiB" && ev.Size != "80.00MiB" {
		t.Errorf("estimado: %+v", ev)
	}
	ev, ok = parseLine("NTF /tmp/a b.mp4")
	if !ok || ev.Stage != "done" || ev.File != "/tmp/a b.mp4" {
		t.Errorf("arquivo: %+v", ev)
	}
	if ev, ok := parseLine("[Merger] Merging formats into x.mp4"); !ok || ev.Stage != "merge" {
		t.Error("merge")
	}
	if _, ok := parseLine("[instagram] Extracting URL"); ok {
		t.Error("linha comum")
	}
	if formatFor("best", true) != "bv*+ba/b" || formatFor("720", true) != "bv*[height<=720]+ba/b[height<=720]/b" || formatFor("480", false) != "b[height<=480]/b" || formatFor("x", false) != "b" {
		t.Error("formato")
	}
	args := ytdlpArgs(dlReq{URL: "https://x.com/a/status/1", Name: "../evil", Quality: "best"}, "/d", "", "")
	if args[len(args)-2] != "--" || args[len(args)-1] != "https://x.com/a/status/1" {
		t.Errorf("url depois de --: %v", args)
	}
	for i, a := range args {
		if a == "-o" && strings.Contains(args[i+1], "..") {
			t.Errorf("nome com ..: %s", args[i+1])
		}
	}
	if errCode("ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required") != "login" {
		t.Error("errCode login")
	}
}

func TestFetchVerified(t *testing.T) {
	body := []byte("programa de verdade")
	sum := sha256.Sum256(body)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/SHA2-256SUMS":
			w.Write([]byte(hex.EncodeToString(sum[:]) + "  yt-dlp_linux\n" + strings.Repeat("0", 64) + "  falso\n"))
		case "/yt-dlp_linux", "/falso":
			w.Write(body)
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	got, err := fetchVerified(context.Background(), srv.URL+"/", "yt-dlp_linux", "SHA2-256SUMS", nil)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("válido: %v", err)
	}
	if _, err := fetchVerified(context.Background(), srv.URL+"/", "falso", "SHA2-256SUMS", nil); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Errorf("hash errado devia falhar: %v", err)
	}
	if _, err := fetchVerified(context.Background(), srv.URL+"/", "outro", "SHA2-256SUMS", nil); err == nil {
		t.Error("sem soma devia falhar")
	}
	if parseSums("abc  x\n", "x") != "" {
		t.Error("hash curto")
	}
}

func TestInstallFfmpegZip(t *testing.T) {
	if ffmpegAsset() == "" {
		t.Skip("instalação automática do ffmpeg só no Windows")
	}
	var zb bytes.Buffer
	zw := zip.NewWriter(&zb)
	f, _ := zw.Create("ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe")
	f.Write([]byte("ff"))
	zw.Close()
	sum := sha256.Sum256(zb.Bytes())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "checksums.sha256") {
			w.Write([]byte(hex.EncodeToString(sum[:]) + "  " + ffmpegAsset() + "\n"))
			return
		}
		w.Write(zb.Bytes())
	}))
	defer srv.Close()
	old := ffmpegBase
	ffmpegBase = srv.URL + "/"
	defer func() { ffmpegBase = old }()
	t.Setenv("LOCALAPPDATA", t.TempDir())
	if err := installTool(context.Background(), "ffmpeg", func(dlEvent) {}); err != nil {
		t.Fatal(err)
	}
}

// yt-dlp de mentira: imprime o progresso no formato pedido e grava um arquivo.
const fakeYtdlp = `#!/bin/sh
out=""; prev=""; url=""
for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; url="$a"; done
case "$url" in
  *falha*) echo "ERROR: [Instagram] login required. Use --cookies" >&2; exit 1;;
  *lento*) sleep 30;;
esac
if [ "$1" = "--version" ]; then echo 2026.11.01; exit 0; fi
f=$(echo "$out" | sed 's/%(ext)s/mp4/')
echo "NTP  10.0%|  1.00MiB|NA"
echo "NTP 100.0%|  1.00MiB|NA"
echo "[Merger] Merging formats"
printf 'video' > "$f"
echo "NTF $f"
`

func withFakeYtdlp(t *testing.T) string {
	if runtime.GOOS == "windows" {
		t.Skip("script de shell")
	}
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "yt-dlp"), []byte(fakeYtdlp), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("XDG_CACHE_HOME", t.TempDir()) // sem ferramentas próprias instaladas
	root := t.TempDir()
	t.Setenv("NEUROTAB_DOWNLOAD_DIR", root)
	return root
}

func TestRunGet(t *testing.T) {
	root := withFakeYtdlp(t)
	var evs []dlEvent
	ev := runGet(context.Background(), dlReq{URL: "https://www.instagram.com/reel/ABC/", Dir: "NeuroTab/ia", Name: "2026-11-22 instagram - Teste", Quality: "720"}, func(e dlEvent) { evs = append(evs, e) })
	if ev.Stage != "done" {
		t.Fatalf("%+v", ev)
	}
	want := filepath.Join(root, "NeuroTab", "ia", "2026-11-22 instagram - Teste.mp4")
	if ev.File != want {
		t.Errorf("arquivo %q, esperado %q", ev.File, want)
	}
	if b, _ := os.ReadFile(want); string(b) != "video" {
		t.Error("conteúdo")
	}
	if len(evs) < 2 || evs[0].Stage != "download" || evs[len(evs)-1].Stage != "merge" {
		t.Errorf("eventos: %+v", evs)
	}
	if ev := runGet(context.Background(), dlReq{URL: "https://www.instagram.com/reel/falha/"}, func(dlEvent) {}); ev.Code != "login" {
		t.Errorf("falha: %+v", ev)
	}
	if ev := runGet(context.Background(), dlReq{URL: "https://youtu.be/x"}, func(dlEvent) {}); ev.Code != "youtube" {
		t.Errorf("youtube: %+v", ev)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(300 * time.Millisecond); cancel() }()
	start := time.Now()
	if ev := runGet(ctx, dlReq{URL: "https://x.com/a/status/lento"}, func(dlEvent) {}); ev.Code != "canceled" || time.Since(start) > 10*time.Second {
		t.Errorf("cancelar: %+v", ev)
	}
	tools := listTools()
	if tools.YtDlp.Version != "2026.11.01" || tools.Root != root {
		t.Errorf("tools: %+v", tools)
	}
}

func TestRunGetSemFerramenta(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	if ev := runGet(context.Background(), dlReq{URL: "https://x.com/a/status/1"}, func(dlEvent) {}); ev.Code != "notools" {
		t.Errorf("%+v", ev)
	}
}

func TestReveal(t *testing.T) {
	root := t.TempDir()
	t.Setenv("NEUROTAB_DOWNLOAD_DIR", root)
	if err := reveal(dlReq{Path: "/etc/passwd"}); err == nil {
		t.Error("fora de Downloads devia falhar")
	}
	if err := reveal(dlReq{Path: filepath.Join(root, "nao-existe.mp4")}); err == nil {
		t.Error("arquivo que não existe devia falhar")
	}
}
