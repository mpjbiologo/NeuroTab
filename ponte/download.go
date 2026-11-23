package main

// Baixar vídeos salvos na Mídia (0.7.11): a extensão pede, a Ponte roda o yt-dlp (com o ffmpeg para juntar áudio
// e vídeo) e grava na pasta Downloads. Só Instagram, TikTok e X; YouTube é recusado aqui também (política das lojas).
//
//   {"type":"dl","op":"tools"}                       → onde estão o yt-dlp e o ffmpeg, e as versões
//   {"type":"dl","op":"install","payload":{"what":["yt-dlp","ffmpeg"]}} → baixa as versões oficiais (confere o SHA-256)
//   {"type":"dl","op":"get","payload":{url,dir,name,quality,cookies}}  → progresso até {"stage":"done","file":…}
//   {"type":"dl","op":"reveal","payload":{path,open}} → mostra o arquivo na pasta (ou abre), só dentro de Downloads
//   {"type":"dl","op":"stat","payload":{paths}} → existe? tamanho? (Armazenamento, 0.8.3), só dentro de Downloads
//   {"type":"dl","op":"remove","payload":{path}} → apaga um arquivo baixado, só dentro de Downloads
//
// Enquanto baixa, fechar a conexão cancela.

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type dlReq struct {
	URL     string   `json:"url"`
	Dir     string   `json:"dir"`
	Name    string   `json:"name"`
	Quality string   `json:"quality"`
	Cookies string   `json:"cookies"`
	Path    string   `json:"path"`
	Open    bool     `json:"open"`
	What    []string `json:"what"`
	Paths   []string `json:"paths"`
}

type dlTool struct {
	Path    string `json:"path"`
	Version string `json:"version"`
}

type dlTools struct {
	YtDlp      dlTool          `json:"ytdlp"`
	Ffmpeg     dlTool          `json:"ffmpeg"`
	Root       string          `json:"root"`
	CanInstall map[string]bool `json:"canInstall"`
	OS         string          `json:"os"`
}

type dlEvent struct {
	Stage string  `json:"stage"` // install | download | merge | done | error
	What  string  `json:"what,omitempty"`
	Pct   float64 `json:"pct,omitempty"`
	Size  string  `json:"size,omitempty"`
	File  string  `json:"file,omitempty"`
	Code  string  `json:"code,omitempty"` // youtube | site | notools | login | failed | manual
	Error string  `json:"error,omitempty"`
}

// Endereços oficiais (variáveis para os testes trocarem por um servidor local).
var (
	ytdlpBase  = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/"
	ffmpegBase = "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/"
)

var errYouTube = errors.New("o YouTube não permite baixar vídeos por extensões; abra no próprio YouTube")

// ---------- endereços e caminhos ----------

var dlSites = []string{"instagram.com", "tiktok.com", "x.com", "twitter.com"}

func isYouTube(host string) bool {
	for _, s := range []string{"youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com"} {
		if host == s || strings.HasSuffix(host, "."+s) {
			return true
		}
	}
	return false
}

// allowedURL aceita só https de Instagram, TikTok e X.
func allowedURL(raw string) (string, string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", "site", errors.New("endereço inválido")
	}
	host := strings.ToLower(u.Hostname())
	if isYouTube(host) {
		return "", "youtube", errYouTube
	}
	if u.Scheme != "https" {
		return "", "site", errors.New("só endereços https")
	}
	for _, s := range dlSites {
		if host == s || strings.HasSuffix(host, "."+s) {
			return u.String(), "", nil
		}
	}
	return "", "site", errors.New("só dá para baixar vídeos do Instagram, do TikTok e do X")
}

var badChars = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f#%]+`)

func cleanPart(s string, max int) string {
	s = badChars.ReplaceAllString(s, " ")
	s = strings.Join(strings.Fields(s), " ")
	s = strings.Trim(s, " .")
	if r := []rune(s); len(r) > max {
		s = strings.TrimRight(string(r[:max]), " .")
	}
	if s == "" || s == "." || s == ".." {
		return ""
	}
	return s
}

