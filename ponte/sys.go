package main

// Widget Sistema da NeuroTab (0.7.10): processador, memória, discos, temperaturas, placa de vídeo, bateria e
// programas que mais gastam. Sem bibliotecas externas: cada sistema tem o seu leitor (sys_linux.go,
// sys_windows.go, sys_darwin.go); aqui ficam os tipos, a NVIDIA (nvidia-smi), a amostragem e o modo contínuo.
//
// Pedido: {"type":"sys","op":"snapshot"} responde uma vez; {"type":"sys","op":"stream","payload":{"interval":2000}}
// manda uma leitura a cada intervalo até a extensão fechar a conexão (o widget saiu da tela).

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type CPUInfo struct {
	Model   string    `json:"model,omitempty"`
	Cores   int       `json:"cores"`
	Usage   *float64  `json:"usage,omitempty"` // 0–100, a máquina toda
	PerCore []float64 `json:"perCore,omitempty"`
	MHz     float64   `json:"mhz,omitempty"`
	Temp    *float64  `json:"temp,omitempty"`
}

type MemInfo struct {
	Total     uint64 `json:"total"`
	Available uint64 `json:"available"`
	SwapTotal uint64 `json:"swapTotal,omitempty"`
	SwapUsed  uint64 `json:"swapUsed,omitempty"`
}

type Disk struct {
	Mount string   `json:"mount"`
	Label string   `json:"label,omitempty"`
	FS    string   `json:"fs,omitempty"`
	Total uint64   `json:"total"`
	Free  uint64   `json:"free"`
	Temp  *float64 `json:"temp,omitempty"`
}

type GPU struct {
	Name     string   `json:"name"`
	Usage    *float64 `json:"usage,omitempty"`
	MemUsed  uint64   `json:"memUsed,omitempty"`
	MemTotal uint64   `json:"memTotal,omitempty"`
	Temp     *float64 `json:"temp,omitempty"`
	Source   string   `json:"source,omitempty"`
}

type Temp struct {
	Label string  `json:"label"`
	Kind  string  `json:"kind"` // cpu | gpu | disk | other
	C     float64 `json:"c"`
}

type Battery struct {
	Percent  float64 `json:"percent"`
	Charging bool    `json:"charging"`
	Plugged  bool    `json:"plugged"`
}

type SysProc struct {
	Name string  `json:"name"`
	PID  int     `json:"pid"`
	CPU  float64 `json:"cpu"` // % da máquina toda
	RSS  uint64  `json:"rss"`
}

type SysSnap struct {
	At      int64     `json:"at"`
	OS      string    `json:"os"`
	Host    string    `json:"host,omitempty"`
	Uptime  int64     `json:"uptime,omitempty"`
	CPU     CPUInfo   `json:"cpu"`
	Mem     *MemInfo  `json:"mem,omitempty"`
	Disks   []Disk    `json:"disks"`
	GPUs    []GPU     `json:"gpus"`
	Temps   []Temp    `json:"temps"`
	Battery *Battery  `json:"battery,omitempty"`
	Procs   []SysProc `json:"procs,omitempty"`
	Notes   []string  `json:"notes,omitempty"`
}

// cpuTimes: total e ocioso (em qualquer unidade) — o uso sai da diferença entre duas leituras.
type cpuTimes struct{ total, idle float64 }

// procTime: tempo de CPU acumulado (segundos) e memória de um programa.
type procTime struct {
	name string
	cpu  float64
	rss  uint64
}

// leitor de cada sistema (sys_<os>.go)
type osReader interface {
	cpuTimes() ([]cpuTimes, error) // [0] = máquina toda, depois um por núcleo
	cpuModel() (string, float64)   // nome e MHz
	mem() (*MemInfo, error)
	disks() []Disk
	temps() []Temp
	gpus() []GPU // além da NVIDIA
	battery() *Battery
	uptime() int64
	procs() (map[int]procTime, error)
	notes() []string
}

type sampler struct {
	r        osReader
	prevCPU  []cpuTimes
	prevProc map[int]procTime
	prevAt   time.Time
	model    string
	mhz      float64
	n        int
	lastProc []SysProc
	nvidia   nvidiaState
}

func newSampler() *sampler { return &sampler{r: newOSReader()} }

var errNoCPUTimes = errors.New("contadores de CPU indisponíveis")

// psDirect: o sistema dá o % de CPU de cada programa pronto (macOS, pelo "ps"), sem diferença entre leituras.
var psDirect = false

