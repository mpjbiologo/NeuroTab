package main

// Diagnóstico de rede para o widget Rede da NeuroTab (0.7.9, #52) — o que o navegador sozinho não consegue:
// ping de verdade (ICMP, pelo comando ping do sistema), DNS clássico por UDP (inclusive o da operadora e o do
// roteador), aparelhos na rede local (tabela ARP), programas com conexões abertas e o uso total da placa de rede.
//
// Cada pedido chega numa mensagem {"type":"net","op":"…","payload":{…}} (chrome.runtime.sendNativeMessage),
// é respondido com {"type":"net","payload":{…}} e o programa fecha. Nada é enviado para fora do computador
// além dos próprios pings e consultas de DNS.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type netReq struct {
	Hosts   []string `json:"hosts"`
	Count   int      `json:"count"`
	Servers []string `json:"servers"`
	Names   []string `json:"names"`
	Scan    bool     `json:"scan"`
}

func handleNet(op string, raw json.RawMessage) (any, error) {
	var q netReq
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &q); err != nil {
			return nil, err
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	switch op {
	case "info":
		return map[string]any{"gateway": gateway(ctx), "dns": systemDNS(ctx), "os": runtime.GOOS, "version": version, "ips": localIPs()}, nil
	case "ping":
		return pingMany(ctx, q.Hosts, q.Count), nil
	case "dns":
		return dnsBench(ctx, q.Servers, q.Names), nil
	case "devices":
		return devices(ctx, q.Scan), nil
	case "procs":
		return procs(ctx)
	case "usage":
		return usage(ctx)
	}
	return nil, fmt.Errorf("pedido desconhecido: %s", op)
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C")
	hideWindow(cmd)
	out, err := cmd.Output()
	return string(out), err
}

func powershell(ctx context.Context, script string) (string, error) {
	return run(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; "+script)
}

// ---------- endereços ----------

var hostRe = regexp.MustCompile(`^[A-Za-z0-9.:\-]{1,253}$`)

// validHost recusa qualquer coisa que pudesse virar opção de linha de comando.
func validHost(h string) bool { return hostRe.MatchString(h) && !strings.HasPrefix(h, "-") }

func localIPs() []string {
	var out []string
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && !n.IP.IsLinkLocalUnicast() {
				out = append(out, n.String())
			}
		}
	}
	return out
}

func gateway(ctx context.Context) string {
	switch runtime.GOOS {
	case "linux":
		b, err := os.ReadFile("/proc/net/route")
		if err == nil {
			return parseProcRoute(string(b))
		}
	case "darwin":
		out, _ := run(ctx, "route", "-n", "get", "default")
		return parseKV(out, "gateway")
	case "windows":
		out, _ := run(ctx, "route", "print", "-4", "0.0.0.0")
		return parseWinRoute(out)
	}
	return ""
}

// parseProcRoute lê /proc/net/route: a rota 00000000 traz o roteador em hexadecimal invertido.
func parseProcRoute(s string) string {
	sc := bufio.NewScanner(strings.NewReader(s))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) >= 3 && f[1] == "00000000" && f[2] != "00000000" {
			v, err := strconv.ParseUint(f[2], 16, 32)
			if err != nil {
				continue
			}
			return net.IPv4(byte(v), byte(v>>8), byte(v>>16), byte(v>>24)).String()
		}
	}
	return ""
}