// safeRel transforma "NeuroTab/ia" em um caminho relativo seguro (sem "..", sem raiz, até 4 pastas).
func safeRel(rel string) string {
	var parts []string
	for _, p := range strings.FieldsFunc(rel, func(r rune) bool { return r == '/' || r == '\\' }) {
		if c := cleanPart(p, 60); c != "" {
			parts = append(parts, c)
		}
		if len(parts) == 4 {
			break
		}
	}
	if len(parts) == 0 {
		return "NeuroTab"
	}
	return filepath.Join(parts...)
}

func safeName(name string) string {
	if c := cleanPart(name, 120); c != "" {
		return c
	}
	return "video"
}

// downloadsRoot: a pasta Downloads da pessoa.
func downloadsRoot() string {
	if d := os.Getenv("NEUROTAB_DOWNLOAD_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "linux" {
		if d := os.Getenv("XDG_DOWNLOAD_DIR"); d != "" {
			return d
		}
		if b, err := os.ReadFile(filepath.Join(home, ".config", "user-dirs.dirs")); err == nil {
			if d := parseUserDirs(string(b), home); d != "" {
				return d
			}
		}
	}
	return filepath.Join(home, "Downloads")
}

func parseUserDirs(s, home string) string {
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "XDG_DOWNLOAD_DIR=") {
			continue
		}
		v := strings.Trim(strings.TrimPrefix(line, "XDG_DOWNLOAD_DIR="), `"`)
		v = strings.ReplaceAll(v, "$HOME", home)
		if filepath.IsAbs(v) && filepath.Clean(v) != filepath.Clean(home) {
			return v
		}
	}
	return ""
}

// inside: p fica dentro de root?
func inside(root, p string) bool {
	ra, err1 := filepath.Abs(root)
	pa, err2 := filepath.Abs(p)
	if err1 != nil || err2 != nil {
		return false
	}
	rel, err := filepath.Rel(ra, pa)
	return err == nil && rel != "." && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel)
}

// ---------- ferramentas ----------

func exe(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func toolsDir() string {
	d, err := os.UserCacheDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "neurotab-ponte", "bin")
}

func findTool(name string) string {
	own := filepath.Join(toolsDir(), exe(name))
	if st, err := os.Stat(own); err == nil && !st.IsDir() {
		return own
	}
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return ""
}

func toolVersion(path string, args ...string) string {
	if path == "" {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, args...)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
	if f := strings.Fields(line); len(f) >= 3 && f[0] == "ffmpeg" && f[1] == "version" {
		return f[2]
	}
	return line
}

func ytdlpAsset() string {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "windows/amd64", "windows/386":
		return "yt-dlp.exe"
	case "windows/arm64":
		return "yt-dlp_arm64.exe"
	case "darwin/amd64", "darwin/arm64":
		return "yt-dlp_macos"
	case "linux/amd64":
		return "yt-dlp_linux"
	case "linux/arm64":
		return "yt-dlp_linux_aarch64"
	}
	return ""
}

func ffmpegAsset() string {
	if runtime.GOOS == "windows" && runtime.GOARCH == "amd64" {
		return "ffmpeg-master-latest-win64-gpl.zip"
	}
	return "" // macOS e Linux: pelo gerenciador de pacotes (brew/apt), com o yt-dlp ele é achado sozinho
}

func listTools() dlTools {
	yt := findTool("yt-dlp")
	ff := findTool("ffmpeg")
	return dlTools{
		YtDlp:      dlTool{Path: yt, Version: toolVersion(yt, "--version")},
		Ffmpeg:     dlTool{Path: ff, Version: toolVersion(ff, "-version")},
		Root:       downloadsRoot(),
		CanInstall: map[string]bool{"yt-dlp": ytdlpAsset() != "", "ffmpeg": ffmpegAsset() != ""},
		OS:         runtime.GOOS,
	}
}

// parseSums lê "hash  arquivo" (formato do sha256sum) e devolve o hash do arquivo pedido.
func parseSums(s, file string) string {
	for _, line := range strings.Split(s, "\n") {
		f := strings.Fields(line)
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == file && len(f[0]) == 64 {
			return strings.ToLower(f[0])
		}
	}
	return ""
}

var httpDL = &http.Client{Timeout: 30 * time.Minute}

