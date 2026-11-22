package main

// Leitores de texto do widget Sistema, sem dependência de sistema (testados em sys_test.go).

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// parseProcStat lê /proc/stat: [máquina toda, núcleo 0, núcleo 1, …].
func parseProcStat(s string) []cpuTimes {
	var out []cpuTimes
	for _, l := range strings.Split(s, "\n") {
		if !strings.HasPrefix(l, "cpu") {
			continue
		}
		f := strings.Fields(l)
		if len(f) < 5 {
			continue
		}
		var total, idle float64
		for i, x := range f[1:] {
			v, _ := strconv.ParseFloat(x, 64)
			if i >= 8 { // guest e guest_nice já estão em user/nice
				break
			}
			total += v
			if i == 3 || i == 4 { // idle + iowait
				idle += v
			}
		}
		out = append(out, cpuTimes{total, idle})
	}
	return out
}

// parseMeminfo lê /proc/meminfo (valores em kB).
func parseMeminfo(s string) *MemInfo {
	kv := map[string]uint64{}
	for _, l := range strings.Split(s, "\n") {
		k, v, ok := strings.Cut(l, ":")
		if !ok {
			continue
		}
		f := strings.Fields(v)
		if len(f) == 0 {
			continue
		}
		n, _ := strconv.ParseUint(f[0], 10, 64)
		kv[k] = n * 1024
	}
	if kv["MemTotal"] == 0 {
		return nil
	}
	avail := kv["MemAvailable"]
	if avail == 0 {
		avail = kv["MemFree"] + kv["Buffers"] + kv["Cached"]
	}
	m := &MemInfo{Total: kv["MemTotal"], Available: avail, SwapTotal: kv["SwapTotal"]}
	if kv["SwapTotal"] >= kv["SwapFree"] {
		m.SwapUsed = kv["SwapTotal"] - kv["SwapFree"]
	}
	return m
}

var realFS = map[string]bool{"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "vfat": true, "exfat": true, "ntfs": true, "ntfs3": true, "fuseblk": true, "f2fs": true, "zfs": true, "jfs": true, "reiserfs": true, "hfsplus": true, "apfs": true}

type mountEntry struct{ dev, mount, fs string }

// parseMounts: só sistemas de arquivos de disco de verdade, um ponto por dispositivo (o mais curto).
func parseMounts(s string) []mountEntry {
	byDev := map[string]mountEntry{}
	for _, l := range strings.Split(s, "\n") {
		f := strings.Fields(l)
		if len(f) < 3 || !realFS[f[2]] {
			continue
		}
		if !strings.HasPrefix(f[0], "/dev/") && f[2] != "zfs" {
			continue
		}
		mount := strings.ReplaceAll(f[1], `\040`, " ")
		if strings.HasPrefix(mount, "/snap/") || strings.HasPrefix(mount, "/boot/efi") || strings.HasPrefix(mount, "/var/lib/docker") {
			continue
		}
		if old, ok := byDev[f[0]]; !ok || len(mount) < len(old.mount) {
			byDev[f[0]] = mountEntry{f[0], mount, f[2]}
		}
	}
	out := make([]mountEntry, 0, len(byDev))
	for _, m := range byDev {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].mount < out[j].mount })
	return out
}

// readHwmon lê os sensores de /sys/class/hwmon (dir = a pasta, para os testes).
func readHwmon(dir string) []Temp {
	var out []Temp
	mons, _ := filepath.Glob(filepath.Join(dir, "hwmon*"))
	sort.Strings(mons)
	for _, m := range mons {
		name := strings.TrimSpace(readFile(filepath.Join(m, "name")))
		kind := hwmonKind(name)
		inputs, _ := filepath.Glob(filepath.Join(m, "temp*_input"))
		sort.Strings(inputs)
		for _, in := range inputs {
			v, err := strconv.ParseFloat(strings.TrimSpace(readFile(in)), 64)
			if err != nil || v <= 0 || v > 150000 {
				continue
			}
			label := strings.TrimSpace(readFile(strings.TrimSuffix(in, "_input") + "_label"))
			if label == "" {
				label = name
			} else {
				label = name + " " + label
			}
			out = append(out, Temp{Label: label, Kind: kind, C: round1(v / 1000)})
		}
	}
	return out
}

func hwmonKind(name string) string {
	switch name {
	case "k10temp", "coretemp", "zenpower", "cpu_thermal", "cpu-thermal", "soc_thermal":
		return "cpu"
	case "amdgpu", "nouveau", "radeon", "i915", "xe":
		return "gpu"
	case "nvme", "drivetemp":
		return "disk"
	}
	return "other"
}

// readThermalZones é o plano B (notebooks e ARM): /sys/class/thermal/thermal_zone*.
func readThermalZones(dir string) []Temp {
	var out []Temp
	zones, _ := filepath.Glob(filepath.Join(dir, "thermal_zone*"))
	sort.Strings(zones)
	for _, z := range zones {
		typ := strings.TrimSpace(readFile(filepath.Join(z, "type")))
		v, err := strconv.ParseFloat(strings.TrimSpace(readFile(filepath.Join(z, "temp"))), 64)
		if err != nil || v <= 0 {
			continue
		}
		kind := "other"
		if strings.Contains(typ, "x86_pkg") || strings.Contains(typ, "cpu") || strings.Contains(typ, "soc") {
			kind = "cpu"
		}
		out = append(out, Temp{Label: typ, Kind: kind, C: round1(v / 1000)})
	}
	return out
}