func parseKV(s, key string) string {
	for _, l := range strings.Split(s, "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(l), ":")
		if ok && strings.EqualFold(strings.TrimSpace(k), key) {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func parseWinRoute(s string) string {
	for _, l := range strings.Split(s, "\n") {
		f := strings.Fields(l)
		if len(f) >= 5 && f[0] == "0.0.0.0" && f[1] == "0.0.0.0" && net.ParseIP(f[2]) != nil {
			return f[2]
		}
	}
	return ""
}

func systemDNS(ctx context.Context) []string {
	var list []string
	switch runtime.GOOS {
	case "linux":
		if out, err := run(ctx, "resolvectl", "dns"); err == nil {
			list = parseResolvectl(out)
		}
		if len(list) == 0 {
			b, _ := os.ReadFile("/etc/resolv.conf")
			list = parseResolvConf(string(b))
		}
	case "darwin":
		out, _ := run(ctx, "scutil", "--dns")
		list = parseScutil(out)
	case "windows":
		out, _ := powershell(ctx, "(Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object {$_.ServerAddresses} | Select-Object -ExpandProperty ServerAddresses) -join ' '")
		list = strings.Fields(out)
	}
	return uniqIPs(list)
}

func parseResolvConf(s string) []string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		f := strings.Fields(l)
		if len(f) >= 2 && f[0] == "nameserver" {
			out = append(out, f[1])
		}
	}
	return out
}

func parseResolvectl(s string) []string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		_, v, ok := strings.Cut(l, ":")
		if !ok {
			continue
		}
		out = append(out, strings.Fields(v)...)
	}
	return out
}

var scutilRe = regexp.MustCompile(`nameserver\[\d+\]\s*:\s*(\S+)`)

func parseScutil(s string) []string {
	var out []string
	for _, m := range scutilRe.FindAllStringSubmatch(s, -1) {
		out = append(out, m[1])
	}
	return out
}

// uniqIPs fica só com IPv4 válidos, sem o DNS local de cache (127.x), sem repetir.
func uniqIPs(list []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, x := range list {
		ip := net.ParseIP(x)
		if ip == nil || ip.To4() == nil || ip.IsLoopback() || seen[x] {
			continue
		}
		seen[x] = true
		out = append(out, x)
	}
	return out
}

// ---------- ping ----------

type pingResult struct {
	Host    string    `json:"host"`
	Samples []float64 `json:"samples"`
	Sent    int       `json:"sent"`
	Error   string    `json:"error,omitempty"`
}

// O ping do Windows em português escreve "tempo=12ms"; outros idiomas, "time=", "Zeit=", "temps=", "tiempo=".
var pingRe = regexp.MustCompile(`(?i)(?:time|tempo|zeit|temps|tiempo|durata)\s*([=<])\s*([\d.,]+)\s*ms`)

func parsePing(out string) []float64 {
	var v []float64
	for _, m := range pingRe.FindAllStringSubmatch(out, -1) {
		f, err := strconv.ParseFloat(strings.ReplaceAll(m[2], ",", "."), 64)
		if err != nil {
			continue
		}
		if m[1] == "<" { // "tempo<1ms"
			f = f / 2
		}
		v = append(v, f)
	}
	return v
}

func pingArgs(host string, count int) []string {
	c := strconv.Itoa(count)
	switch runtime.GOOS {
	case "windows":
		return []string{"-n", c, "-w", "1500", host}
	case "darwin":
		return []string{"-c", c, "-W", "1500", host}
	default:
		return []string{"-c", c, "-W", "2", "-i", "0.2", host}
	}
}

func pingMany(ctx context.Context, hosts []string, count int) []pingResult {
	if count < 1 || count > 30 {
		count = 10
	}
	if len(hosts) > 8 {
		hosts = hosts[:8]
	}
	out := make([]pingResult, len(hosts))
	var wg sync.WaitGroup
	for i, h := range hosts {
		out[i] = pingResult{Host: h, Sent: count, Samples: []float64{}}
		if !validHost(h) {
			out[i].Error = "endereço inválido"
			continue
		}
		wg.Add(1)
		go func(i int, h string) {
			defer wg.Done()
			s, err := run(ctx, "ping", pingArgs(h, count)...)
			out[i].Samples = parsePing(s)
			if len(out[i].Samples) == 0 && err != nil {
				out[i].Error = "sem resposta"
			}
		}(i, h)
	}
	wg.Wait()
	return out
}

// ---------- DNS por UDP ----------

type dnsResult struct {
	Server  string     `json:"server"`
	Samples []*float64 `json:"samples"`
}