func fetch(ctx context.Context, u string, w io.Writer, progress func(done, total int64)) error {
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "NeuroTab-Ponte/"+version)
	res, err := httpDL.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("%s respondeu %d", u, res.StatusCode)
	}
	buf := make([]byte, 64<<10)
	var done int64
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return werr
			}
			done += int64(n)
			if progress != nil {
				progress(done, res.ContentLength)
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// fetchVerified baixa base+asset, confere com o arquivo de somas da mesma release e devolve o conteúdo.
func fetchVerified(ctx context.Context, base, asset, sumsFile string, progress func(done, total int64)) ([]byte, error) {
	var sums bytes.Buffer
	if err := fetch(ctx, base+sumsFile, &sums, nil); err != nil {
		return nil, err
	}
	want := parseSums(sums.String(), asset)
	if want == "" {
		return nil, fmt.Errorf("%s não está na lista de somas", asset)
	}
	var body bytes.Buffer
	if err := fetch(ctx, base+asset, &body, progress); err != nil {
		return nil, err
	}
	got := sha256.Sum256(body.Bytes())
	if hex.EncodeToString(got[:]) != want {
		return nil, errors.New("o arquivo baixado não confere com a soma SHA-256 oficial; nada foi instalado")
	}
	return body.Bytes(), nil
}

func writeExe(name string, data []byte) error {
	dir := toolsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(dir, "."+name+".tmp")
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, name))
}

func installTool(ctx context.Context, what string, emit func(dlEvent)) error {
	prog := func(done, total int64) {
		if total > 0 {
			emit(dlEvent{Stage: "install", What: what, Pct: round1(float64(done) / float64(total) * 100)})
		}
	}
	switch what {
	case "yt-dlp":
		asset := ytdlpAsset()
		if asset == "" {
			return errors.New("o yt-dlp não tem versão pronta para este sistema")
		}
		data, err := fetchVerified(ctx, ytdlpBase, asset, "SHA2-256SUMS", prog)
		if err != nil {
			return err
		}
		return writeExe(exe("yt-dlp"), data)
	case "ffmpeg":
		asset := ffmpegAsset()
		if asset == "" {
			return errors.New("manual")
		}
		data, err := fetchVerified(ctx, ffmpegBase, asset, "checksums.sha256", prog)
		if err != nil {
			return err
		}
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return err
		}
		found := 0
		for _, f := range zr.File {
			base := filepath.Base(f.Name)
			if (base == "ffmpeg.exe" || base == "ffprobe.exe") && strings.Contains(f.Name, "/bin/") {
				rc, err := f.Open()
				if err != nil {
					return err
				}
				b, err := io.ReadAll(rc)
				rc.Close()
				if err != nil {
					return err
				}
				if err := writeExe(base, b); err != nil {
					return err
				}
				found++
			}
		}
		if found == 0 {
			return errors.New("o pacote do ffmpeg veio sem o programa")
		}
		return nil
	}
	return errors.New("ferramenta desconhecida")
}

// ---------- download ----------

func formatFor(quality string, merge bool) string {
	h, _ := strconv.Atoi(quality)
	if h < 144 || h > 4320 {
		h = 0
	}
	if merge {
		if h == 0 {
			return "bv*+ba/b"
		}
		return fmt.Sprintf("bv*[height<=%d]+ba/b[height<=%d]/b", h, h)
	}
	if h == 0 {
		return "b"
	}
	return fmt.Sprintf("b[height<=%d]/b", h)
}

func ytdlpArgs(q dlReq, outDir, ffmpeg, cookieFile string) []string {
	args := []string{
		"--newline", "--progress", "--no-playlist", "--no-mtime", "--no-overwrites", "--ignore-config",
		"--progress-template", "download:NTP %(progress._percent_str)s|%(progress._total_bytes_str)s|%(progress._total_bytes_estimate_str)s",
		"--print", "after_move:NTF %(filepath)s",
		"-f", formatFor(q.Quality, ffmpeg != ""),
		"-o", filepath.Join(outDir, safeName(q.Name)+".%(ext)s"),
	}
	if ffmpeg != "" {
		args = append(args, "--merge-output-format", "mp4", "--ffmpeg-location", ffmpeg)
	}
	if cookieFile != "" {
		args = append(args, "--cookies", cookieFile)
	}
	return append(args, "--", q.URL)
}

