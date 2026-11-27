package main

// Mídias na rede local (0.9.3.2, #80).
//   - A extensão registra arquivos ({"type":"file"}): do disco (só dentro de Downloads) ou em bytes
//     (imagens da biblioteca). O celular os pede em GET /api/file/<id>, com o token e com suporte a Range
//     (o vídeo toca enquanto baixa). Nada é listado: só sai o que foi registrado.
//   - O celular envia fotos, vídeos e áudios em POST /api/upload (até 500 MB). O arquivo vai para
//     Downloads/NeuroTab/Do celular, sem nunca substituir outro, e a extensão é avisada com o caminho.
//   - {"type":"dl","op":"read"} lê um arquivo de Downloads em pedaços, para a extensão mandar pela nuvem/ntfy.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	maxUpload   = 500 << 20 // do celular para o computador
	maxFiles    = 300       // arquivos registrados ao mesmo tempo
	maxMemBytes = 200 << 20 // bytes de imagens guardados na memória
	uploadDir   = "NeuroTab/Do celular"
)

type hubFile struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Mime  string `json:"mime"`
	Size  int64  `json:"size"`
	Path  string `json:"-"`
	Data  []byte `json:"-"`
	added int64
}

// safeMime: só tipos que o celular mostra sem risco; o resto vai como arquivo para baixar.
func safeMime(m, name string) string {
	m = strings.ToLower(strings.TrimSpace(strings.Split(m, ";")[0]))
	if m == "" || m == "application/octet-stream" {
		m = mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
		m = strings.Split(m, ";")[0]
	}
	switch {
	case strings.HasPrefix(m, "image/") && m != "image/svg+xml":
		return m
	case strings.HasPrefix(m, "video/"), strings.HasPrefix(m, "audio/"), m == "application/pdf", m == "text/plain":
		return m
	}
	return "application/octet-stream"
}

// registerFile: a extensão pede para o celular poder ver este arquivo.
func (h *Hub) registerFile(f hubFile) error {
	if f.ID == "" || len(f.ID) > 100 {
		return errors.New("id inválido")
	}
	f.Name = safeName(f.Name)
	if f.Path != "" {
		p := filepath.Clean(f.Path)
		if !filepath.IsAbs(p) || !inside(downloadsRoot(), p) {
			return errors.New("só arquivos da pasta Downloads")
		}
		st, err := os.Stat(p)
		if err != nil || !st.Mode().IsRegular() {
			return errors.New("arquivo não encontrado")
		}
		f.Path, f.Size, f.Data = p, st.Size(), nil
	} else {
		if len(f.Data) == 0 {
			return errors.New("arquivo vazio")
		}
		f.Size = int64(len(f.Data))
	}
	f.Mime = safeMime(f.Mime, f.Name)
	f.added = time.Now().UnixNano()
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.files == nil {
		h.files = map[string]*hubFile{}
	}
	h.files[f.ID] = &f
	// limites: quantidade e memória (sai o mais antigo)
	for len(h.files) > maxFiles || h.memBytes() > maxMemBytes {
		var old *hubFile
		for _, x := range h.files {
			if old == nil || x.added < old.added {
				old = x
			}
		}
		delete(h.files, old.ID)
	}
	return nil
}

func (h *Hub) memBytes() (n int) {
	for _, x := range h.files {
		n += len(x.Data)
	}
	return
}

func (h *Hub) file(id string) *hubFile {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.files[id]
}

