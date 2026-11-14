package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"path"
	"regexp"
	"strings"
)

type glow struct {
	Color string  `json:"color"`
	Alpha float64 `json:"alpha"`
}
type background struct {
	Kind          string   `json:"kind"`
	Source        string   `json:"source"`
	Dim           float64  `json:"dim,omitempty"`
	Blur          float64  `json:"blur,omitempty"`
	Opacity       *float64 `json:"opacity,omitempty"`
	Fit           string   `json:"fit,omitempty"`
	ParticleStyle string   `json:"particleStyle,omitempty"`
}
type theme struct {
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Primary     string            `json:"primary"`
	Accent      string            `json:"accent"`
	Palette     map[string]string `json:"palette,omitempty"`
	Glow        map[string]glow   `json:"glow,omitempty"`
	Background  *background       `json:"background,omitempty"`
}
type asset struct {
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Data      string `json:"data_base64"`
}
type themeBundle struct {
	Format  string  `json:"format"`
	Version int     `json:"version"`
	Theme   theme   `json:"theme"`
	Assets  []asset `json:"assets"`
}

var assetFile = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}\.(png|jpg|jpeg|webp|gif)$`)
var hexColor = regexp.MustCompile(`^#[a-fA-F0-9]{6}$`)

const paletteKeys = " background foreground card cardForeground muted mutedForeground border input primary primaryForeground accent accentForeground ring sidebar sidebarForeground sidebarPrimary sidebarPrimaryForeground sidebarAccent sidebarAccentForeground sidebarBorder "

func normalizePackage(data []byte, contentType string) (themeBundle, error) {
	var pkg themeBundle
	if strings.HasPrefix(contentType, "application/zip") || strings.HasPrefix(contentType, "application/octet-stream") {
		reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return pkg, errors.New("invalid ZIP")
		}
		if len(reader.File) > 34 {
			return pkg, errors.New("too many ZIP entries")
		}
		seen := map[string]bool{}
		manifest := false
		var total int64
		for _, file := range reader.File {
			if file.Name == "assets/" && file.FileInfo().IsDir() {
				continue
			}
			name := file.Name
			if !file.Mode().IsRegular() {
				return pkg, errors.New("ZIP links and special files are forbidden")
			}
			key := strings.ToLower(name)
			if seen[key] {
				return pkg, errors.New("duplicate ZIP entry")
			}
			seen[key] = true
			if name != "theme.json" && (!strings.HasPrefix(name, "assets/") || !assetFile.MatchString(strings.TrimPrefix(name, "assets/")) || path.Clean(name) != name) {
				return pkg, errors.New("invalid ZIP entry path")
			}
			if file.UncompressedSize64 > 3_000_000 {
				return pkg, errors.New("ZIP entry too large")
			}
			stream, err := file.Open()
			if err != nil {
				return pkg, errors.New("cannot open ZIP entry")
			}
			body, readErr := io.ReadAll(io.LimitReader(stream, 3_000_001))
			closeErr := stream.Close()
			if readErr != nil || closeErr != nil {
				return pkg, errors.New("corrupted ZIP entry")
			}
			total += int64(len(body))
			if total > 3_000_000 {
				return pkg, errors.New("expanded ZIP exceeds 3 MB")
			}
			if name == "theme.json" {
				if len(body) > 64_000 || strictJSON(body, &pkg.Theme) != nil {
					return pkg, errors.New("invalid theme.json")
				}
				manifest = true
			} else {
				pkg.Assets = append(pkg.Assets, asset{Name: strings.TrimPrefix(name, "assets/"), MediaType: http.DetectContentType(body), Data: base64.StdEncoding.EncodeToString(body)})
			}
		}
		if !manifest {
			return pkg, errors.New("theme.json missing")
		}
		pkg.Format = "xneon-event-theme"
		pkg.Version = 1
	} else if strings.HasPrefix(contentType, "application/json") {
		if err := strictJSON(data, &pkg); err != nil {
			return pkg, err
		}
	} else {
		return pkg, errors.New("use application/json or application/zip")
	}
	if pkg.Assets == nil {
		pkg.Assets = []asset{}
	}
	return pkg, validatePackage(pkg)
}

func validatePackage(pkg themeBundle) error {
	if pkg.Format != "xneon-event-theme" || pkg.Version != 1 {
		return errors.New("unsupported package format")
	}
	t := pkg.Theme
	if strings.TrimSpace(t.Name) == "" || len(t.Name) > 160 || len(t.Description) > 1000 || !hexColor.MatchString(t.Primary) || !hexColor.MatchString(t.Accent) {
		return errors.New("invalid theme name or colors")
	}
	for key, value := range t.Palette {
		if !strings.Contains(paletteKeys, " "+key+" ") || !hexColor.MatchString(value) {
			return errors.New("invalid palette")
		}
	}
	for key, g := range t.Glow {
		if (key != "primary" && key != "accent") || !hexColor.MatchString(g.Color) || g.Alpha < 0 || g.Alpha > 1 {
			return errors.New("invalid glow")
		}
	}
	if len(pkg.Assets) > 32 {
		return errors.New("too many assets")
	}
	assets := map[string]bool{}
	var total int
	for _, a := range pkg.Assets {
		key := strings.ToLower(a.Name)
		if !assetFile.MatchString(a.Name) || assets[key] {
			return errors.New("invalid or duplicate asset")
		}
		assets[key] = true
		body, err := base64.StdEncoding.Strict().DecodeString(a.Data)
		if err != nil || len(body) == 0 || base64.StdEncoding.EncodeToString(body) != a.Data {
			return errors.New("invalid asset base64")
		}
		total += len(body)
		if total > 3_000_000 {
			return errors.New("assets exceed 3 MB")
		}
		actual := http.DetectContentType(body)
		if (actual != "image/png" && actual != "image/jpeg" && actual != "image/webp" && actual != "image/gif") || actual != a.MediaType {
			return errors.New("unsupported asset content type")
		}
	}
	if b := t.Background; b != nil {
		if b.Dim < 0 || b.Dim > 1 || b.Blur < 0 || b.Blur > 24 || (b.Opacity != nil && (*b.Opacity < 0 || *b.Opacity > 1)) || (b.Fit != "" && b.Fit != "cover" && b.Fit != "contain") {
			return errors.New("invalid background settings")
		}
		switch b.Kind {
		case "image":
			if !strings.HasPrefix(b.Source, "assets/") {
				return errors.New("background must reference a packaged asset")
			}
			name := strings.TrimPrefix(b.Source, "assets/")
			if !assets[strings.ToLower(name)] {
				return errors.New("background asset missing")
			}
			found := false
			for _, a := range pkg.Assets {
				if a.Name == name {
					found = true
				}
			}
			if !found {
				return errors.New("background asset case mismatch")
			}
		case "particles":
			if b.Source != "" || (b.ParticleStyle != "snow" && b.ParticleStyle != "stars" && b.ParticleStyle != "network") {
				return errors.New("invalid particles")
			}
		case "halo":
			if b.Source != "" {
				return errors.New("invalid halo")
			}
		default:
			return errors.New("unsupported background kind")
		}
	}
	return nil
}