func dnsBench(ctx context.Context, servers, names []string) []dnsResult {
	if len(names) == 0 || len(names) > 20 {
		names = []string{"google.com", "youtube.com", "whatsapp.com", "wikipedia.org"}
	}
	if len(servers) > 12 {
		servers = servers[:12]
	}
	out := make([]dnsResult, 0, len(servers))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, s := range servers {
		if net.ParseIP(s) == nil {
			continue
		}
		wg.Add(1)
		go func(s string) {
			defer wg.Done()
			r := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
				d := net.Dialer{Timeout: 2 * time.Second}
				return d.DialContext(ctx, "udp", net.JoinHostPort(s, "53"))
			}}
			res := dnsResult{Server: s}
			for _, n := range names {
				c, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
				t0 := time.Now()
				_, err := r.LookupHost(c, n)
				cancel()
				if err != nil {
					res.Samples = append(res.Samples, nil)
					continue
				}
				ms := float64(time.Since(t0).Microseconds()) / 1000
				res.Samples = append(res.Samples, &ms)
			}
			mu.Lock()
			out = append(out, res)
			mu.Unlock()
		}(s)
	}
	wg.Wait()
	sort.Slice(out, func(i, j int) bool { return out[i].Server < out[j].Server })
	return out
}

// ---------- aparelhos na rede local ----------

type device struct {
	IP      string `json:"ip"`
	MAC     string `json:"mac"`
	Name    string `json:"name,omitempty"`
	Self    bool   `json:"self,omitempty"`
	Gateway bool   `json:"gateway,omitempty"`
}

var arpRe = regexp.MustCompile(`(\d{1,3}(?:\.\d{1,3}){3})\b.*?\b((?:[0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2})\b`)

// parseArp entende /proc/net/arp e a saída do "arp -a" (Linux, macOS e Windows).
func parseArp(s string) map[string]string {
	out := map[string]string{}
	for _, l := range strings.Split(s, "\n") {
		m := arpRe.FindStringSubmatch(l)
		if m == nil {
			continue
		}
		mac := normMAC(m[2])
		if mac == "00:00:00:00:00:00" || mac == "ff:ff:ff:ff:ff:ff" || strings.HasPrefix(mac, "01:00:5e") || strings.HasPrefix(mac, "33:33") {
			continue
		}
		out[m[1]] = mac
	}
	return out
}

func normMAC(m string) string {
	parts := strings.FieldsFunc(strings.ToLower(m), func(r rune) bool { return r == ':' || r == '-' })
	for i, p := range parts {
		if len(p) == 1 {
			parts[i] = "0" + p
		}
	}
	return strings.Join(parts, ":")
}

func arpTable(ctx context.Context) map[string]string {
	if runtime.GOOS == "linux" {
		if b, err := os.ReadFile("/proc/net/arp"); err == nil {
			return parseArp(string(b))
		}
	}
	out, _ := run(ctx, "arp", "-a")
	return parseArp(out)
}

// sweep cutuca cada endereço da rede /24 (conexão TCP rápida) para o sistema preencher a tabela ARP.
func sweep(ctx context.Context, cidr string) {
	ip, n, err := net.ParseCIDR(cidr)
	if err != nil || ip.To4() == nil {
		return
	}
	ones, _ := n.Mask.Size()
	if ones < 24 { // redes maiores: só a /24 do próprio computador
		n = &net.IPNet{IP: ip.Mask(net.CIDRMask(24, 32)), Mask: net.CIDRMask(24, 32)}
	}
	base := n.IP.To4()
	sem := make(chan struct{}, 64)
	var wg sync.WaitGroup
	for i := 1; i < 255; i++ {
		t := net.IPv4(base[0], base[1], base[2], byte(i))
		if !n.Contains(t) || t.Equal(ip) {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(t net.IP) {
			defer wg.Done()
			defer func() { <-sem }()
			d := net.Dialer{Timeout: 350 * time.Millisecond}
			if c, err := d.DialContext(ctx, "tcp", net.JoinHostPort(t.String(), "80")); err == nil {
				c.Close()
			}
		}(t)
	}
	wg.Wait()
}

func devices(ctx context.Context, scan bool) []device {
	ips := localIPs()
	gw := gateway(ctx)
	if scan && len(ips) > 0 {
		sweep(ctx, ips[0])
	}
	table := arpTable(ctx)
	self := map[string]bool{}
	for _, c := range ips {
		if ip, _, err := net.ParseCIDR(c); err == nil {
			self[ip.String()] = true
			if _, ok := table[ip.String()]; !ok {
				table[ip.String()] = ""
			}
		}
	}
	out := make([]device, 0, len(table))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 16)
	for ip, mac := range table {
		wg.Add(1)
		sem <- struct{}{}
		go func(ip, mac string) {
			defer wg.Done()
			defer func() { <-sem }()
			d := device{IP: ip, MAC: mac, Self: self[ip], Gateway: ip == gw}
			c, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
			if names, err := net.DefaultResolver.LookupAddr(c, ip); err == nil && len(names) > 0 {
				d.Name = strings.TrimSuffix(names[0], ".")
			}
			cancel()
			if d.Self && d.Name == "" {
				d.Name, _ = os.Hostname()
			}
			mu.Lock()
			out = append(out, d)
			mu.Unlock()
		}(ip, mac)
	}
	wg.Wait()
	sort.Slice(out, func(i, j int) bool { return ipLess(out[i].IP, out[j].IP) })
	return out
}

