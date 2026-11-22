//go:build windows

package main

import (
	"context"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// Leituras do Windows por chamadas diretas ao sistema (kernel32), sem PowerShell no caminho rápido.
// Temperaturas: o Windows não as entrega a programas comuns — a NeuroTab lê do LibreHardwareMonitor (ver widget).

var (
	k32                     = syscall.NewLazyDLL("kernel32.dll")
	pGetSystemTimes         = k32.NewProc("GetSystemTimes")
	pGlobalMemoryStatusEx   = k32.NewProc("GlobalMemoryStatusEx")
	pGetLogicalDriveStrings = k32.NewProc("GetLogicalDriveStringsW")
	pGetDriveType           = k32.NewProc("GetDriveTypeW")
	pGetDiskFreeSpaceEx     = k32.NewProc("GetDiskFreeSpaceExW")
	pGetVolumeInformation   = k32.NewProc("GetVolumeInformationW")
	pGetSystemPowerStatus   = k32.NewProc("GetSystemPowerStatus")
	pGetTickCount64         = k32.NewProc("GetTickCount64")
	pSetErrorMode           = k32.NewProc("SetErrorMode")
)

type winReader struct{ model string }

func newOSReader() osReader {
	pSetErrorMode.Call(0x0001) // sem janela "insira um disco" em leitores vazios
	return &winReader{}
}

func ft(f syscall.Filetime) float64 {
	return float64(uint64(f.HighDateTime)<<32 | uint64(f.LowDateTime))
}

func (w *winReader) cpuTimes() ([]cpuTimes, error) {
	var idle, kernel, user syscall.Filetime
	r, _, err := pGetSystemTimes.Call(uintptr(unsafe.Pointer(&idle)), uintptr(unsafe.Pointer(&kernel)), uintptr(unsafe.Pointer(&user)))
	if r == 0 {
		return nil, err
	}
	return []cpuTimes{{total: ft(kernel) + ft(user), idle: ft(idle)}}, nil // o tempo do kernel já inclui o ocioso
}

func (w *winReader) cpuModel() (string, float64) {
	if w.model == "" {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		out, _ := powershell(ctx, "$c = Get-CimInstance Win32_Processor | Select-Object -First 1; '{0}|{1}' -f $c.Name.Trim(), $c.CurrentClockSpeed")
		w.model = strings.TrimSpace(out)
	}
	name, mhz, _ := strings.Cut(w.model, "|")
	v := numPtr(mhz)
	if v == nil {
		return name, 0
	}
	return name, *v
}

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func (w *winReader) mem() (*MemInfo, error) {
	var m memoryStatusEx
	m.Length = uint32(unsafe.Sizeof(m))
	r, _, err := pGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		return nil, err
	}
	out := &MemInfo{Total: m.TotalPhys, Available: m.AvailPhys}
	if m.TotalPageFile > m.TotalPhys { // arquivo de paginação = commit total − memória física
		out.SwapTotal = m.TotalPageFile - m.TotalPhys
		usedCommit := m.TotalPageFile - m.AvailPageFile
		usedPhys := m.TotalPhys - m.AvailPhys
		if usedCommit > usedPhys {
			out.SwapUsed = min(usedCommit-usedPhys, out.SwapTotal)
		}
	}
	return out, nil
}

func (w *winReader) disks() []Disk {
	buf := make([]uint16, 256)
	n, _, _ := pGetLogicalDriveStrings.Call(uintptr(len(buf)), uintptr(unsafe.Pointer(&buf[0])))
	if n == 0 {
		return nil
	}
	var out []Disk
	for _, root := range strings.Split(syscall.UTF16ToString(buf[:n]), "\x00") {
		if root == "" {
			continue
		}
		p, _ := syscall.UTF16PtrFromString(root)
		typ, _, _ := pGetDriveType.Call(uintptr(unsafe.Pointer(p)))
		if typ != 3 && typ != 2 { // 3 = disco fixo, 2 = removível
			continue
		}
		var free, total, totalFree uint64
		r, _, _ := pGetDiskFreeSpaceEx.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&free)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree)))
		if r == 0 || total == 0 {
			continue
		}
		label := make([]uint16, 261)
		fs := make([]uint16, 261)
		pGetVolumeInformation.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&label[0])), 261, 0, 0, 0, uintptr(unsafe.Pointer(&fs[0])), 261)
		out = append(out, Disk{Mount: strings.TrimSuffix(root, `\`), Label: syscall.UTF16ToString(label), FS: syscall.UTF16ToString(fs), Total: total, Free: free})
	}
	return out
}

func (w *winReader) temps() []Temp { return nil }
func (w *winReader) gpus() []GPU   { return nil }

type systemPowerStatus struct {
	ACLineStatus        byte
	BatteryFlag         byte
	BatteryLifePercent  byte
	SystemStatusFlag    byte
	BatteryLifeTime     uint32
	BatteryFullLifeTime uint32
}

func (w *winReader) battery() *Battery {
	var s systemPowerStatus
	r, _, _ := pGetSystemPowerStatus.Call(uintptr(unsafe.Pointer(&s)))
	if r == 0 || s.BatteryFlag == 128 || s.BatteryFlag == 255 || s.BatteryLifePercent > 100 {
		return nil
	}
	return &Battery{Percent: float64(s.BatteryLifePercent), Charging: s.BatteryFlag&8 != 0, Plugged: s.ACLineStatus == 1}
}

func (w *winReader) uptime() int64 {
	r, _, _ := pGetTickCount64.Call()
	return int64(r / 1000)
}

func (w *winReader) procs() (map[int]procTime, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	out, err := powershell(ctx, "Get-Process | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.Id, $_.ProcessName, ([double]$_.CPU).ToString([cultureinfo]::InvariantCulture), $_.WorkingSet64 }")
	if err != nil {
		return nil, err
	}
	return parseWinProcCSV(out), nil
}

func (w *winReader) notes() []string { return []string{"temp-windows"} }
