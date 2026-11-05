package shell

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// MaximumCommandOutputBytes expresses the documented 5 GB command-output
// ceiling in decimal bytes. A limit failure retains a clearly partial prefix.
const MaximumCommandOutputBytes int64 = 5_000_000_000

var ErrOutputFileLimit = errors.New("shell: output file limit exceeded; captured output is incomplete")

// OutputFilePlan fixes a private workspace destination without touching disk.
// The caller must durably authorize its command before opening the capture.
type OutputFilePlan struct {
	workspace, directory, name string
	limit                      int64
}

func PlanOutputFile(workspace, directory, name string, maximumBytes int64) (OutputFilePlan, error) {
	if !filepath.IsAbs(workspace) || !filepath.IsLocal(directory) || directory == "." || filepath.Base(name) != name || name == "" || name == "." || strings.ContainsRune(name, 0) {
		return OutputFilePlan{}, errors.New("shell: output requires an absolute workspace, local directory and plain filename")
	}
	if maximumBytes == 0 {
		maximumBytes = MaximumCommandOutputBytes
	}
	if maximumBytes < 1 || maximumBytes > MaximumCommandOutputBytes {
		return OutputFilePlan{}, errors.New("shell: output file limit exceeds supported bounds")
	}
	return OutputFilePlan{workspace: workspace, directory: filepath.Clean(directory), name: name, limit: maximumBytes}, nil
}

func (p OutputFilePlan) Path() string { return filepath.Join(p.workspace, p.directory, p.name) }

func (p OutputFilePlan) openDirectory(create bool) (*os.Root, error) {
	if p.workspace == "" || p.limit <= 0 {
		return nil, errors.New("shell: output file plan is not initialized")
	}
	root, err := os.OpenRoot(p.workspace)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	current := ""
	parts := strings.Split(p.directory, string(filepath.Separator))
	for i, part := range parts {
		current = filepath.Join(current, part)
		if create {
			if err := root.Mkdir(current, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return nil, err
			}
		}
		info, err := root.Lstat(current)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("shell: output parents must be directories without symlinks")
		}
		if i == len(parts)-1 && info.Mode().Perm()&0077 != 0 {
			return nil, errors.New("shell: output directory must be private (0700)")
		}
	}
	return root.OpenRoot(p.directory)
}

// Exists checks recovery references without following symlink parents or
// manufacturing a missing file that would masquerade as a recovered log.
func (p OutputFilePlan) Exists() (bool, error) {
	root, err := p.openDirectory(false)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer root.Close()
	info, err := root.Lstat(p.name)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return false, errors.New("shell: recovered output is not a regular file")
	}
	return true, nil
}

// FileCapture is an exclusive file sink for LocalExecutor.OutputSink. Run
// serializes its two stream writers; inspect/close only after Run has settled.
type FileCapture struct {
	plan  OutputFilePlan
	root  *os.Root
	file  *os.File
	bytes int64
}

func (w *FileCapture) Open(plan OutputFilePlan) error {
	if w.root != nil {
		return errors.New("shell: output capture is already open")
	}
	root, err := plan.openDirectory(true)
	if err != nil {
		return fmt.Errorf("shell: output directory: %w", err)
	}
	file, err := root.OpenFile(plan.name, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		root.Close()
		return fmt.Errorf("shell: create output file: %w", err)
	}
	w.plan, w.root, w.file = plan, root, file
	w.bytes = 0
	return nil
}

func (w *FileCapture) Path() string {
	if w.root == nil {
		return ""
	}
	return w.plan.Path()
}
func (w *FileCapture) Bytes() int64 { return w.bytes }

// ReadRunes reads at most limit Unicode code points from the start of the log.
func (w *FileCapture) ReadRunes(limit int) ([]rune, error) {
	if w.file == nil || limit < 1 {
		return nil, errors.New("shell: output capture is not open")
	}
	return ReadClaudeOutputRunes(io.NewSectionReader(w.file, 0, w.bytes), limit)
}

// Trim shortens a finished capture to a valid UTF-8 prefix. Call it only after
// the producing process has exited.
func (w *FileCapture) Trim(maximum int64) (int64, bool, error) {
	if w.file == nil || maximum < 1 {
		return 0, false, errors.New("shell: output capture is not open")
	}
	if w.bytes <= maximum {
		return w.bytes, false, nil
	}
	boundary, err := UTF8PrefixLength(w.file, maximum)
	if err != nil {
		return 0, false, err
	}
	if err := w.file.Truncate(boundary); err != nil {
		return 0, false, err
	}
	w.bytes = boundary
	return boundary, true, nil
}

// ReadAt borrows the already-open command log for post-execution projection.
func (w *FileCapture) ReadAt(destination []byte, offset int64) (int, error) {
	if w.file == nil {
		return 0, errors.New("shell: output capture is not open")
	}
	return w.file.ReadAt(destination, offset)
}

func (w *FileCapture) Write(source []byte) (int, error) {
	if w.file == nil {
		return 0, errors.New("shell: output capture is not open")
	}
	remaining := w.plan.limit - w.bytes
	data := source
	if int64(len(data)) > remaining {
		data = data[:remaining]
	}
	n, err := w.file.Write(data)
	w.bytes += int64(n)
	if err == nil && n != len(source) {
		err = fmt.Errorf("%w (%d bytes)", ErrOutputFileLimit, w.plan.limit)
	}
	return n, err
}

type CapturedOutput struct {
	Text      string
	Bytes     int64
	Truncated bool
}

func (w *FileCapture) Preview(inlineBytes, edgeBytes int) (CapturedOutput, error) {
	if inlineBytes < 0 || edgeBytes < 1 || w.file == nil {
		return CapturedOutput{}, errors.New("shell: invalid output preview")
	}
	output := CapturedOutput{Bytes: w.bytes, Truncated: w.bytes > int64(inlineBytes)}
	if !output.Truncated {
		data := make([]byte, int(w.bytes))
		_, err := w.file.ReadAt(data, 0)
		output.Text = string(data)
		return output, err
	}
	size := min(int64(edgeBytes), w.bytes)
	head, tail := make([]byte, size), make([]byte, size)
	if _, err := w.file.ReadAt(head, 0); err != nil && !errors.Is(err, io.EOF) {
		return CapturedOutput{}, err
	}
	if _, err := w.file.ReadAt(tail, w.bytes-size); err != nil && !errors.Is(err, io.EOF) {
		return CapturedOutput{}, err
	}
	output.Text = strings.ToValidUTF8(string(head), "�")
	if w.bytes > size {
		output.Text += "\n...\n" + strings.ToValidUTF8(string(tail), "�")
	}
	return output, nil
}

// Close retains completed or interrupted audit logs when keep is true. Only
// callers that have already consumed an inline result may discard their file.
func (w *FileCapture) Close(keep bool) error {
	var err error
	if w.file != nil {
		if keep {
			err = w.file.Sync()
		}
		err = errors.Join(err, w.file.Close())
		w.file = nil
	}
	if w.root != nil {
		if !keep {
			err = errors.Join(err, w.root.Remove(w.plan.name))
		}
		err = errors.Join(err, w.root.Close())
		w.root = nil
	}
	return err
}