func ipLess(a, b string) bool {
	x, y := net.ParseIP(a).To4(), net.ParseIP(b).To4()
	if x == nil || y == nil {
		return a < b
	}
	for i := 0; i < 4; i++ {
		if x[i] != y[i] {
			return x[i] < y[i]
		}
	}
	return false
}

// ---------- programas com conexões ----------

type proc struct {
	Name  string `json:"name"`
	PID   int    `json:"pid,omitempty"`
	Conns int    `json:"conns"`
}

func procs(ctx context.Context) ([]proc, error) {
	switch runtime.GOOS {
	case "linux":
		out, err := run(ctx, "ss", "-tunpH", "state", "established")
		if err != nil {
			return nil, errors.New("o comando ss não está disponível")
		}
		return parseSS(out), nil
	case "darwin":
		out, _ := run(ctx, "lsof", "-nP", "-i", "-sTCP:ESTABLISHED")
		return parseLsof(out), nil
	case "windows":
		out, err := powershell(ctx, "Get-NetTCPConnection -State Established | Group-Object OwningProcess | ForEach-Object { $p = Get-Process -Id $_.Name -ErrorAction SilentlyContinue; '{0}|{1}|{2}' -f $_.Name, $(if ($p) { $p.ProcessName } else { '?' }), $_.Count }")
		if err != nil {
			return nil, errors.New("não consegui listar as conexões")
		}
		return parseWinProcs(out), nil
	}
	return nil, errors.New("sistema não suportado")
}

var ssUserRe = regexp.MustCompile(`\("([^"]+)",pid=(\d+)`)

func parseSS(s string) []proc {
	agg := map[string]*proc{}
	other := 0
	for _, l := range strings.Split(s, "\n") {
		if strings.TrimSpace(l) == "" {
			continue
		}
		m := ssUserRe.FindStringSubmatch(l)
		if m == nil {
			other++
			continue
		}
		p := agg[m[1]]
		if p == nil {
			pid, _ := strconv.Atoi(m[2])
			p = &proc{Name: m[1], PID: pid}
			agg[m[1]] = p
		}
		p.Conns++
	}
	return finishProcs(agg, other)
}

func parseLsof(s string) []proc {
	agg := map[string]*proc{}
	for i, l := range strings.Split(s, "\n") {
		f := strings.Fields(l)
		if i == 0 || len(f) < 2 {
			continue
		}
		name := strings.ReplaceAll(f[0], `\x20`, " ")
		p := agg[name]
		if p == nil {
			pid, _ := strconv.Atoi(f[1])
			p = &proc{Name: name, PID: pid}
			agg[name] = p
		}
		p.Conns++
	}
	return finishProcs(agg, 0)
}

func parseWinProcs(s string) []proc {
	agg := map[string]*proc{}
	for _, l := range strings.Split(s, "\n") {
		f := strings.Split(strings.TrimSpace(l), "|")
		if len(f) != 3 {
			continue
		}
		pid, _ := strconv.Atoi(f[0])
		n, _ := strconv.Atoi(f[2])
		if pid == 0 || n == 0 {
			continue
		}
		p := agg[f[1]]
		if p == nil {
			p = &proc{Name: f[1], PID: pid}
			agg[f[1]] = p
		}
		p.Conns += n
	}
	return finishProcs(agg, 0)
}

