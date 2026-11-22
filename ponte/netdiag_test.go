package main

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestParsePing(t *testing.T) {
	linux := `64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=12.4 ms
64 bytes from 1.1.1.1: icmp_seq=2 ttl=57 time=13 ms
Request timeout for icmp_seq 3`
	if got := parsePing(linux); !reflect.DeepEqual(got, []float64{12.4, 13}) {
		t.Fatalf("linux: %v", got)
	}
	winPT := "Resposta de 192.168.0.1: bytes=32 tempo=3ms TTL=64\r\nResposta de 192.168.0.1: bytes=32 tempo<1ms TTL=64\r\nEsgotado o tempo limite do pedido."
	if got := parsePing(winPT); !reflect.DeepEqual(got, []float64{3, 0.5}) {
		t.Fatalf("windows pt: %v", got)
	}
	if got := parsePing("Reply from 8.8.8.8: bytes=32 time=21ms TTL=118"); !reflect.DeepEqual(got, []float64{21}) {
		t.Fatalf("windows en: %v", got)
	}
}

func TestGatewayParsers(t *testing.T) {
	route := "Iface\tDestination\tGateway \tFlags\nwlan0\t00000000\t0100A8C0\t0003\nwlan0\t0000A8C0\t00000000\t0001\n"
	if g := parseProcRoute(route); g != "192.168.0.1" {
		t.Fatalf("proc route: %q", g)
	}
	mac := "   route to: default\ndestination: default\n    gateway: 10.0.0.1\n  interface: en0\n"
	if g := parseKV(mac, "gateway"); g != "10.0.0.1" {
		t.Fatalf("mac: %q", g)
	}
	win := "IPv4 Route Table\n===\nActive Routes:\nNetwork Destination        Netmask          Gateway       Interface  Metric\n          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.20     35\n"
	if g := parseWinRoute(win); g != "192.168.1.1" {
		t.Fatalf("win: %q", g)
	}
}

func TestDNSParsers(t *testing.T) {
	if got := parseResolvConf("# x\nnameserver 192.168.0.1\nnameserver 8.8.8.8\nsearch lan\n"); !reflect.DeepEqual(got, []string{"192.168.0.1", "8.8.8.8"}) {
		t.Fatal(got)
	}
	if got := parseScutil("resolver #1\n  nameserver[0] : 192.168.0.1\n  nameserver[1] : 1.1.1.1\n"); !reflect.DeepEqual(got, []string{"192.168.0.1", "1.1.1.1"}) {
		t.Fatal(got)
	}
	if got := parseResolvectl("Global:\nLink 2 (wlan0): 192.168.0.1 fe80::1\n"); !reflect.DeepEqual(uniqIPs(got), []string{"192.168.0.1"}) {
		t.Fatal(got)
	}
	if got := uniqIPs([]string{"127.0.0.53", "1.1.1.1", "1.1.1.1", "lixo", "::1"}); !reflect.DeepEqual(got, []string{"1.1.1.1"}) {
		t.Fatal(got)
	}
}

func TestValidHost(t *testing.T) {
	for _, h := range []string{"1.1.1.1", "google.com", "fe80::1"} {
		if !validHost(h) {
			t.Fatal("deveria aceitar", h)
		}
	}
	for _, h := range []string{"-c 999 x", "a;rm -rf /", "", "$(id)"} {
		if validHost(h) {
			t.Fatal("deveria recusar", h)
		}
	}
}

func TestParseArp(t *testing.T) {
	proc := "IP address       HW type     Flags       HW address            Mask     Device\n192.168.0.1      0x1         0x2         a4:2b:b0:11:22:33     *        wlan0\n192.168.0.255    0x1         0x0         00:00:00:00:00:00     *        wlan0\n"
	win := "Interface: 192.168.0.20 --- 0xb\n  Internet Address      Physical Address      Type\n  192.168.0.1           a4-2b-b0-11-22-33     dynamic\n  192.168.0.31          8-0-27-a-b-c          dynamic\n  224.0.0.22            01-00-5e-00-00-16     static\n"
	mac := "? (192.168.0.1) at a4:2b:b0:11:22:33 on en0 ifscope [ethernet]\nrouter.lan (192.168.0.7) at 0:11:22:a:b:c on en0\n"
	if got := parseArp(proc); !reflect.DeepEqual(got, map[string]string{"192.168.0.1": "a4:2b:b0:11:22:33"}) {
		t.Fatal("proc", got)
	}
	if got := parseArp(win); !reflect.DeepEqual(got, map[string]string{"192.168.0.1": "a4:2b:b0:11:22:33", "192.168.0.31": "08:00:27:0a:0b:0c"}) {
		t.Fatal("win", got)
	}
	if got := parseArp(mac); got["192.168.0.7"] != "00:11:22:0a:0b:0c" || len(got) != 2 {
		t.Fatal("mac", got)
	}
}

