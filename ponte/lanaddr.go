package main

// Endereços da rede local (0.9.2.2): o QR precisa do IP do Wi-Fi/Ethernet, não de adaptadores
// virtuais ou de VPN (Cloudflare WARP 172.16.0.2, Hyper-V/WSL, Docker, VirtualBox, Tailscale…),
// que o celular não alcança. Cada endereço ganha uma nota; o melhor vem primeiro.

import (
	"context"
	"fmt"
	"net"
	"runtime"
	"sort"
	"strings"
	"time"
)

type LanAddr struct {
	URL       string `json:"url"`
	IP        string `json:"ip"`
	Iface     string `json:"iface"`
	Virtual   bool   `json:"virtual,omitempty"`   // adaptador virtual ou VPN: o celular quase nunca alcança
	PublicNet bool   `json:"publicNet,omitempty"` // Windows: rede marcada como Pública (o firewall bloqueia)
	score     int
}

type addrCand struct {
	IP    net.IP
	Iface string
	HW    bool // tem endereço físico (MAC)
	P2P   bool // ponto a ponto (túnel)
}

var virtualNames = []string{
	"vethernet", "hyper-v", "virtualbox", "vbox", "vmware", "vmnet", "docker", "br-", "veth", "virbr", "wsl", "lxc", "lxd",
	"podman", "cni", "flannel", "warp", "cloudflare", "tailscale", "zerotier", "wireguard", "wg", "tun", "tap", "utun",
	"vpn", "ppp", "nordlynx", "proton", "openvpn", "fortinet", "anyconnect", "cisco", "hamachi", "radmin", "npcap",
	"loopback", "bluetooth", "awdl", "llw", "bridge", "mullvad", "expressvpn", "surfshark", "windscribe",
}

var physicalNames = []string{"wi-fi", "wifi", "wlan", "wlp", "wireless", "ethernet", "eth", "enp", "eno", "ens", "en0", "en1", "conexão local", "local area connection", "rede sem fio"}

func hasAny(name string, list []string) bool {
	for _, k := range list {
		if strings.Contains(name, k) {
			return true
		}
	}
	return false
}

func scoreAddr(c addrCand, primary string) (int, bool) {
	ip4 := c.IP.To4()
	s := 0
	switch {
	case ip4[0] == 192 && ip4[1] == 168:
		s = 30
	case ip4[0] == 10:
		s = 20
	default: // 172.16–31: comum em Docker, WSL, Hyper-V e VPNs
		s = 10
	}
	name := strings.ToLower(c.Iface)
	virtual := hasAny(name, virtualNames) && !strings.HasPrefix(name, "wi-fi") && !strings.HasPrefix(name, "ethernet")
	if virtual {
		s -= 100
	}
	if !c.HW || c.P2P {
		s -= 60
		virtual = true
	}
	if hasAny(name, physicalNames) && !virtual {
		s += 20
	}
	if c.IP.String() == primary {
		s += 15
	}
	return s, virtual
}

// rankAddrs ordena os candidatos: Wi-Fi/Ethernet de casa primeiro, virtuais e VPN por último.
func rankAddrs(cands []addrCand, port int, primary string) []LanAddr {
	var out []LanAddr
	seen := map[string]bool{}
	for _, c := range cands {
		if c.IP.To4() == nil || !c.IP.IsPrivate() || seen[c.IP.String()] {
			continue
		}
		seen[c.IP.String()] = true
		sc, virt := scoreAddr(c, primary)
		out = append(out, LanAddr{URL: fmt.Sprintf("http://%s:%d", c.IP, port), IP: c.IP.String(), Iface: c.Iface, Virtual: virt, score: sc})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].score > out[j].score })
	return out
}

// primaryIP é o endereço que o sistema usaria para sair (UDP não manda nada ao "conectar").
func primaryIP() string {
	c, err := net.Dial("udp", "192.0.2.1:9")
	if err != nil {
		return ""
	}
	defer c.Close()
	if a, ok := c.LocalAddr().(*net.UDPAddr); ok {
		return a.IP.String()
	}
	return ""
}

func lanCandidates() []addrCand {
	var out []addrCand
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok {
				out = append(out, addrCand{IP: ipn.IP, Iface: i.Name, HW: len(i.HardwareAddr) > 0, P2P: i.Flags&net.FlagPointToPoint != 0})
			}
		}
	}
	return out
}

// lanAddrs: endereços desta máquina na rede local, o melhor primeiro (no Windows, com o perfil da rede).
func lanAddrs(port int) []LanAddr {
	out := rankAddrs(lanCandidates(), port, primaryIP())
	if runtime.GOOS == "windows" {
		markPublic(out, windowsProfiles())
	}
	return out
}

// lanURLs devolve só os endereços, na mesma ordem (o melhor primeiro).
func lanURLs(port int) []string {
	var out []string
	for _, a := range lanAddrs(port) {
		out = append(out, a.URL)
	}
	return out
}

// windowsProfiles: nome do adaptador → categoria da rede (Public, Private, DomainAuthenticated).
func windowsProfiles() map[string]string {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	out, err := powershell(ctx, "Get-NetConnectionProfile | ForEach-Object { '{0}|{1}' -f $_.InterfaceAlias, $_.NetworkCategory }")
	if err != nil {
		return nil
	}
	return parseProfiles(out)
}

func parseProfiles(out string) map[string]string {
	m := map[string]string{}
	for _, l := range strings.Split(out, "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(l), "|"); ok && k != "" {
			m[strings.ToLower(k)] = v
		}
	}
	return m
}

func markPublic(addrs []LanAddr, prof map[string]string) {
	for i := range addrs {
		if strings.EqualFold(prof[strings.ToLower(addrs[i].Iface)], "Public") {
			addrs[i].PublicNet = true
		}
	}
}

// firewallScript libera a Ponte no Firewall do Windows nas redes privadas e de domínio, nas portas que ela usa.
// Antes, apaga as regras antigas do programa (inclusive o "Bloquear" criado quando o aviso do Windows foi cancelado).
func firewallScript(exe string) string {
	return strings.Join([]string{
		"@echo off",
		`netsh advfirewall firewall delete rule name=all program="` + exe + `" >nul 2>&1`,
		`netsh advfirewall firewall delete rule name="NeuroTab Ponte" >nul 2>&1`,
		`netsh advfirewall firewall add rule name="NeuroTab Ponte" dir=in action=allow program="` + exe + `" enable=yes profile=private,domain protocol=TCP localport=41414-41423`,
		"",
	}, "\r\n")
}
