//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

type linuxReader struct{}

func newOSReader() osReader { return linuxReader{} }

func (linuxReader) cpuTimes() ([]cpuTimes, error) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return nil, err
	}
	return parseProcStat(string(b)), nil
}

func (linuxReader) cpuModel() (string, float64) {
	model := ""
	var sum float64
	n := 0
	for _, l := range strings.Split(readFile("/proc/cpuinfo"), "\n") {
		k, v, ok := strings.Cut(l, ":")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		switch k {
		case "model name", "Model", "Hardware":
			if model == "" {
				model = v
			}
		case "cpu MHz":
			if f, err := strconv.ParseFloat(v, 64); err == nil {
				sum += f
				n++
			}
		}
	}
	mhz := 0.0
	if n > 0 {
		mhz = sum / float64(n)
	} else if v, err := strconv.ParseFloat(strings.TrimSpace(readFile("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")), 64); err == nil {
		mhz = v / 1000
	}
	return model, round1(mhz)
}

func (linuxReader) mem() (*MemInfo, error) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return nil, err
	}
	return parseMeminfo(string(b)), nil
}

func (linuxReader) disks() []Disk {
	var out []Disk
	for _, m := range parseMounts(readFile("/proc/mounts")) {
		var st syscall.Statfs_t
		if err := syscall.Statfs(m.mount, &st); err != nil || st.Blocks == 0 {
			continue
		}
		bs := uint64(st.Bsize)
		out = append(out, Disk{Mount: m.mount, FS: m.fs, Label: filepath.Base(m.dev), Total: st.Blocks * bs, Free: st.Bavail * bs})
	}
	return out
}

func (linuxReader) temps() []Temp {
	t := readHwmon("/sys/class/hwmon")
	if len(t) == 0 {
		t = readThermalZones("/sys/class/thermal")
	}
	return t
}

// gpus: placas AMD pelo amdgpu (a NVIDIA vem do nvidia-smi).
func (linuxReader) gpus() []GPU {
	var out []GPU
	cards, _ := filepath.Glob("/sys/class/drm/card[0-9]")
	for _, c := range cards {
		dev := filepath.Join(c, "device")
		busy := strings.TrimSpace(readFile(filepath.Join(dev, "gpu_busy_percent")))
		if busy == "" {
			continue
		}
		g := GPU{Name: "AMD Radeon", Source: "amdgpu"}
		if n := strings.TrimSpace(readFile(filepath.Join(dev, "product_name"))); n != "" {
			g.Name = n
		}
		g.Usage = numPtr(busy)
		if v, err := strconv.ParseUint(strings.TrimSpace(readFile(filepath.Join(dev, "mem_info_vram_used"))), 10, 64); err == nil {
			g.MemUsed = v
		}
		if v, err := strconv.ParseUint(strings.TrimSpace(readFile(filepath.Join(dev, "mem_info_vram_total"))), 10, 64); err == nil {
			g.MemTotal = v
		}
		for _, t := range readHwmon(filepath.Join(dev, "hwmon")) {
			v := t.C
			g.Temp = &v
			break
		}
		out = append(out, g)
	}
	return out
}

func (linuxReader) battery() *Battery {
	bats, _ := filepath.Glob("/sys/class/power_supply/BAT*")
	if len(bats) == 0 {
		return nil
	}
	p, err := strconv.ParseFloat(strings.TrimSpace(readFile(filepath.Join(bats[0], "capacity"))), 64)
	if err != nil {
		return nil
	}
	st := strings.TrimSpace(readFile(filepath.Join(bats[0], "status")))
	plugged := false
	acs, _ := filepath.Glob("/sys/class/power_supply/A*/online")
	for _, a := range acs {
		if strings.TrimSpace(readFile(a)) == "1" {
			plugged = true
		}
	}
	return &Battery{Percent: p, Charging: st == "Charging", Plugged: plugged || st == "Charging" || st == "Full"}
}

func (linuxReader) uptime() int64 {
	f := strings.Fields(readFile("/proc/uptime"))
	if len(f) == 0 {
		return 0
	}
	v, _ := strconv.ParseFloat(f[0], 64)
	return int64(v)
}

func (linuxReader) procs() (map[int]procTime, error) {
	dirs, err := filepath.Glob("/proc/[0-9]*")
	if err != nil {
		return nil, err
	}
	page := uint64(os.Getpagesize())
	out := make(map[int]procTime, len(dirs))
	for _, d := range dirs {
		pid, err := strconv.Atoi(filepath.Base(d))
		if err != nil {
			continue
		}
		name, ticks, ok := parseProcPidStat(readFile(filepath.Join(d, "stat")))
		if !ok {
			continue
		}
		var rss uint64
		if f := strings.Fields(readFile(filepath.Join(d, "statm"))); len(f) > 1 {
			v, _ := strconv.ParseUint(f[1], 10, 64)
			rss = v * page
		}
		out[pid] = procTime{name: name, cpu: ticks / 100, rss: rss} // USER_HZ = 100
	}
	return out, nil
}

func (linuxReader) notes() []string { return nil }
