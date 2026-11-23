package runtimegateway

import (
	"bytes"
	"encoding/base64"
	"image/png"
	"strings"

	"github.com/phodal/pero/server/internal/runtimechannel"
)

type providerScreenshotPart struct {
	Type     string                 `json:"type"`
	Text     *string                `json:"text,omitempty"`
	ImageURL *providerScreenshotURL `json:"image_url,omitempty"`
}

type providerScreenshotURL struct {
	URL string `json:"url"`
}

func browserScreenshotContent(raw []byte, pixels *int) (string, *providerScreenshotURL, bool) {
	const prefix = "data:image/png;base64,"
	const maxPixels = 4 * runtimechannel.BrowserImageMaxDimension * runtimechannel.BrowserImageMaxDimension
	var parts []providerScreenshotPart
	if strict(raw, &parts) != nil || len(parts) == 0 || len(parts) > 8 {
		return "", nil, false
	}
	var screenshot *providerScreenshotURL
	var text strings.Builder
	for _, part := range parts {
		switch part.Type {
		case "text":
			if part.Text == nil || part.ImageURL != nil {
				return "", nil, false
			}
			text.WriteString(*part.Text)
		case "image_url":
			if screenshot != nil || part.Text != nil || part.ImageURL == nil {
				return "", nil, false
			}
			encoded, ok := strings.CutPrefix(part.ImageURL.URL, prefix)
			if !ok || len(encoded) > base64.StdEncoding.EncodedLen(runtimechannel.BrowserImageMaxBytes) || strings.ContainsAny(encoded, "\r\n") {
				return "", nil, false
			}
			data, err := base64.StdEncoding.Strict().DecodeString(encoded)
			if err != nil || len(data) > runtimechannel.BrowserImageMaxBytes {
				return "", nil, false
			}
			config, err := png.DecodeConfig(bytes.NewReader(data))
			if err != nil || config.Width > runtimechannel.BrowserImageMaxDimension || config.Height > runtimechannel.BrowserImageMaxDimension ||
				config.Width*config.Height > maxPixels-*pixels {
				return "", nil, false
			}
			if _, err := png.Decode(bytes.NewReader(data)); err != nil {
				return "", nil, false
			}
			*pixels += config.Width * config.Height
			screenshot = part.ImageURL
		default:
			return "", nil, false
		}
	}
	return text.String(), screenshot, screenshot != nil
}
