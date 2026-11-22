package main

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestParseProcStat(t *testing.T) {
	s := "cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 50 0 50 350 50 0 0 0 0 0\ncpu1 50 0 50 350 50 0 0 0 0 0\nintr 1\n"
	c := parseProcStat(s)
	if len(c) != 3 || c[0].total != 1000 || c[0].idle != 800 {
		t.Fatalf("%+v", c)
	}
	b := parseProcStat("cpu  200 0 200 750 150 0 0 0 0 0\n") // +300 no total, +100 ocioso
	if u := cpuUsage(c[0], b[0]); u != 66.7 {
		t.Fatalf("uso %v", u)
	}
}

func TestParseMeminfo(t *testing.T) {
	m := parseMeminfo("MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    6000000 kB\nSwapTotal:       2000000 kB\nSwapFree:        1500000 kB\n")
	if m.Total != 16000000*1024 || m.Available != 6000000*1024 || m.SwapUsed != 500000*1024 {
		t.Fatalf("%+v", m)
	}
}

func TestParseMounts(t *testing.T) {
	s := `/dev/nvme0n1p2 / ext4 rw 0 0
proc /proc proc rw 0 0
/dev/nvme0n1p1 /boot/efi vfat rw 0 0
/dev/sda1 /media/eu/Backup\040HD ntfs3 rw 0 0
/dev/nvme0n1p2 /var/snap ext4 rw 0 0
tmpfs /run tmpfs rw 0 0
/dev/loop3 /snap/core/1 squashfs ro 0 0
`
	m := parseMounts(s)
	if len(m) != 2 || m[0].mount != "/" || m[1].mount != "/media/eu/Backup HD" {
		t.Fatalf("%+v", m)
	}
}

func TestHwmonAndThermal(t *testing.T) {
	d := t.TempDir()
	w := func(p, v string) {
		os.MkdirAll(filepath.Dir(filepath.Join(d, p)), 0o755)
		os.WriteFile(filepath.Join(d, p), []byte(v), 0o644)
	}
	w("hwmon0/name", "k10temp\n")
	w("hwmon0/temp1_input", "61250\n")
	w("hwmon0/temp1_label", "Tctl\n")
	w("hwmon1/name", "nvme\n")
	w("hwmon1/temp1_input", "38850\n")
	w("hwmon2/name", "amdgpu\n")
	w("hwmon2/temp1_input", "52000\n")
	ts := readHwmon(d)
	if len(ts) != 3 || ts[0].Kind != "cpu" || ts[0].C != 61.3 || ts[0].Label != "k10temp Tctl" || ts[1].Kind != "disk" || ts[2].Kind != "gpu" {
		t.Fatalf("%+v", ts)
	}
	if c := cpuTemp(ts); c == nil || *c != 61.3 {
		t.Fatal("cpu temp")
	}
	w("thermal_zone0/type", "x86_pkg_temp\n")
	w("thermal_zone0/temp", "55000\n")
	if z := readThermalZones(d); len(z) != 1 || z[0].Kind != "cpu" || z[0].C != 55 {
		t.Fatalf("%+v", z)
	}
}

func TestParseNvidia(t *testing.T) {
	g := parseNvidia("NVIDIA GeForce RTX 3060, 37, 2048, 12288, 64\nNVIDIA X, [N/A], 10, 100, [N/A]\n")
	if len(g) != 2 || g[0].Name != "NVIDIA GeForce RTX 3060" || *g[0].Usage != 37 || g[0].MemTotal != 12288<<20 || *g[0].Temp != 64 || g[1].Usage != nil || g[1].Temp != nil {
		t.Fatalf("%+v", g)
	}
}

