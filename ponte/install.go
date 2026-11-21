package main

// Instalação: copia o programa para uma pasta fixa e registra o "host" de native messaging em cada navegador.

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const geckoID = "neurotab@mpjbiologo.github.io"

// Extensões que podem falar com a Ponte (lojas do Chrome e do Edge). Outras via --extension-id=…
var chromiumIDs = []string{"dbdilojkiedjgjehfjpodbljcnpmljkk", "mhaainpmhalhhbefceigjmbcdhdeainl"}

type browser struct {
	name    string
	firefox bool
	dir     string // pasta do manifesto (macOS/Linux)
	base    string // pasta que indica que o navegador existe (macOS/Linux)
	regKey  string // chave do registro (Windows)
}

func browsers(home string) []browser {
	switch runtime.GOOS {
	case "windows":
		return []browser{
			{name: "Chrome", regKey: `HKCU\Software\Google\Chrome\NativeMessagingHosts\` + hostName},
			{name: "Edge", regKey: `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\` + hostName},
			{name: "Chromium", regKey: `HKCU\Software\Chromium\NativeMessagingHosts\` + hostName},
			{name: "Brave", regKey: `HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\` + hostName},
			{name: "Firefox", firefox: true, regKey: `HKCU\Software\Mozilla\NativeMessagingHosts\` + hostName},
		}
	case "darwin":
		as := filepath.Join(home, "Library", "Application Support")
		return []browser{
			{name: "Chrome", base: filepath.Join(as, "Google", "Chrome")},
			{name: "Edge", base: filepath.Join(as, "Microsoft Edge")},
			{name: "Chromium", base: filepath.Join(as, "Chromium")},
			{name: "Brave", base: filepath.Join(as, "BraveSoftware", "Brave-Browser")},
			{name: "Firefox", firefox: true, base: filepath.Join(as, "Mozilla")},
		}
	default:
		cfg := filepath.Join(home, ".config")
		return []browser{
			{name: "Chrome", base: filepath.Join(cfg, "google-chrome")},
			{name: "Edge", base: filepath.Join(cfg, "microsoft-edge")},
			{name: "Chromium", base: filepath.Join(cfg, "chromium")},
			{name: "Brave", base: filepath.Join(cfg, "BraveSoftware", "Brave-Browser")},
			{name: "Firefox", firefox: true, base: filepath.Join(home, ".mozilla"), dir: filepath.Join(home, ".mozilla", "native-messaging-hosts")},
		}
	}
}

func hostsDir(b browser) string {
	if b.dir != "" {
		return b.dir
	}
	if b.firefox && runtime.GOOS == "darwin" {
		return filepath.Join(b.base, "NativeMessagingHosts")
	}
	return filepath.Join(b.base, "NativeMessagingHosts")
}

func appDir(home string) string {
	switch runtime.GOOS {
	case "windows":
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			return filepath.Join(d, "NeuroTab")
		}
		return filepath.Join(home, "AppData", "Local", "NeuroTab")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "NeuroTab")
	default:
		return filepath.Join(home, ".local", "share", "neurotab")
	}
}

func manifest(path string, firefox bool, extra []string) []byte {
	m := map[string]any{"name": hostName, "description": "NeuroTab Ponte: área de transferência na rede local", "path": path, "type": "stdio"}
	if firefox {
		m["allowed_extensions"] = []string{geckoID}
	} else {
		var origins []string
		for _, id := range append(append([]string{}, chromiumIDs...), extra...) {
			origins = append(origins, "chrome-extension://"+id+"/")
		}
		m["allowed_origins"] = origins
	}
	b, _ := json.MarshalIndent(m, "", "  ")
	return b
}

func copyFile(src, dst string) error {
	if s, _ := filepath.Abs(src); s == dst {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	_ = os.Remove(dst) // no Windows, rename não substitui
	return os.Rename(tmp, dst)
}

// install devolve o que foi registrado (para mostrar à pessoa).
func install(home, self string, extra []string, run func(name string, args ...string) error) ([]string, error) {
	dir := appDir(home)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	exe := "neurotab-ponte"
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	dst := filepath.Join(dir, exe)
	if err := copyFile(self, dst); err != nil {
		return nil, fmt.Errorf("copiar o programa: %w", err)
	}
	var done []string
	for _, b := range browsers(home) {
		mf := manifest(dst, b.firefox, extra)
		if runtime.GOOS == "windows" {
			file := filepath.Join(dir, map[bool]string{true: "firefox.json", false: "chromium.json"}[b.firefox])
			if err := os.WriteFile(file, mf, 0o644); err != nil {
				return done, err
			}
			if err := run("reg", "add", b.regKey, "/ve", "/t", "REG_SZ", "/d", file, "/f"); err != nil {
				continue
			}
			done = append(done, b.name)
			continue
		}
		if _, err := os.Stat(b.base); err != nil {
			continue // navegador não instalado
		}
		d := hostsDir(b)
		if err := os.MkdirAll(d, 0o755); err != nil {
			continue
		}
		if err := os.WriteFile(filepath.Join(d, hostName+".json"), mf, 0o644); err != nil {
			continue
		}
		done = append(done, b.name)
	}
	return done, nil
}

func uninstall(home string, run func(name string, args ...string) error) {
	for _, b := range browsers(home) {
		if runtime.GOOS == "windows" {
			_ = run("reg", "delete", b.regKey, "/f")
			continue
		}
		_ = os.Remove(filepath.Join(hostsDir(b), hostName+".json"))
	}
	_ = os.RemoveAll(appDir(home))
}

func runCmd(name string, args ...string) error {
	c := exec.Command(name, args...)
	c.Stdout, c.Stderr = io.Discard, io.Discard
	return c.Run()
}

func runInstaller(args []string) int {
	home, _ := os.UserHomeDir()
	var extra []string
	remove := false
	for _, a := range args {
		switch {
		case a == "--uninstall" || a == "desinstalar":
			remove = true
		case strings.HasPrefix(a, "--extension-id="):
			extra = append(extra, strings.TrimPrefix(a, "--extension-id="))
		case a == "--version":
			fmt.Println(version)
			return 0
		}
	}
	defer pauseOnWindows(len(args) == 0)
	if remove {
		uninstall(home, runCmd)
		fmt.Println("✓ NeuroTab Ponte removida deste computador.")
		return 0
	}
	self, _ := os.Executable()
	done, err := install(home, self, extra, runCmd)
	if err != nil {
		fmt.Println("✗ Não consegui instalar:", err)
		return 1
	}
	if len(done) == 0 {
		fmt.Println("✗ Não achei Chrome, Edge, Brave, Chromium nem Firefox neste computador.")
		return 1
	}
	fmt.Printf("✓ NeuroTab Ponte %s instalada para: %s\n\n", version, strings.Join(done, ", "))
	fmt.Println("Agora, na NeuroTab: widget Área de transferência → 📤 → ligue \"Rede local\" e salve.")
	fmt.Println("O navegador abre a Ponte sozinho quando precisar. Para remover: rode este programa com --uninstall.")
	if runtime.GOOS == "windows" {
		fmt.Println("\nNa primeira vez que o celular conectar, o Windows pode pedir para liberar o acesso: permita em \"Redes privadas\".")
	}
	return 0
}

func pauseOnWindows(clicked bool) {
	if runtime.GOOS == "windows" && clicked {
		fmt.Print("\nPressione Enter para fechar…")
		_, _ = fmt.Scanln()
	}
}
