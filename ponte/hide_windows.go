//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideWindow evita abrir uma janela preta de console a cada comando (ping, powershell…).
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
