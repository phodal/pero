//go:build !unix

package remoteacp

import (
	"errors"
	"os/exec"
)

func isolateChild(*exec.Cmd) (func(), error) {
	return nil, errors.New("isolated remote Agent requires Unix process supervision")
}