// GET /api/file/<id>[?dl=1]: entrega o arquivo registrado, com Range.
func (h *Hub) serveFile(w http.ResponseWriter, r *http.Request) {
	if !h.ok(r) {
		http.Error(w, "token", http.StatusUnauthorized)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/file/")
	f := h.file(id)
	if f == nil {
		http.NotFound(w, r)
		return
	}
	var rs io.ReadSeeker
	mod := time.Unix(0, f.added)
	if f.Path != "" {
		fh, err := os.Open(f.Path)
		if err != nil {
			http.Error(w, "o arquivo não está mais lá", http.StatusGone)
			return
		}
		defer fh.Close()
		if st, err := fh.Stat(); err == nil {
			mod = st.ModTime()
		}
		rs = fh
	} else {
		rs = bytes.NewReader(f.Data)
	}
	disp := "inline"
	if r.URL.Query().Get("dl") == "1" || f.Mime == "application/octet-stream" {
		disp = "attachment"
	}
	w.Header().Set("Content-Type", f.Mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disp, url.PathEscape(f.Name)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.Header().Set("Cache-Control", "private, max-age=600")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.ServeContent(w, r, "", mod, rs)
}

var commonExt = map[string]string{
	"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/heic": ".heic", "image/heif": ".heif",
	"video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/3gpp": ".3gp",
	"audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "audio/webm": ".weba", "audio/wav": ".wav",
	"application/pdf": ".pdf", "text/plain": ".txt",
}

func extFor(m string) string {
	if e, ok := commonExt[m]; ok {
		return e
	}
	if exts, _ := mime.ExtensionsByType(m); len(exts) > 0 {
		return exts[0]
	}
	return ""
}

// freeName: "foto.jpg" → "foto (1).jpg" se já existir. Nunca substitui.
func freeName(dir, name string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	p := filepath.Join(dir, name)
	for i := 1; i < 1000; i++ {
		if _, err := os.Lstat(p); errors.Is(err, os.ErrNotExist) {
			return p
		}
		p = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
	}
	return filepath.Join(dir, fmt.Sprintf("%s %d%s", base, time.Now().UnixNano(), ext))
}

// POST /api/upload: corpo = o arquivo; cabeçalhos X-NT-Name, X-NT-From-Id, X-NT-From-Name (codificados).
func (h *Hub) upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST", http.StatusMethodNotAllowed)
		return
	}
	if !h.ok(r) {
		http.Error(w, "token", http.StatusUnauthorized)
		return
	}
	if r.ContentLength > maxUpload {
		http.Error(w, "grande demais (até 500 MB)", http.StatusRequestEntityTooLarge)
		return
	}
	dec := func(k string) string { v, _ := url.QueryUnescape(r.Header.Get(k)); return v }
	name := safeName(dec("X-NT-Name"))
	if filepath.Ext(name) == "" {
		name += extFor(safeMime(r.Header.Get("Content-Type"), ""))
	}
	dir := filepath.Join(downloadsRoot(), safeRel(uploadDir))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, "não consegui criar a pasta", http.StatusInternalServerError)
		return
	}
	tmp, err := os.CreateTemp(dir, ".nt-upload-*")
	if err != nil {
		http.Error(w, "não consegui gravar", http.StatusInternalServerError)
		return
	}
	body := http.MaxBytesReader(w, r.Body, maxUpload)
	n, err := io.Copy(tmp, body)
	tmp.Close()
	if err != nil || n == 0 {
		os.Remove(tmp.Name())
		code := http.StatusBadRequest
		msg := "envio incompleto"
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			code, msg = http.StatusRequestEntityTooLarge, "grande demais (até 500 MB)"
		}
		http.Error(w, msg, code)
		return
	}
	final := freeName(dir, name)
	if err := os.Rename(tmp.Name(), final); err != nil {
		os.Remove(tmp.Name())
		http.Error(w, "não consegui gravar", http.StatusInternalServerError)
		return
	}
	fid := newID()
	if err := h.registerFile(hubFile{ID: fid, Name: filepath.Base(final), Mime: r.Header.Get("Content-Type"), Path: final}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	f := h.file(fid)
	from := map[string]any{"id": cleanPart(dec("X-NT-From-Id"), 80), "name": cleanPart(dec("X-NT-From-Name"), 60)}
	if from["name"] == "" {
		from["name"] = "Celular"
	}
	p, _ := json.Marshal(map[string]any{
		"v": 1, "id": newID(), "at": time.Now().UnixMilli(), "from": from, "kind": "media",
		"text":  "📎 " + f.Name,
		"media": map[string]any{"title": f.Name},
		"files": []hubFile{*f},
	})
	h.add(p)
	if h.uploaded != nil {
		h.uploaded(p, final)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "name": f.Name, "size": f.Size})
}

// fileMsg: o que a extensão manda para registrar um arquivo.
type fileMsg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Mime string `json:"mime"`
	Path string `json:"path"`
	Data string `json:"data"` // base64 (imagens da biblioteca)
}

func (h *Hub) registerFromMsg(raw json.RawMessage) error {
	var m fileMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		return err
	}
	f := hubFile{ID: m.ID, Name: m.Name, Mime: m.Mime, Path: m.Path}
	if m.Path == "" {
		b, err := base64.StdEncoding.DecodeString(m.Data)
		if err != nil {
			return errors.New("dados inválidos")
		}
		f.Data = b
	}
	return h.registerFile(f)
}

// ---------- ler um arquivo de Downloads para a extensão ----------

const readChunk = 600 << 10 // cabe numa mensagem de 1 MB em base64

// readForExt manda o arquivo em pedaços: {"stage":"chunk","offset":n,"data":"…"} e por fim {"stage":"done"}.
func readForExt(q dlReq, send func(any) error) error {
	p := filepath.Clean(q.Path)
	if !filepath.IsAbs(p) || !inside(downloadsRoot(), p) {
		return errors.New("só arquivos da pasta Downloads")
	}
	fh, err := os.Open(p)
	if err != nil {
		return errors.New("o arquivo não está mais lá")
	}
	defer fh.Close()
	st, err := fh.Stat()
	if err != nil || !st.Mode().IsRegular() {
		return errors.New("o arquivo não está mais lá")
	}
	if q.Max > 0 && st.Size() > q.Max {
		return fmt.Errorf("grande demais (%d bytes)", st.Size())
	}
	buf := make([]byte, readChunk)
	var off int64
	for {
		n, err := fh.Read(buf)
		if n > 0 {
			if e := send(map[string]any{"stage": "chunk", "offset": off, "size": st.Size(), "data": base64.StdEncoding.EncodeToString(buf[:n])}); e != nil {
				return e
			}
			off += int64(n)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	return send(map[string]any{"stage": "done", "size": off})
}
