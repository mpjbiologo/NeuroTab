package main

// Native messaging: cada mensagem é um JSON precedido do tamanho (4 bytes, ordem do processador: little-endian
// em todos os computadores em que a NeuroTab roda).

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"sync"
)

const maxIn = 64 << 20 // o navegador manda até 64 MB por mensagem

type Msg struct {
	Type     string          `json:"type"`
	Op       string          `json:"op,omitempty"`
	Token    string          `json:"token,omitempty"`
	Port     int             `json:"port,omitempty"`
	Name     string          `json:"name,omitempty"`
	DeviceID string          `json:"deviceId,omitempty"`
	Payload  json.RawMessage `json:"payload,omitempty"`
	URLs     []string        `json:"urls,omitempty"`
	Addrs    []LanAddr       `json:"addrs,omitempty"`
	Version  string          `json:"version,omitempty"`
	Message  string          `json:"message,omitempty"`
}

func readMsg(r io.Reader) (*Msg, error) {
	var n uint32
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		return nil, err
	}
	if n > maxIn {
		return nil, errors.New("mensagem grande demais")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	var m Msg
	if err := json.Unmarshal(buf, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

type writer struct {
	mu sync.Mutex
	w  io.Writer
}

func (w *writer) send(m Msg) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	if len(b) > 1<<20 { // do programa para o navegador: até 1 MB
		return errors.New("mensagem grande demais para o navegador")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := binary.Write(w.w, binary.LittleEndian, uint32(len(b))); err != nil {
		return err
	}
	_, err = w.w.Write(b)
	return err
}