func finishProcs(agg map[string]*proc, other int) []proc {
	out := make([]proc, 0, len(agg)+1)
	for _, p := range agg {
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Conns > out[j].Conns || (out[i].Conns == out[j].Conns && out[i].Name < out[j].Name)
	})
	if len(out) > 40 {
		out = out[:40]
	}
	if other > 0 { // o que o sistema não deixa ver (outros usuários) vai sempre por último
		out = append(out, proc{Name: "(outros usuários ou sistema)", Conns: other})
	}
	return out
}

// ---------- uso total da rede agora ----------

type counters struct{ rx, tx uint64 }

func readCounters(ctx context.Context) (counters, error) {
	switch runtime.GOOS {
	case "linux":
		b, err := os.ReadFile("/proc/net/dev")
		if err != nil {
			return counters{}, err
		}
		return parseProcDev(string(b)), nil
	case "darwin":
		out, err := run(ctx, "netstat", "-ib")
		if err != nil {
			return counters{}, err
		}
		return parseNetstatIB(out), nil
	case "windows":
		out, err := powershell(ctx, "$s = Get-NetAdapterStatistics; '{0} {1}' -f ($s | Measure-Object -Property ReceivedBytes -Sum).Sum, ($s | Measure-Object -Property SentBytes -Sum).Sum")
		if err != nil {
			return counters{}, err
		}
		f := strings.Fields(out)
		if len(f) != 2 {
			return counters{}, errors.New("resposta inesperada")
		}
		rx, _ := strconv.ParseUint(f[0], 10, 64)
		tx, _ := strconv.ParseUint(f[1], 10, 64)
		return counters{rx, tx}, nil
	}
	return counters{}, errors.New("sistema não suportado")
}

func parseProcDev(s string) counters {
	var c counters
	for _, l := range strings.Split(s, "\n") {
		name, rest, ok := strings.Cut(l, ":")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		if name == "lo" || strings.HasPrefix(name, "docker") || strings.HasPrefix(name, "veth") || strings.HasPrefix(name, "br-") {
			continue
		}
		f := strings.Fields(rest)
		if len(f) < 9 {
			continue
		}
		rx, _ := strconv.ParseUint(f[0], 10, 64)
		tx, _ := strconv.ParseUint(f[8], 10, 64)
		c.rx += rx
		c.tx += tx
	}
	return c
}

// parseNetstatIB soma a linha <Link#…> de cada placa (as outras linhas repetem os mesmos contadores).
func parseNetstatIB(s string) counters {
	var c counters
	seen := map[string]bool{}
	lines := strings.Split(s, "\n")
	if len(lines) == 0 {
		return c
	}
	head := strings.Fields(lines[0])
	ib, ob := -1, -1
	for i, h := range head {
		switch h {
		case "Ibytes":
			ib = i
		case "Obytes":
			ob = i
		}
	}
	for _, l := range lines[1:] {
		f := strings.Fields(l)
		if len(f) < len(head) || !strings.HasPrefix(f[2], "<Link") || seen[f[0]] || strings.HasPrefix(f[0], "lo") {
			continue
		}
		seen[f[0]] = true
		if ib >= 0 && ob >= 0 {
			rx, _ := strconv.ParseUint(f[ib], 10, 64)
			tx, _ := strconv.ParseUint(f[ob], 10, 64)
			c.rx += rx
			c.tx += tx
		}
	}
	return c
}

func usage(ctx context.Context) (map[string]float64, error) {
	a, err := readCounters(ctx)
	if err != nil {
		return nil, err
	}
	t0 := time.Now()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(time.Second):
	}
	b, err := readCounters(ctx)
	if err != nil {
		return nil, err
	}
	secs := time.Since(t0).Seconds()
	rate := func(x, y uint64) float64 {
		if y < x {
			return 0
		}
		return float64(y-x) * 8 / secs / 1e6
	}
	return map[string]float64{"downMbps": rate(a.rx, b.rx), "upMbps": rate(a.tx, b.tx)}, nil
}