var pctRe = regexp.MustCompile(`([\d.]+)%`)

// parseLine entende as linhas que pedimos ao yt-dlp.
func parseLine(line string) (dlEvent, bool) {
	line = strings.TrimSpace(line)
	switch {
	case strings.HasPrefix(line, "NTP "):
		parts := strings.Split(strings.TrimPrefix(line, "NTP "), "|")
		ev := dlEvent{Stage: "download"}
		if m := pctRe.FindStringSubmatch(parts[0]); m != nil {
			ev.Pct, _ = strconv.ParseFloat(m[1], 64)
		}
		for _, s := range parts[1:] {
			if s = strings.TrimSpace(s); s != "" && s != "NA" && s != "N/A" {
				ev.Size = strings.TrimPrefix(s, "~")
				break
			}
		}
		return ev, true
	case strings.HasPrefix(line, "NTF "):
		return dlEvent{Stage: "done", File: strings.TrimSpace(strings.TrimPrefix(line, "NTF "))}, true
	case strings.HasPrefix(line, "[Merger]") || strings.HasPrefix(line, "[VideoConvertor]") || strings.HasPrefix(line, "[FixupM3u8]"):
		return dlEvent{Stage: "merge"}, true
	}
	return dlEvent{}, false
}

func errCode(stderr string) string {
	s := strings.ToLower(stderr)
	switch {
	case strings.Contains(s, "login") || strings.Contains(s, "cookies") || strings.Contains(s, "private") || strings.Contains(s, "rate-limit") || strings.Contains(s, "not available"):
		return "login"
	case strings.Contains(s, "unsupported url") || strings.Contains(s, "no video"):
		return "site"
	}
	return "failed"
}

func lastLines(s string, n int) string {
	var out []string
	for _, l := range strings.Split(strings.TrimSpace(s), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			out = append(out, l)
		}
	}
	if len(out) > n {
		out = out[len(out)-n:]
	}
	return strings.Join(out, "\n")
}

func runGet(ctx context.Context, q dlReq, emit func(dlEvent)) dlEvent {
	clean, code, err := allowedURL(q.URL)
	if err != nil {
		return dlEvent{Stage: "error", Code: code, Error: err.Error()}
	}
	q.URL = clean
	yt := findTool("yt-dlp")
	if yt == "" {
		return dlEvent{Stage: "error", Code: "notools", Error: "o yt-dlp não está instalado"}
	}
	outDir := filepath.Join(downloadsRoot(), safeRel(q.Dir))
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return dlEvent{Stage: "error", Code: "failed", Error: err.Error()}
	}
	cookieFile := ""
	if strings.TrimSpace(q.Cookies) != "" {
		f, err := os.CreateTemp("", "nt-cookies-*.txt")
		if err == nil {
			_ = f.Chmod(0o600)
			_, _ = f.WriteString(q.Cookies)
			f.Close()
			cookieFile = f.Name()
			defer os.Remove(cookieFile)
		}
	}
	cmd := exec.CommandContext(ctx, yt, ytdlpArgs(q, outDir, findTool("ffmpeg"), cookieFile)...)
	hideWindow(cmd)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.WaitDelay = 3 * time.Second // cancelado: não espera os processos filhos soltarem a saída
	if err := cmd.Start(); err != nil {
		return dlEvent{Stage: "error", Code: "failed", Error: err.Error()}
	}
	var file string
	lines := make(chan struct{})
	go func() {
		defer close(lines)
		var last time.Time
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			ev, ok := parseLine(sc.Text())
			if !ok {
				continue
			}
			if ev.Stage == "done" {
				file = ev.File
				continue
			}
			if ev.Stage == "download" && time.Since(last) < 400*time.Millisecond && ev.Pct < 100 {
				continue
			}
			last = time.Now()
			emit(ev)
		}
		_, _ = io.Copy(io.Discard, pr)
	}()
	err = cmd.Wait()
	pw.Close()
	<-lines
	if ctx.Err() != nil {
		return dlEvent{Stage: "error", Code: "canceled", Error: "cancelado"}
	}
	if err != nil || file == "" {
		msg := lastLines(stderr.String(), 3)
		if msg == "" && err != nil {
			msg = err.Error()
		}
		return dlEvent{Stage: "error", Code: errCode(stderr.String()), Error: msg}
	}
	return dlEvent{Stage: "done", File: file}
}