func TestParseProcs(t *testing.T) {
	ss := `tcp ESTAB 0 0 192.168.0.20:51000 142.250.0.1:443 users:(("chrome",pid=812,fd=40))
tcp ESTAB 0 0 192.168.0.20:51001 142.250.0.2:443 users:(("chrome",pid=812,fd=41))
tcp ESTAB 0 0 192.168.0.20:51002 1.2.3.4:443 users:(("spotify",pid=900,fd=3))
tcp ESTAB 0 0 192.168.0.20:22 192.168.0.5:5000
`
	got := parseSS(ss)
	if len(got) != 3 || got[0].Name != "chrome" || got[0].Conns != 2 || got[2].Name != "(outros usuários ou sistema)" {
		t.Fatalf("ss: %+v", got)
	}
	win := "812|chrome|12\r\n4|System|3\r\n0|Idle|9\r\n"
	if w := parseWinProcs(win); len(w) != 2 || w[0].Name != "chrome" || w[0].Conns != 12 {
		t.Fatalf("win: %+v", w)
	}
	lsof := "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nGoogle\\x20Chrome 501 eu 30u IPv4 0x1 0t0 TCP 10.0.0.2:5000->1.1.1.1:443 (ESTABLISHED)\n"
	if l := parseLsof(lsof); len(l) != 1 || l[0].Name != "Google Chrome" {
		t.Fatalf("lsof: %+v", l)
	}
}

func TestCounters(t *testing.T) {
	dev := "Inter-|   Receive |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets\n    lo: 100 1 0 0 0 0 0 0 100 1 0 0 0 0 0 0\n wlan0: 5000 10 0 0 0 0 0 0 2000 8 0 0 0 0 0 0\n  eth0: 1000 1 0 0 0 0 0 0 500 1 0 0 0 0 0 0\n"
	if c := parseProcDev(dev); c.rx != 6000 || c.tx != 2500 {
		t.Fatalf("proc dev: %+v", c)
	}
	ib := "Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll\nlo0   16384 <Link#1>                        10     0       900       10     0       900     0\nen0   1500  <Link#6>    a4:83:e7:00:00:00   100     0     70000       50     0      3000     0\nen0   1500  192.168.0     192.168.0.20        100     -     70000       50     -      3000     -\n"
	if c := parseNetstatIB(ib); c.rx != 70000 || c.tx != 3000 {
		t.Fatalf("netstat: %+v", c)
	}
}

// Pedido de diagnóstico pelo native messaging: responde uma vez e fecha.
func TestNativeNetInfo(t *testing.T) {
	var in bytes.Buffer
	msg, _ := json.Marshal(Msg{Type: "net", Op: "info"})
	in.Write([]byte{byte(len(msg)), 0, 0, 0})
	in.Write(msg)
	f, _ := os.CreateTemp(t.TempDir(), "in")
	f.Write(in.Bytes())
	f.Seek(0, 0)
	out, _ := os.CreateTemp(t.TempDir(), "out")
	if err := runNative(f, out); err != nil {
		t.Fatal(err)
	}
	out.Seek(0, 0)
	m, err := readMsg(out)
	if err != nil || m.Type != "net" || m.Op != "info" {
		t.Fatalf("%v %+v", err, m)
	}
	var info map[string]any
	if err := json.Unmarshal(m.Payload, &info); err != nil || info["os"] == "" {
		t.Fatalf("%v %s", err, m.Payload)
	}
	bad, _ := handleNet("rm", nil)
	if bad != nil {
		t.Fatal("op desconhecida deveria falhar")
	}
}