func readFile(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	return string(b)
}

// parseProcPidStat: nome e tempo de CPU (ticks) de /proc/<pid>/stat (o nome pode ter espaços e parênteses).
func parseProcPidStat(s string) (name string, ticks float64, ok bool) {
	i := strings.IndexByte(s, '(')
	j := strings.LastIndexByte(s, ')')
	if i < 0 || j < i {
		return "", 0, false
	}
	name = s[i+1 : j]
	f := strings.Fields(s[j+1:])
	if len(f) < 13 {
		return "", 0, false
	}
	u, _ := strconv.ParseFloat(f[11], 64)
	st, _ := strconv.ParseFloat(f[12], 64)
	return name, u + st, true
}

// parseDf lê "df -kP" (macOS e plano B).
func parseDf(s string) []Disk {
	var out []Disk
	sc := bufio.NewScanner(strings.NewReader(s))
	first := true
	for sc.Scan() {
		if first {
			first = false
			continue
		}
		f := strings.Fields(sc.Text())
		if len(f) < 6 || !strings.HasPrefix(f[0], "/dev/") {
			continue
		}
		mount := strings.Join(f[5:], " ")
		if mount != "/" && !strings.HasPrefix(mount, "/Volumes/") && !strings.HasPrefix(mount, "/media/") && !strings.HasPrefix(mount, "/mnt/") && mount != "/home" {
			continue
		}
		total, _ := strconv.ParseUint(f[1], 10, 64)
		free, _ := strconv.ParseUint(f[3], 10, 64)
		out = append(out, Disk{Mount: mount, Total: total * 1024, Free: free * 1024})
	}
	return out
}

var vmPageRe = regexp.MustCompile(`page size of (\d+) bytes`)

// parseVmStat lê o "vm_stat" do macOS: memória disponível = livre + inativa + especulativa + liberável.
func parseVmStat(s string, total uint64) *MemInfo {
	page := uint64(4096)
	if m := vmPageRe.FindStringSubmatch(s); m != nil {
		page, _ = strconv.ParseUint(m[1], 10, 64)
	}
	get := func(key string) uint64 {
		for _, l := range strings.Split(s, "\n") {
			if strings.HasPrefix(l, key) {
				v := strings.Trim(strings.TrimSpace(strings.TrimPrefix(l, key)), ":. ")
				n, _ := strconv.ParseUint(v, 10, 64)
				return n
			}
		}
		return 0
	}
	avail := (get("Pages free") + get("Pages inactive") + get("Pages speculative") + get("Pages purgeable")) * page
	if total == 0 {
		return nil
	}
	if avail > total {
		avail = total
	}
	return &MemInfo{Total: total, Available: avail}
}

var battRe = regexp.MustCompile(`(\d+)%;\s*([^;]+);`)

// parsePmset lê o "pmset -g batt" do macOS.
func parsePmset(s string) *Battery {
	m := battRe.FindStringSubmatch(s)
	if m == nil {
		return nil
	}
	p, _ := strconv.ParseFloat(m[1], 64)
	st := strings.TrimSpace(m[2])
	return &Battery{Percent: p, Charging: st == "charging", Plugged: strings.Contains(s, "'AC Power'")}
}

var bootRe = regexp.MustCompile(`sec\s*=\s*(\d+)`)

func parseBoottime(s string) int64 {
	m := bootRe.FindStringSubmatch(s)
	if m == nil {
		return 0
	}
	v, _ := strconv.ParseInt(m[1], 10, 64)
	return v
}

// parsePs lê "ps -A -o pid=,%cpu=,rss=,comm=" (macOS): CPU em % de um núcleo, RSS em kB.
func parsePs(s string) map[int]psRow {
	out := map[int]psRow{}
	for _, l := range strings.Split(s, "\n") {
		f := strings.Fields(l)
		if len(f) < 4 {
			continue
		}
		pid, err := strconv.Atoi(f[0])
		if err != nil {
			continue
		}
		cpu, _ := strconv.ParseFloat(strings.ReplaceAll(f[1], ",", "."), 64)
		rss, _ := strconv.ParseUint(f[2], 10, 64)
		name := filepath.Base(strings.Join(f[3:], " "))
		out[pid] = psRow{name: name, cpu: cpu, rss: rss * 1024}
	}
	return out
}

type psRow struct {
	name string
	cpu  float64
	rss  uint64
}

// parseWinProcs lê "Id|Nome|CPU (s, ponto decimal)|WorkingSet64" (uma linha por programa, do PowerShell).
func parseWinProcCSV(s string) map[int]procTime {
	out := map[int]procTime{}
	for _, l := range strings.Split(s, "\n") {
		f := strings.Split(strings.TrimSpace(l), "|")
		if len(f) != 4 {
			continue
		}
		pid, err := strconv.Atoi(f[0])
		if err != nil || pid == 0 {
			continue
		}
		cpu, _ := strconv.ParseFloat(f[2], 64)
		rss, _ := strconv.ParseUint(f[3], 10, 64)
		out[pid] = procTime{name: f[1], cpu: cpu, rss: rss}
	}
	return out
}
