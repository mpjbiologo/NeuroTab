//go:build darwin

package main

import (
	"context"
	"strconv"
	"strings"
	"time"
)

type darwinReader struct{}

func newOSReader() osReader { return darwinReader{} }

func darwinRun(name string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, _ := run(ctx, name, args...)
	return out
}

// cpuTimes: o macOS não expõe os contadores sem cgo; o uso vem da soma do "ps" (média recente).
func (darwinReader) cpuTimes() ([]cpuTimes, error) { return nil, errNoCPUTimes }

func (darwinReader) cpuModel() (string, float64) {
	model := strings.TrimSpace(darwinRun("sysctl", "-n", "machdep.cpu.brand_string"))
	hz, _ := strconv.ParseFloat(strings.TrimSpace(darwinRun("sysctl", "-n", "hw.cpufrequency")), 64)
	return model, round1(hz / 1e6)
}

func (darwinReader) mem() (*MemInfo, error) {
	total, _ := strconv.ParseUint(strings.TrimSpace(darwinRun("sysctl", "-n", "hw.memsize")), 10, 64)
	m := parseVmStat(darwinRun("vm_stat"), total)
	if m == nil {
		return nil, errNoCPUTimes
	}
	return m, nil
}

func (darwinReader) disks() []Disk { return parseDf(darwinRun("df", "-kP")) }

func (darwinReader) temps() []Temp { return nil }

func (darwinReader) gpus() []GPU { return nil }

func (darwinReader) battery() *Battery { return parsePmset(darwinRun("pmset", "-g", "batt")) }

func (darwinReader) uptime() int64 {
	boot := parseBoottime(darwinRun("sysctl", "-n", "kern.boottime"))
	if boot == 0 {
		return 0
	}
	return time.Now().Unix() - boot
}

// procs: o "ps" já dá o % de CPU; convertemos para tempo acumulado falso para o mesmo cálculo das outras plataformas.
func (darwinReader) procs() (map[int]procTime, error) {
	rows := parsePs(darwinRun("ps", "-A", "-o", "pid=,%cpu=,rss=,comm="))
	out := make(map[int]procTime, len(rows))
	for pid, r := range rows {
		out[pid] = procTime{name: r.name, cpu: r.cpu, rss: r.rss}
	}
	return out, nil
}

func (darwinReader) notes() []string {
	return []string{"temp-mac"}
}

// No macOS o uso da CPU e dos programas vem do "ps" (percentual direto), não da diferença entre leituras.
func init() { psDirect = true }
