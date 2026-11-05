package researchprofile

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

func publish(ctx context.Context, stateDirectory, key string, prepared []preparedFile) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := os.MkdirAll(stateDirectory, 0700); err != nil {
		return "", errors.New("researchprofile: state directory cannot be created")
	}
	info, err := os.Lstat(stateDirectory)
	if err != nil || !info.IsDir() {
		return "", errors.New("researchprofile: state directory must be a real directory")
	}
	state, err := filepath.EvalSymlinks(stateDirectory)
	if err != nil {
		return "", errors.New("researchprofile: state directory is unavailable")
	}
	root, err := os.OpenRoot(state)
	if err != nil {
		return "", errors.New("researchprofile: state directory cannot be opened")
	}
	defer root.Close()
	if err := root.Mkdir("research", 0700); err != nil && !os.IsExist(err) {
		return "", errors.New("researchprofile: snapshot parent cannot be created")
	}
	parentInfo, err := root.Lstat("research")
	if err != nil || !parentInfo.IsDir() {
		return "", errors.New("researchprofile: snapshot parent must be a real directory")
	}
	parent, err := root.OpenRoot("research")
	if err != nil {
		return "", errors.New("researchprofile: snapshot parent cannot be opened")
	}
	defer parent.Close()
	opened, err := parent.Stat(".")
	if err != nil || !os.SameFile(parentInfo, opened) {
		return "", errors.New("researchprofile: snapshot parent changed during open")
	}
	checkParent := func() error {
		current, err := root.Lstat("research")
		if err != nil || !current.IsDir() || !os.SameFile(parentInfo, current) {
			return errors.New("researchprofile: snapshot parent was replaced")
		}
		return nil
	}
	checkExisting := func() error {
		info, err := parent.Lstat(key)
		if err != nil || !info.IsDir() {
			return errors.New("researchprofile: snapshot must be a real directory")
		}
		selected, err := parent.OpenRoot(key)
		if err != nil {
			return err
		}
		defer selected.Close()
		current, err := selected.Stat(".")
		if err != nil || !os.SameFile(info, current) {
			return errors.New("researchprofile: snapshot changed during open")
		}
		return verify(selected, prepared)
	}
	directory := filepath.Join(state, "research", key)
	if _, err := parent.Lstat(key); err == nil {
		if err := checkExisting(); err != nil {
			return "", err
		}
		if err := checkParent(); err != nil {
			return "", err
		}
		return directory, nil
	} else if !os.IsNotExist(err) {
		return "", errors.New("researchprofile: existing snapshot is unavailable")
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	temporary := ".research-" + hex.EncodeToString(nonce)
	if err := parent.Mkdir(temporary, 0700); err != nil {
		return "", errors.New("researchprofile: temporary snapshot cannot be created")
	}
	defer parent.RemoveAll(temporary)
	staging, err := parent.OpenRoot(temporary)
	if err != nil {
		return "", err
	}
	defer staging.Close()
	for _, file := range prepared {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		name := filepath.FromSlash(file.path)
		if err := staging.MkdirAll(filepath.Dir(name), 0700); err != nil {
			return "", err
		}
		if err := staging.WriteFile(name, []byte(file.text), 0600); err != nil {
			return "", err
		}
	}
	if err := verify(staging, prepared); err != nil {
		return "", err
	}
	if err := checkParent(); err != nil {
		return "", err
	}
	if err := parent.Rename(temporary, key); err != nil {
		if err := checkExisting(); err != nil {
			return "", err
		}
	}
	if err := checkParent(); err != nil {
		return "", err
	}
	return directory, nil
}

func verify(root *os.Root, prepared []preparedFile) error {
	expected := make(map[string]preparedFile, len(prepared))
	for _, file := range prepared {
		expected[file.path] = file
	}
	err := fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		file, found := expected[name]
		if !found || !entry.Type().IsRegular() {
			return errors.New("researchprofile: unexpected or non-regular snapshot resource")
		}
		info, err := entry.Info()
		if err != nil || info.Size() != int64(len(file.text)) {
			return errors.New("researchprofile: snapshot resource size changed")
		}
		content, err := root.ReadFile(filepath.FromSlash(name))
		if err != nil || digest(string(content)) != digest(file.text) {
			return errors.New("researchprofile: snapshot resource content changed")
		}
		delete(expected, name)
		return nil
	})
	if err != nil || len(expected) != 0 {
		return errors.New("researchprofile: snapshot verification failed; source selection requires a clean state directory")
	}
	return nil
}
