package nativetools

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/media"
)

type mediaReadResult struct {
	Path     string
	MIMEType string
	Data     []byte
}

func imageMIME(path string) (string, bool) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png", true
	case ".jpg", ".jpeg":
		return "image/jpeg", true
	case ".gif":
		return "image/gif", true
	case ".webp":
		return "image/webp", true
	default:
		return "", false
	}
}

func readClaudeFile(ctx context.Context, files *fstools.Workspace, resourceReader func(context.Context, string) (fstools.ScopedText, error), input arguments) (any, error) {
	if input.ResourcePath == "" {
		if mime, ok := imageMIME(input.Path); ok {
			data, err := files.ReadBytes(ctx, input.Path, media.DefaultMaxImageBytes)
			if err != nil {
				return nil, err
			}
			data, mime, err = media.NormalizeToolImage(data, mime)
			if err != nil {
				return nil, err
			}
			return mediaReadResult{Path: input.Path, MIMEType: mime, Data: data}, nil
		}
	}
	var text fstools.ScopedText
	var err error
	if input.ResourcePath != "" && resourceReader != nil {
		text, err = resourceReader(ctx, input.ResourcePath)
	} else {
		text, err = files.Read(ctx, input.Path)
	}
	if err != nil {
		return nil, err
	}
	window, err := fstools.FormatRead(text, input.Offset, input.Limit)
	if err != nil {
		return nil, err
	}
	if window.Content != "" {
		lines := strings.Split(window.Content, "\n")
		for i, line := range lines {
			lines[i] = fmt.Sprintf("%6d→%s", window.Offset+i, line)
		}
		window.Content = strings.Join(lines, "\n")
	}
	return window, nil
}
