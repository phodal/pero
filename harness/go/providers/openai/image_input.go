package openai

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

// ProviderImage is a bounded, fully decoded raster already held in memory.
// No remote URL, local path, SVG, file upload or implicit fetch is accepted.
const MaxInputImageBytes = 4 << 20
const MaxInputImageDimension = 2048
const MaxRequestImageBytes = 16 << 20

func encodeContent(content []harness.ContentBlock, imagesAllowed bool, imageBytes *int) (any, error) {
	var text strings.Builder
	var parts []wireContentPart
	flush := func() {
		if text.Len() > 0 {
			parts = append(parts, wireContentPart{Type: "text", Text: text.String()})
			text.Reset()
		}
	}
	for _, block := range content {
		if len(block.Extensions) > 0 {
			return nil, errors.New("unsupported content extensions")
		}
		switch block.Type {
		case harness.BlockText:
			text.WriteString(block.Text)
		case harness.BlockImage:
			if !imagesAllowed {
				return nil, errors.New("image input is not enabled for this model")
			}
			if len(block.Data) == 0 || len(block.Data) > MaxInputImageBytes || *imageBytes > MaxRequestImageBytes-len(block.Data) {
				return nil, errors.New("image input exceeds the bounded byte policy or has no in-memory bytes")
			}
			format := map[string]string{"image/png": "png", "image/jpeg": "jpeg"}[block.MIMEType]
			if format == "" {
				return nil, errors.New("image input supports only PNG and JPEG raster bytes")
			}
			config, actual, err := image.DecodeConfig(bytes.NewReader(block.Data))
			if err != nil || actual != format || config.Width < 1 || config.Height < 1 || config.Width > MaxInputImageDimension || config.Height > MaxInputImageDimension {
				return nil, errors.New("image input is malformed, MIME-mismatched or exceeds dimension limits")
			}
			if _, actual, err = image.Decode(bytes.NewReader(block.Data)); err != nil || actual != format {
				return nil, errors.New("image input is not a complete supported raster")
			}
			*imageBytes += len(block.Data)
			flush()
			parts = append(parts, wireContentPart{Type: "image_url", ImageURL: &wireImageURL{URL: "data:" + block.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(block.Data)}})
		default:
			return nil, errors.New("unsupported message or tool-result media/content")
		}
	}
	if len(parts) == 0 {
		return text.String(), nil
	} // Preserve the text-only wire contract.
	flush()
	return parts, nil
}
