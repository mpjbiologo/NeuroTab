package main

// Servidor na rede local: a página do celular, a lista de itens, o envio e o "ao vivo" (SSE).
// Tudo em /api exige o token que a extensão gerou (vai no QR, depois do "#", e o celular manda no cabeçalho).

import (
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

//go:embed web/index.html
var page []byte

const keep = 50

type Payload struct {
	V     int             `json:"v"`
	ID    string          `json:"id"`
	At    int64           `json:"at"`
	From  map[string]any  `json:"from"`
	Kind  string          `json:"kind,omitempty"`
	Text  string          `json:"text"`
	Image json.RawMessage `json:"image,omitempty"`
}

type Hub struct {
	mu       sync.Mutex
	token    string
	name     string
	items    []json.RawMessage // mais novo primeiro
	subs     map[chan json.RawMessage]bool
	incoming func(json.RawMessage) // vai para a extensão
	files    map[string]*hubFile   // mídias que o celular pode pedir (0.9.3.2)
	uploaded func(p json.RawMessage, path string)
}

func newHub(token, name string, incoming func(json.RawMessage)) *Hub {
	return &Hub{token: token, name: name, subs: map[chan json.RawMessage]bool{}, incoming: incoming}
}

func (h *Hub) add(p json.RawMessage) {
	h.mu.Lock()
	h.items = append([]json.RawMessage{p}, h.items...)
	if len(h.items) > keep {
		h.items = h.items[:keep]
	}
	for c := range h.subs {
		select {
		case c <- p:
		default: // celular lento: perde o "ao vivo", mas vê na próxima lista
		}
	}
	h.mu.Unlock()
}

func (h *Hub) ok(r *http.Request) bool {
	tok := r.Header.Get("X-NT-Token")
	if tok == "" {
		tok = r.URL.Query().Get("t")
	}
	return h.token != "" && len(tok) == len(h.token) && subtle.ConstantTimeCompare([]byte(tok), []byte(h.token)) == 1
}

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "lan-" + hex.EncodeToString(b)
}

func (h *Hub) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		_, _ = w.Write(page)
	})
	mux.HandleFunc("/api/items", func(w http.ResponseWriter, r *http.Request) {
		if !h.ok(r) {
			http.Error(w, "token", http.StatusUnauthorized)
			return
		}
		h.mu.Lock()
		out := map[string]any{"name": h.name, "items": h.items}
		h.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(out)
	})
	mux.HandleFunc("/api/send", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", http.StatusMethodNotAllowed)
			return
		}
		if !h.ok(r) {
			http.Error(w, "token", http.StatusUnauthorized)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 12<<20)
		var in struct {
			Text  string          `json:"text"`
			Image json.RawMessage `json:"image"`
			From  map[string]any  `json:"from"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || (strings.TrimSpace(in.Text) == "" && len(in.Image) == 0) {
			http.Error(w, "vazio", http.StatusBadRequest)
			return
		}
		if in.From == nil {
			in.From = map[string]any{"id": "", "name": "Celular"}
		}
		kind := "text"
		if len(in.Image) > 0 {
			kind = "image"
		}
		b, _ := json.Marshal(Payload{V: 1, ID: newID(), At: time.Now().UnixMilli(), From: in.From, Kind: kind, Text: in.Text, Image: in.Image})
		h.add(b)
		if h.incoming != nil {
			h.incoming(b)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/api/file/", h.serveFile)
	mux.HandleFunc("/api/upload", h.upload)
	mux.HandleFunc("/api/events", func(w http.ResponseWriter, r *http.Request) {
		if !h.ok(r) {
			http.Error(w, "token", http.StatusUnauthorized)
			return
		}
		fl, okf := w.(http.Flusher)
		if !okf {
			http.Error(w, "stream", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		c := make(chan json.RawMessage, 8)
		h.mu.Lock()
		h.subs[c] = true
		h.mu.Unlock()
		defer func() { h.mu.Lock(); delete(h.subs, c); h.mu.Unlock() }()
		fmt.Fprint(w, ": ok\n\n")
		fl.Flush()
		ping := time.NewTicker(25 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case p := <-c:
				fmt.Fprintf(w, "data: %s\n\n", p)
				fl.Flush()
			case <-ping.C:
				fmt.Fprint(w, ": ping\n\n")
				fl.Flush()
			}
		}
	})
	return mux
}

// listen tenta a porta pedida e as 9 seguintes.
func listen(port int) (net.Listener, int, error) {
	var last error
	for p := port; p < port+10; p++ {
		l, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", p))
		if err == nil {
			return l, p, nil
		}
		last = err
	}
	return nil, 0, last
}