// ---------- mostrar na pasta ----------

func reveal(q dlReq) error {
	p := filepath.Clean(q.Path)
	if !filepath.IsAbs(p) || !inside(downloadsRoot(), p) {
		return errors.New("só arquivos da pasta Downloads")
	}
	if _, err := os.Stat(p); err != nil {
		return errors.New("o arquivo não está mais lá")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		if q.Open {
			cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", p)
		} else {
			cmd = exec.Command("explorer", "/select,"+p)
		}
	case "darwin":
		if q.Open {
			cmd = exec.Command("open", p)
		} else {
			cmd = exec.Command("open", "-R", p)
		}
	default:
		target := filepath.Dir(p)
		if q.Open {
			target = p
		}
		cmd = exec.Command("xdg-open", target)
	}
	return cmd.Start() // explorer devolve código 1 mesmo quando dá certo; não espera
}

// ---------- Armazenamento (0.8.3): conferir e apagar arquivos baixados ----------

type fileInfo struct {
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
	Size   int64  `json:"size,omitempty"`
}

func statFiles(paths []string) []fileInfo {
	root := downloadsRoot()
	out := make([]fileInfo, 0, len(paths))
	for i, p := range paths {
		if i >= 500 {
			break
		}
		c := filepath.Clean(p)
		fi := fileInfo{Path: p}
		if filepath.IsAbs(c) && inside(root, c) {
			if st, err := os.Stat(c); err == nil && st.Mode().IsRegular() {
				fi.Exists, fi.Size = true, st.Size()
			}
		}
		out = append(out, fi)
	}
	return out
}

func removeFile(q dlReq) error {
	p := filepath.Clean(q.Path)
	if !filepath.IsAbs(p) || !inside(downloadsRoot(), p) {
		return errors.New("só arquivos da pasta Downloads")
	}
	st, err := os.Lstat(p)
	if err != nil {
		return errors.New("o arquivo não está mais lá")
	}
	if !st.Mode().IsRegular() {
		return errors.New("só arquivos, não pastas")
	}
	return os.Remove(p)
}

// ---------- entrada ----------

func runDL(first Msg, r io.Reader, w *writer) error {
	var q dlReq
	if len(first.Payload) > 0 {
		_ = json.Unmarshal(first.Payload, &q)
	}
	send := func(v any, message string) error {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		return w.send(Msg{Type: "dl", Op: first.Op, Payload: b, Message: message, Version: version})
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { // a extensão fechou a conexão → cancela
		for {
			if _, err := readMsg(r); err != nil {
				cancel()
				return
			}
		}
	}()
	emit := func(ev dlEvent) { _ = send(ev, "") }
	switch first.Op {
	case "tools":
		return send(listTools(), "")
	case "install":
		for _, what := range q.What {
			if err := installTool(ctx, what, emit); err != nil {
				code := "failed"
				if err.Error() == "manual" {
					code = "manual"
				}
				ev := dlEvent{Stage: "error", What: what, Code: code, Error: err.Error()}
				return send(ev, ev.Error)
			}
		}
		return send(dlEvent{Stage: "done", What: strings.Join(q.What, ",")}, "")
	case "get":
		ev := runGet(ctx, q, emit)
		if ev.Stage == "error" {
			return send(ev, ev.Error)
		}
		return send(ev, "")
	case "stat":
		return send(struct {
			Stage string     `json:"stage"`
			Files []fileInfo `json:"files"`
		}{"done", statFiles(q.Paths)}, "")
	case "remove":
		if err := removeFile(q); err != nil {
			return send(dlEvent{Stage: "error", Code: "failed", Error: err.Error()}, err.Error())
		}
		return send(dlEvent{Stage: "done"}, "")
	case "reveal":
		if err := reveal(q); err != nil {
			return send(dlEvent{Stage: "error", Code: "failed", Error: err.Error()}, err.Error())
		}
		return send(dlEvent{Stage: "done"}, "")
	}
	return send(dlEvent{Stage: "error", Code: "failed", Error: "pedido desconhecido"}, "pedido desconhecido")
}