func (s *sampler) sample(withProcs bool) SysSnap {
	now := time.Now()
	snap := SysSnap{At: now.UnixMilli(), OS: runtime.GOOS, Disks: []Disk{}, GPUs: []GPU{}, Temps: []Temp{}}
	snap.Host, _ = os.Hostname()
	if s.model == "" || s.n%30 == 0 {
		s.model, s.mhz = s.r.cpuModel()
	}
	snap.CPU = CPUInfo{Model: s.model, Cores: runtime.NumCPU(), MHz: s.mhz}
	if cur, err := s.r.cpuTimes(); err == nil && len(cur) > 0 {
		if len(s.prevCPU) == len(cur) {
			u := cpuUsage(s.prevCPU[0], cur[0])
			snap.CPU.Usage = &u
			for i := 1; i < len(cur); i++ {
				snap.CPU.PerCore = append(snap.CPU.PerCore, round1(cpuUsage(s.prevCPU[i], cur[i])))
			}
		}
		s.prevCPU = cur
	}
	if m, err := s.r.mem(); err == nil {
		snap.Mem = m
	}
	snap.Disks = s.r.disks()
	snap.Temps = s.r.temps()
	snap.GPUs = append(s.nvidia.read(), s.r.gpus()...)
	for _, g := range snap.GPUs {
		if g.Temp != nil {
			snap.Temps = append(snap.Temps, Temp{Label: g.Name, Kind: "gpu", C: *g.Temp})
		}
	}
	if t := cpuTemp(snap.Temps); t != nil {
		snap.CPU.Temp = t
	}
	snap.Battery = s.r.battery()
	snap.Uptime = s.r.uptime()
	if psDirect {
		if cur, err := s.r.procs(); err == nil {
			cores := float64(runtime.NumCPU())
			var sum float64
			list := make([]SysProc, 0, len(cur))
			for pid, p := range cur {
				sum += p.cpu
				list = append(list, SysProc{Name: p.name, PID: pid, CPU: round1(p.cpu / cores), RSS: p.rss})
			}
			u := round1(min(100, sum/cores))
			snap.CPU.Usage = &u
			if withProcs {
				snap.Procs = topList(list, 6)
			}
		}
		withProcs = false
	}
	if withProcs {
		// programas: a cada 5 leituras (é a parte mais cara)
		if s.n%5 == 0 || s.lastProc == nil {
			if cur, err := s.r.procs(); err == nil {
				if s.prevProc != nil {
					s.lastProc = topProcs(s.prevProc, cur, now.Sub(s.prevAt).Seconds(), runtime.NumCPU(), 6)
				}
				s.prevProc, s.prevAt = cur, now
			}
		}
		snap.Procs = s.lastProc
	}
	snap.Notes = s.r.notes()
	if snap.Disks == nil {
		snap.Disks = []Disk{}
	}
	if snap.Temps == nil {
		snap.Temps = []Temp{}
	}
	if snap.GPUs == nil {
		snap.GPUs = []GPU{}
	}
	s.n++
	return snap
}

func cpuUsage(a, b cpuTimes) float64 {
	dt := b.total - a.total
	if dt <= 0 {
		return 0
	}
	u := (1 - (b.idle-a.idle)/dt) * 100
	if u < 0 {
		u = 0
	}
	if u > 100 {
		u = 100
	}
	return round1(u)
}

func round1(v float64) float64 { return float64(int64(v*10+0.5)) / 10 }

// cpuTemp escolhe a temperatura que representa o processador: o "pacote"/Tctl se houver, senão a maior.
func cpuTemp(ts []Temp) *float64 {
	var best *float64
	for _, t := range ts {
		if t.Kind != "cpu" {
			continue
		}
		l := strings.ToLower(t.Label)
		v := t.C
		if strings.Contains(l, "package") || strings.Contains(l, "tctl") || strings.Contains(l, "tdie") || strings.Contains(l, "x86_pkg") {
			return &v
		}
		if best == nil || v > *best {
			best = &v
		}
	}
	return best
}

// topProcs: CPU % de cada programa entre duas leituras (agrupando pelo nome), os n que mais gastam.
func topProcs(prev, cur map[int]procTime, secs float64, cores int, n int) []SysProc {
	if secs <= 0 || cores <= 0 {
		return nil
	}
	agg := map[string]*SysProc{}
	for pid, c := range cur {
		p := agg[c.name]
		if p == nil {
			p = &SysProc{Name: c.name, PID: pid}
			agg[c.name] = p
		}
		p.RSS += c.rss
		if old, ok := prev[pid]; ok && c.cpu >= old.cpu {
			p.CPU += (c.cpu - old.cpu) / secs / float64(cores) * 100
		}
	}
	list := make([]SysProc, 0, len(agg))
	for _, p := range agg {
		p.CPU = round1(p.CPU)
		list = append(list, *p)
	}
	return topList(list, n)
}

