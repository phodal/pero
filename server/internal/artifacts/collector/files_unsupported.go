//go:build !linux

package collector

import (
	"errors"
	"os"
)

type fileIdentity struct{ size int64 }

func openRegular(root, path string) (*os.File, fileIdentity, error) {
	return nil, fileIdentity{}, errors.New("trusted artifact collection requires Linux handle-relative file access")
}
func unchanged(file *os.File, identity fileIdentity) bool { return false }
