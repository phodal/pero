package plugins

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const skillHubOrigin = "https://api.skillhub.cn"
const skillHubCDN = "skillhub-1388575217.cos.accelerate.myqcloud.com"

var skillHubSegment = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)
var skillHubVersion = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.+_-]{0,99}$`)

type SkillHubRelease struct {
	Publisher string
	Slug      string
	Version   string
	ID        uint64
}

type skillHubPackage struct {
	ID      uint64 `json:"version_id"`
	Slug    string `json:"skill_slug"`
	Version string `json:"skill_version"`
	MD5     string `json:"package_md5"`
}

// FetchSkillHub installs only the explicitly selected public release into a
// generated Pero view. It does not interpret package hooks or run its scripts.
func FetchSkillHub(ctx context.Context, cache string, release SkillHubRelease) (SkillFetchReceipt, error) {
	if !skillHubSegment.MatchString(release.Publisher) || !skillHubSegment.MatchString(release.Slug) ||
		!skillHubVersion.MatchString(release.Version) || release.ID == 0 {
		return SkillFetchReceipt{}, errors.New("plugins: invalid SkillHub release")
	}
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) != 1 || req.URL.Scheme != "https" || req.URL.Host != skillHubCDN || req.URL.User != nil {
			return errors.New("unrecognized SkillHub download origin")
		}
		return nil
	}}
	query := url.Values{"namespace": {release.Publisher}}
	metadataURL := fmt.Sprintf("%s/api/v1/open/skills/%s/versions/%s/signature?%s", skillHubOrigin, release.Slug, release.Version, query.Encode())
	raw, err := readSkillHub(ctx, client, metadataURL, 256<<10)
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	var envelope struct {
		Signed  bool   `json:"signed"`
		Payload string `json:"payload"`
	}
	var metadata skillHubPackage
	if json.Unmarshal(raw, &envelope) != nil || !envelope.Signed ||
		json.Unmarshal([]byte(envelope.Payload), &metadata) != nil ||
		metadata.ID != release.ID || metadata.Slug != release.Slug || metadata.Version != release.Version || len(metadata.MD5) != 32 {
		return SkillFetchReceipt{}, errors.New("plugins: SkillHub did not provide a checksum for the selected release")
	}
	query.Set("slug", release.Slug)
	query.Set("version", release.Version)
	data, err := readSkillHub(ctx, client, skillHubOrigin+"/api/v1/download?"+query.Encode(), maxSkillBundleBytes)
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	if !strings.EqualFold(fmt.Sprintf("%x", md5.Sum(data)), metadata.MD5) {
		return SkillFetchReceipt{}, errors.New("plugins: SkillHub package checksum differs from release metadata")
	}
	cache, err = filepath.Abs(cache)
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	if err = os.MkdirAll(cache, 0700); err != nil {
		return SkillFetchReceipt{}, err
	}
	stage, err := os.MkdirTemp(cache, ".skillhub-")
	if err != nil {
		return SkillFetchReceipt{}, err
	}
	defer os.RemoveAll(stage)
	source := filepath.Join(stage, "source")
	if err = unpackSkillHub(data, source); err != nil {
		return SkillFetchReceipt{}, err
	}
	content, err := os.ReadFile(filepath.Join(source, "SKILL.md"))
	if err != nil || len(content) > 128_001 {
		return SkillFetchReceipt{}, errors.New("plugins: SkillHub package needs a supported root SKILL.md")
	}
	if err = rejectDynamicSkill(string(content)); err != nil {
		return SkillFetchReceipt{}, err
	}
	revision := fmt.Sprintf("%x", sha256.Sum256(data))
	digest := fmt.Sprintf("%x", sha256.Sum256(content))
	namespace := fmt.Sprintf("market-%x", sha256.Sum256([]byte("skillhub:"+release.Publisher+"/"+release.Slug)))
	return publishSkillView(ctx, stage, cache, revision, "SKILL.md", namespace[:31], digest)
}

func readSkillHub(ctx context.Context, client *http.Client, address string, limit int64) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("plugins: could not connect to SkillHub")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("plugins: SkillHub returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, errors.New("plugins: could not read SkillHub package within the size limit")
	}
	return data, nil
}

func unpackSkillHub(data []byte, source string) error {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(archive.File) > 512 {
		return errors.New("plugins: invalid SkillHub archive")
	}
	if err = os.Mkdir(source, 0700); err != nil {
		return err
	}
	root, err := os.OpenRoot(source)
	if err != nil {
		return err
	}
	defer root.Close()
	var total int64
	seen := make(map[string]bool)
	directories := make(map[string]string)
	for _, member := range archive.File {
		name := strings.TrimSuffix(member.Name, "/")
		key := strings.ToLower(name)
		_, duplicate := seen[key]
		if !fs.ValidPath(name) || !localPath(name) || name == "." || strings.ContainsAny(name, ":\x00") ||
			duplicate || excludedSkillResource(key) {
			return errors.New("plugins: SkillHub archive contains an unsupported path")
		}
		isDirectory := member.FileInfo().IsDir()
		if _, isParent := directories[key]; isParent && !isDirectory {
			return errors.New("plugins: SkillHub archive contains an unsupported path")
		}
		seen[key] = isDirectory
		directory := path.Dir(name)
		if isDirectory {
			directory = name
		}
		for prefix := directory; prefix != "."; prefix = path.Dir(prefix) {
			folded := strings.ToLower(prefix)
			earlier, known := directories[folded]
			priorDirectory, priorMember := seen[folded]
			if (known && earlier != prefix) || (priorMember && !priorDirectory) {
				return errors.New("plugins: SkillHub archive contains an unsupported path")
			}
			directories[folded] = prefix
		}
		if isDirectory {
			continue
		}
		if !member.Mode().IsRegular() || member.UncompressedSize64 > uint64(maxSkillBundleBytes) ||
			accountSkillBytes(&total, int64(member.UncompressedSize64)) != nil {
			return errors.New("plugins: SkillHub archive contains an unsupported file")
		}
		if err = root.MkdirAll(filepath.Dir(name), 0700); err != nil {
			return err
		}
		input, err := member.Open()
		if err != nil {
			return err
		}
		content, readErr := io.ReadAll(io.LimitReader(input, int64(member.UncompressedSize64)+1))
		input.Close()
		if readErr != nil || uint64(len(content)) != member.UncompressedSize64 {
			return errors.New("plugins: SkillHub archive member failed validation")
		}
		if err = root.WriteFile(name, content, 0600); err != nil {
			return err
		}
	}
	return nil
}
