package nativetools

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"path"
	"strings"

	"github.com/phodal/pero/harness/go/fstools"
	gitignore "github.com/sabhiram/go-gitignore"
)

type claudeScanFrame struct {
	Directory string `json:"dir"`
	Offset    int    `json:"offset"`
	Index     int    `json:"index,omitempty"`
}

type claudeScanCursor struct {
	Version      int               `json:"v"`
	Query        string            `json:"query"`
	Frames       []claudeScanFrame `json:"frames"`
	RecordOffset int               `json:"record_offset,omitempty"`
}

func openClaudeScan(kind string, files *fstools.Workspace, input arguments) (*claudeScanCursor, error) {
	base := input.Path
	if base == "" {
		base = "."
	}
	query := input
	query.Cursor, query.Offset, query.SearchOffset, query.HeadLimit, query.Limit = "", 0, 0, 0, 0
	raw, _ := json.Marshal(struct {
		Kind, Root string
		Input      arguments
	}{kind, files.Path(), query})
	hash := sha256.Sum256(raw)
	digest := hex.EncodeToString(hash[:])
	if input.Cursor == "" {
		return &claudeScanCursor{Version: 1, Query: digest, Frames: []claudeScanFrame{{Directory: base}}}, nil
	}
	if len(input.Cursor) > 16384 || input.SearchOffset != 0 {
		return nil, errors.New("use cursor without offset; restart the scan if the query or directory changed")
	}
	raw, err := base64.RawURLEncoding.DecodeString(input.Cursor)
	var cursor claudeScanCursor
	if err != nil || json.Unmarshal(raw, &cursor) != nil || cursor.Version != 1 || cursor.Query != digest || len(cursor.Frames) == 0 || len(cursor.Frames) > 64 || cursor.RecordOffset < 0 {
		return nil, errors.New("invalid search cursor or changed query; restart without cursor")
	}
	for i, frame := range cursor.Frames {
		if frame.Offset < 0 || frame.Index < 0 || frame.Index > fstools.MaxEntries || i == 0 && frame.Directory != base || i > 0 && path.Dir(frame.Directory) != cursor.Frames[i-1].Directory {
			return nil, errors.New("invalid search cursor traversal")
		}
	}
	return &cursor, nil
}

func (cursor *claudeScanCursor) encode() (string, error) {
	if len(cursor.Frames) == 0 {
		return "", nil
	}
	raw, err := json.Marshal(cursor)
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	if len(encoded) > 16384 {
		return "", errors.New("search cursor is too deep; narrow the search path")
	}
	return encoded, err
}

func claudeIgnoreLines(directory, text string) []string {
	var result []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if directory == "." || line == "" || strings.HasPrefix(line, "#") {
			result = append(result, line)
			continue
		}
		prefix := ""
		if strings.HasPrefix(line, "!") {
			prefix, line = "!", line[1:]
		}
		anchored := strings.HasPrefix(line, "/")
		line = strings.TrimPrefix(line, "/")
		if !anchored && !strings.Contains(strings.TrimSuffix(line, "/"), "/") {
			line = "**/" + line
		}
		result = append(result, prefix+"/"+directory+"/"+line)
	}
	return result
}

// Directory and ignore/text reads use the original descriptor-rooted authority.
// Offsets continue a live directory enumeration; mutations require restarting.
func walkClaudeFiles(ctx context.Context, files *fstools.Workspace, cursor *claudeScanCursor, visit func(string) (bool, error)) (claudeTraversal, error) {
	var result claudeTraversal
	type scanPage struct {
		start int
		page  fstools.DirectoryPage
	}
	pages := map[string]scanPage{}
	rules := map[string][]string{}
	matchers := map[string]*gitignore.GitIgnore{}
	var loadRules func(string) error
	loadRules = func(directory string) error {
		if _, found := matchers[directory]; found {
			return nil
		}
		var inherited []string
		if directory != "." {
			parent := path.Dir(directory)
			if err := loadRules(parent); err != nil {
				return err
			}
			inherited = append(inherited, rules[parent]...)
		}
		text, err := files.ReadBytes(ctx, path.Join(directory, ".gitignore"), fstools.MaxFileBytes)
		if err == nil {
			inherited = append(inherited, claudeIgnoreLines(directory, string(text))...)
		} else if !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		rules[directory] = inherited
		matchers[directory] = gitignore.CompileIgnoreLines(inherited...)
		return nil
	}
	finish := func() (claudeTraversal, error) {
		var err error
		result.NextCursor, err = cursor.encode()
		result.Truncated = result.NextCursor != ""
		return result, err
	}
	for len(cursor.Frames) > 0 {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if result.Entries >= 512 {
			return finish()
		}
		index := len(cursor.Frames) - 1
		frame := cursor.Frames[index]
		cached, found := pages[frame.Directory]
		if !found || frame.Offset != cached.start {
			page, err := files.ListPage(ctx, frame.Directory, frame.Offset)
			if err != nil {
				return result, err
			}
			cached = scanPage{frame.Offset, page}
			pages[frame.Directory] = cached
		}
		if frame.Index > len(cached.page.Entries) {
			return result, errors.New("search directory changed; restart without cursor")
		}
		if err := loadRules(frame.Directory); err != nil {
			return result, err
		}
		descended := false
		for i := frame.Index; i < len(cached.page.Entries); i++ {
			if result.Entries >= 512 {
				return finish()
			}
			entry := cached.page.Entries[i]
			cursor.Frames[index].Index++
			result.Entries++
			if entry.Symlink || entry.Name == ".git" {
				continue
			}
			name := path.Join(frame.Directory, entry.Name)
			matchName := name
			if entry.Directory {
				matchName += "/"
			}
			if matchers[frame.Directory].MatchesPath(matchName) {
				continue
			}
			if entry.Directory {
				if len(cursor.Frames) >= 64 {
					return result, errors.New("search traversal is too deep; narrow the search path")
				}
				cursor.Frames = append(cursor.Frames, claudeScanFrame{Directory: name})
				descended = true
				break
			}
			more, err := visit(name)
			if err != nil {
				return result, err
			}
			if !more {
				cursor.Frames[index].Index--
				return finish()
			}
			cursor.RecordOffset = 0
		}
		if !descended {
			if cached.page.NextOffset == 0 {
				cursor.Frames = cursor.Frames[:index]
			} else {
				cursor.Frames[index].Offset, cursor.Frames[index].Index = cached.page.NextOffset, 0
			}
		}
	}
	return result, nil
}