// topList: os n programas de mais CPU, completados pelos n de mais memória (agrupados pelo nome).
func topList(in []SysProc, n int) []SysProc {
	agg := map[string]*SysProc{}
	for _, p := range in {
		if p.Name == "" || p.Name == "Idle" || p.Name == "System Idle Process" || p.Name == "kernel_task" {
			continue
		}
		a := agg[p.Name]
		if a == nil {
			c := p
			agg[p.Name] = &c
			continue
		}
		a.CPU = round1(a.CPU + p.CPU)
		a.RSS += p.RSS
	}
	out := make([]SysProc, 0, len(agg))
	for _, p := range agg {
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CPU != out[j].CPU {
			return out[i].CPU > out[j].CPU
		}
		return out[i].RSS > out[j].RSS
	})
	if len(out) > n {
		// guarda os n de mais CPU e completa com os de mais memória
		top := out[:n]
		byMem := append([]SysProc(nil), out[n:]...)
		sort.Slice(byMem, func(i, j int) bool { return byMem[i].RSS > byMem[j].RSS })
		if len(byMem) > n {
			byMem = byMem[:n]
		}
		out = append(append([]SysProc(nil), top...), byMem...)
	}
	return out
}

// ---------- NVIDIA (qualquer sistema) ----------

type nvidiaState struct {
	mu      sync.Mutex
	missing time.Time // quando o nvidia-smi não foi achado (tenta de novo a cada minuto)
}

func (n *nvidiaState) read() []GPU {
	n.mu.Lock()
	defer n.mu.Unlock()
	if !n.missing.IsZero() && time.Since(n.missing) < time.Minute {
		return nil
	}
	bin := "nvidia-smi"
	if runtime.GOOS == "windows" {
		if _, err := exec.LookPath(bin); err != nil {
			alt := os.Getenv("ProgramW6432") + `\NVIDIA Corporation\NVSMI\nvidia-smi.exe`
			if _, err := os.Stat(alt); err == nil {
				bin = alt
			}
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	out, err := run(ctx, bin, "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits")
	if err != nil {
		n.missing = time.Now()
		return nil
	}
	n.missing = time.Time{}
	return parseNvidia(out)
}

func parseNvidia(s string) []GPU {
	var out []GPU
	for _, l := range strings.Split(s, "\n") {
		f := strings.Split(l, ",")
		if len(f) < 5 {
			continue
		}
		for i := range f {
			f[i] = strings.TrimSpace(f[i])
		}
		g := GPU{Name: f[0], Source: "nvidia-smi"}
		g.Usage = numPtr(f[1])
		if v := numPtr(f[2]); v != nil {
			g.MemUsed = uint64(*v) * 1024 * 1024
		}
		if v := numPtr(f[3]); v != nil {
			g.MemTotal = uint64(*v) * 1024 * 1024
		}
		g.Temp = numPtr(f[4])
		out = append(out, g)
	}
	return out
}

func numPtr(s string) *float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(strings.ReplaceAll(s, ",", ".")), 64)
	if err != nil {
		return nil
	}
	return &v
}

// ---------- pedidos ----------

type sysReq struct {
	Interval int  `json:"interval"`
	Procs    bool `json:"procs"`
}

// runSys atende {"type":"sys"}: uma leitura (snapshot) ou o modo contínuo (stream) até a extensão fechar.
func runSys(first Msg, r io.Reader, w *writer) error {
	var q sysReq
	if len(first.Payload) > 0 {
		_ = json.Unmarshal(first.Payload, &q)
	}
	s := newSampler()
	send := func(snap SysSnap) error {
		b, err := json.Marshal(snap)
		if err != nil {
			return err
		}
		return w.send(Msg{Type: "sys", Op: first.Op, Payload: b, Version: version})
	}
	if first.Op != "stream" {
		s.sample(q.Procs) // a primeira leitura só serve de base para o uso da CPU e dos programas
		time.Sleep(500 * time.Millisecond)
		return send(s.sample(q.Procs))
	}
	every := time.Duration(q.Interval) * time.Millisecond
	if every < time.Second || every > 30*time.Second {
		every = 2 * time.Second
	}
	done := make(chan struct{})
	go func() { // a extensão fechou a conexão → para
		for {
			if _, err := readMsg(r); err != nil {
				close(done)
				return
			}
		}
	}()
	s.sample(q.Procs)
	tick := time.NewTicker(every)
	defer tick.Stop()
	first2 := time.After(600 * time.Millisecond)
	for {
		select {
		case <-done:
			return nil
		case <-first2:
			if err := send(s.sample(q.Procs)); err != nil {
				return nil
			}
		case <-tick.C:
			if err := send(s.sample(q.Procs)); err != nil {
				return nil
			}
		}
	}
}