func TestMacParsers(t *testing.T) {
	df := "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1s1 494384795 10000000 300000000 4% /\n/dev/disk3s6 494384795 2000000 300000000 1% /System/Volumes/VM\n/dev/disk5s1 976762584 500000000 476762584 52% /Volumes/Meu HD\n"
	d := parseDf(df)
	if len(d) != 2 || d[1].Mount != "/Volumes/Meu HD" || d[0].Free != 300000000*1024 {
		t.Fatalf("%+v", d)
	}
	vm := "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                               10000.\nPages active:                            50000.\nPages inactive:                          20000.\nPages speculative:                        5000.\nPages purgeable:                          1000.\n"
	if m := parseVmStat(vm, 8<<30); m.Available != 36000*16384 {
		t.Fatalf("%+v", m)
	}
	b := parsePmset("Now drawing from 'AC Power'\n -InternalBattery-0 (id=123)\t87%; charging; 0:40 remaining present: true\n")
	if b == nil || b.Percent != 87 || !b.Charging || !b.Plugged {
		t.Fatalf("%+v", b)
	}
	if parseBoottime("{ sec = 1700000000, usec = 1 } Tue Nov 14") != 1700000000 {
		t.Fatal("boottime")
	}
	ps := parsePs("  1   0,5  1024 /sbin/launchd\n 500  42.0 204800 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n")
	if ps[500].name != "Google Chrome" || ps[500].cpu != 42 || ps[1].cpu != 0.5 || ps[500].rss != 204800*1024 {
		t.Fatalf("%+v", ps)
	}
}

func TestWinProcs(t *testing.T) {
	p := parseWinProcCSV("812|chrome|120.5|409600000\r\n0|Idle|0|8192\r\n4|System|33.25|1000\r\n")
	if len(p) != 2 || p[812].cpu != 120.5 || p[812].rss != 409600000 {
		t.Fatalf("%+v", p)
	}
}

func TestTopProcs(t *testing.T) {
	prev := map[int]procTime{1: {"chrome", 10, 100}, 2: {"chrome", 5, 100}, 3: {"code", 1, 900}}
	cur := map[int]procTime{1: {"chrome", 12, 100}, 2: {"chrome", 6, 100}, 3: {"code", 1, 900}, 4: {"novo", 0, 10}}
	top := topProcs(prev, cur, 1, 4, 6) // 3 s de CPU em 1 s com 4 núcleos = 75%
	if top[0].Name != "chrome" || top[0].CPU != 75 || top[0].RSS != 200 {
		t.Fatalf("%+v", top)
	}
}

func TestPidStat(t *testing.T) {
	name, ticks, ok := parseProcPidStat("1234 (Web Content (x)) S 1 2 3 4 5 6 7 8 9 10 250 50 0 0")
	if !ok || name != "Web Content (x)" || ticks != 300 {
		t.Fatal(name, ticks, ok)
	}
}

// Leitura de verdade neste computador (Linux no CI): CPU, memória e o modo contínuo pela conexão nativa.
func TestSysSnapshotAndStream(t *testing.T) {
	s := newSampler()
	s.sample(true)
	time.Sleep(300 * time.Millisecond)
	snap := s.sample(true)
	if snap.OS != runtime.GOOS || snap.CPU.Cores < 1 {
		t.Fatalf("%+v", snap)
	}
	if runtime.GOOS == "linux" && (snap.CPU.Usage == nil || snap.Mem == nil || snap.Mem.Total == 0) {
		t.Fatalf("linux sem CPU/memória: %+v", snap)
	}
	// stream: manda leituras até a entrada fechar
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	go func() {
		msg, _ := json.Marshal(Msg{Type: "sys", Op: "stream", Payload: json.RawMessage(`{"interval":1000,"procs":true}`)})
		inW.Write([]byte{byte(len(msg)), 0, 0, 0})
		inW.Write(msg)
	}()
	done := make(chan error, 1)
	go func() {
		first, err := readMsg(bufio.NewReader(inR))
		if err != nil {
			done <- err
			return
		}
		done <- runSys(*first, inR, &writer{w: outW})
	}()
	br := bufio.NewReader(outR)
	for i := 0; i < 2; i++ {
		m, err := readMsg(br)
		if err != nil || m.Type != "sys" || m.Op != "stream" {
			t.Fatalf("%v %+v", err, m)
		}
		var got SysSnap
		if err := json.Unmarshal(m.Payload, &got); err != nil || got.At == 0 {
			t.Fatalf("%v %s", err, m.Payload)
		}
	}
	inW.Close()
	go io.Copy(io.Discard, br)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("o modo contínuo não parou ao fechar a conexão")
	}
}
