//go:build linux

package collector

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/phodal/pero/server/internal/artifacts"
)

type fileIdentity struct {
	dev, ino     uint64
	size         int64
	mtime, ctime syscall.Timespec
}

func openRegular(root, path string) (*os.File, fileIdentity, error) {
	if !filepath.IsAbs(root) || artifacts.ValidatePath(path) != nil {
		return nil, fileIdentity{}, artifacts.ErrInvalid
	}
	fd, err := syscall.Open(root, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, fileIdentity{}, err
	}
	defer func() {
		if fd >= 0 {
			_ = syscall.Close(fd)
		}
	}()
	var rootStat syscall.Stat_t
	if err = syscall.Fstat(fd, &rootStat); err != nil {
		return nil, fileIdentity{}, err
	}
	parts := strings.Split(path, "/")
	for i, part := range parts {
		flags := syscall.O_RDONLY | syscall.O_NOFOLLOW | syscall.O_CLOEXEC | syscall.O_NONBLOCK
		if i < len(parts)-1 {
			flags |= syscall.O_DIRECTORY
		}
		next, err := syscall.Openat(fd, part, flags, 0)
		if err != nil {
			return nil, fileIdentity{}, err
		}
		_ = syscall.Close(fd)
		fd = next
		var stat syscall.Stat_t
		if err = syscall.Fstat(fd, &stat); err != nil {
			return nil, fileIdentity{}, err
		}
		if stat.Dev != rootStat.Dev {
			return nil, fileIdentity{}, artifacts.ErrInvalid
		}
		if i == len(parts)-1 {
			if stat.Mode&syscall.S_IFMT != syscall.S_IFREG || stat.Nlink != 1 || stat.Size < 0 {
				return nil, fileIdentity{}, artifacts.ErrInvalid
			}
			file := os.NewFile(uintptr(fd), path)
			fd = -1
			return file, fileIdentity{dev: uint64(stat.Dev), ino: stat.Ino, size: stat.Size, mtime: stat.Mtim, ctime: stat.Ctim}, nil
		}
	}
	return nil, fileIdentity{}, artifacts.ErrInvalid
}

func unchanged(file *os.File, identity fileIdentity) bool {
	var stat syscall.Stat_t
	return syscall.Fstat(int(file.Fd()), &stat) == nil && stat.Mode&syscall.S_IFMT == syscall.S_IFREG && stat.Nlink == 1 && uint64(stat.Dev) == identity.dev && stat.Ino == identity.ino && stat.Size == identity.size && stat.Mtim == identity.mtime && stat.Ctim == identity.ctime
}
