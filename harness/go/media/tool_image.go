package media

import "fmt"

// Tool images use the bounded raster contract shared by native reads and the
// chat-completions adapter. Other transports may choose a different contract.
const ToolImageMaxBytes = 4 << 20
const ToolImageMaxDimension = 2048
const ToolImageRequestMaxBytes = 16 << 20

// NormalizeToolImage decodes a bounded source and returns PNG/JPEG. Animated
// inputs contribute their first frame; callers must disclose that limitation.
func NormalizeToolImage(data []byte, mime string) ([]byte, string, error) {
	if len(data) == 0 || int64(len(data)) > DefaultMaxImageBytes {
		return nil, "", fmt.Errorf("image is empty or too large; resize to at most %d bytes before retrying", DefaultMaxImageBytes)
	}
	w, h, detected, err := probeImageMetadata(data)
	if err != nil {
		return nil, "", err
	}
	if detected != mime {
		return nil, "", fmt.Errorf("declared image type does not match its bytes")
	}
	if w <= 0 || h <= 0 || int64(w) > DefaultMaxImagePixels/int64(h) {
		return nil, "", fmt.Errorf("image exceeds decoded pixel budget; resize before retrying")
	}
	orientation, err := imageOrientation(data, mime)
	if err != nil {
		return nil, "", err
	}
	normalized, err := normalizeImage(data, mime, orientation, imageNormalizationPolicy{
		MaxPixels:    ToolImageMaxDimension * ToolImageMaxDimension,
		MaxDimension: ToolImageMaxDimension, MaxBytes: ToolImageMaxBytes,
	})
	if err != nil {
		return nil, "", err
	}
	if len(normalized.Data) > ToolImageMaxBytes {
		return nil, "", fmt.Errorf("normalized image exceeds %d bytes; resize before retrying", ToolImageMaxBytes)
	}
	return normalized.Data, normalized.MediaType, nil
}
