// Dedicated fixture derivative only. Write a run-specific durable file before
// executing the unchanged Go ACP Agent. This does NOT bypass tool approval.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
)

type generatedArtifact struct {
	RunID string `json:"run_id"`
	Nonce string `json:"nonce"`
}

func writeArtifact(identity, destination string) error {
	f, err := os.Open(identity)
	if err != nil {
		return err
	}
	var buf [129]byte
	n, err := f.Read(buf[:])
	_ = f.Close()
	if err != nil || n > 128 {
		return errors.New("invalid public Run identity")
	}
	id := strings.TrimSpace(string(buf[:n]))
	if !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`).MatchString(id) {
		return errors.New("invalid public Run identity")
	}
	var nonce [32]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		return err
	}
	data, err := json.Marshal(generatedArtifact{id, hex.EncodeToString(nonce[:])})
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err = os.MkdirAll(filepath.Dir(destination), 0750); err != nil {
		return err
	}
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0640)
	if err != nil {
		return err
	}
	if _, err = out.Write(data); err == nil {
		err = out.Sync()
	}
	closeErr := out.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	dir, err := os.Open(filepath.Dir(destination))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func main() {
	if err := writeArtifact("/workspace/.pero-run-id", "/workspace/repo/artifacts/generated.txt"); err != nil {
		fmt.Fprintln(os.Stderr, "fixture artifact write failed")
		os.Exit(1)
	}
	executable := "/usr/local/bin/pero-agent-acp-real"
	if err := syscall.Exec(executable, append([]string{executable}, os.Args[1:]...), os.Environ()); err != nil {
		fmt.Fprintln(os.Stderr, "fixture Agent exec failed")
		os.Exit(1)
	}
}
