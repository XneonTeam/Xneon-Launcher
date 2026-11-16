package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func zipBody(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var output bytes.Buffer
	w := zip.NewWriter(&output)
	for name, data := range entries {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func TestZIPAndAssets(t *testing.T) {
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR2sAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	manifest := []byte(`{"name":"Winter","primary":"#ffffff","accent":"#112233","background":{"kind":"image","source":"assets/bg.png"}}`)
	data := zipBody(t, map[string][]byte{"theme.json": manifest, "assets/bg.png": png})
	pkg, err := normalizePackage(data, "application/zip")
	if err != nil || len(pkg.Assets) != 1 {
		t.Fatalf("valid zip: %v", err)
	}
	encoded, err := json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = normalizePackage(encoded, "application/json"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"../evil", "assets/../../evil.png", "assets/sub/bg.png", "script.js"} {
		if _, err := normalizePackage(zipBody(t, map[string][]byte{"theme.json": manifest, name: png}), "application/zip"); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	if _, err = normalizePackage([]byte("broken"), "application/zip"); err == nil {
		t.Fatal("broken zip accepted")
	}
	if _, err = normalizePackage(zipBody(t, map[string][]byte{"assets/bg.png": png}), "application/zip"); err == nil {
		t.Fatal("missing manifest accepted")
	}
	pkg.Assets[0].MediaType = "image/svg+xml"
	if validatePackage(pkg) == nil {
		t.Fatal("SVG accepted")
	}
}

func TestPackageValidation(t *testing.T) {
	for _, body := range []string{
		`null`, `{}`, strings.Replace(themePackage, `"#8899aa"`, `"red"`, 1),
		strings.Replace(themePackage, `"snow"`, `"invalid"`, 1),
		strings.Replace(themePackage, `"source":""`, `"source":"https://example.org/a"`, 1),
		strings.Replace(themePackage, `"assets":[]`, `"assets":[{"name":"x.png","media_type":"image/png","data_base64":"invalid"}]`, 1),
		themePackage + `{}`, strings.Replace(themePackage, `"theme":{`, `"theme":{"palette":{"unknown":"#ffffff"},`, 1),
	} {
		if _, err := normalizePackage([]byte(body), "application/json"); err == nil {
			t.Fatalf("accepted invalid: %s", body)
		}
	}
	if _, err := normalizePackage([]byte(themePackage), "text/plain"); err == nil {
		t.Fatal("wrong MIME accepted")
	}
}

func TestCorruptionMaintenanceAndMethods(t *testing.T) {
	s, now, root := fixture(t, 100_000_000)
	if upload(s, "test", "2026-11-20T00:00:00Z", "2026-12-20T00:00:00Z").Code != 201 {
		t.Fatal("upload")
	}
	*now = now.Add(24 * time.Hour)
	e := s.state.Events["test"]
	if err := os.WriteFile(s.packagePath(e.SHA), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if request(s, "GET", "/v1/packages/"+e.SHA+".json", "", false).Code != 503 {
		t.Fatal("tampering not detected")
	}
	if request(s, "GET", "/v1/admin/events", "", true).Code != 200 {
		t.Fatal("list")
	}
	if request(s, "GET", "/healthz", "", false).Code != 200 {
		t.Fatal("health")
	}
	if request(s, "POST", "/v1/events/current", "", false).Code != 404 {
		t.Fatal("unknown method")
	}
	if request(s, "GET", "/v1/packages/../../secret", "", false).Code != 404 {
		t.Fatal("traversal")
	}
	if request(s, "PUT", "/v1/admin/events/INVALID", "", true).Code != 400 {
		t.Fatal("invalid id")
	}
	oversize := strings.Repeat("x", int(maxPackage)+1)
	if request(s, "PUT", "/v1/admin/events/next?start_date=2027-01-01T00:00:00Z&end_date=2027-01-02T00:00:00Z", oversize, true).Code != 413 {
		t.Fatal("large upload")
	}
	orphan := filepath.Join(root, "data", "packages", strings.Repeat("b", 64)+".json.tmp")
	if err := os.WriteFile(orphan, []byte("orphan"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.Cleanup(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatal("orphan not removed")
	}
	if err := os.WriteFile(s.catalogPath(), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := newService(root, "https://themes.example", testToken, 100_000_000, func() time.Time { return *now }); err == nil {
		t.Fatal("invalid catalog loaded")
	}
}

func TestTokenAndConfig(t *testing.T) {
	file := filepath.Join(t.TempDir(), "admin.token")
	first, err := adminToken(file)
	if err != nil || len(first) != 64 {
		t.Fatalf("token %v", err)
	}
	second, err := adminToken(file)
	if err != nil || first != second {
		t.Fatal("token not stable")
	}
	if err := os.WriteFile(file, []byte("short"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := adminToken(file); err == nil {
		t.Fatal("short token accepted")
	}
	for _, url := range []string{"file:///tmp", "https://user:pass@example.org", "https://example.org/path"} {
		if _, err := newService(t.TempDir(), url, testToken, 100_000_000, time.Now); err == nil {
			t.Fatal("invalid origin accepted")
		}
	}
	if _, err := newService(t.TempDir(), "https://themes.example", "short", 100_000_000, time.Now); err == nil {
		t.Fatal("short admin key")
	}
}

func TestDetailedThemeValidation(t *testing.T) {
	base := themeBundle{Format: "xneon-event-theme", Version: 1, Theme: theme{Name: "Theme", Primary: "#112233", Accent: "#abcdef"}, Assets: []asset{}}
	for index, mutate := range []func(*themeBundle){
		func(p *themeBundle) { p.Version = 2 },
		func(p *themeBundle) { p.Theme.Palette = map[string]string{"background": "#000000"} },
		func(p *themeBundle) { p.Theme.Palette = map[string]string{"background": "red"} },
		func(p *themeBundle) { p.Theme.Glow = map[string]glow{"primary": {Color: "#ffffff", Alpha: 0.5}} },
		func(p *themeBundle) { p.Theme.Glow = map[string]glow{"bad": {Color: "red", Alpha: 2}} },
		func(p *themeBundle) { p.Theme.Background = &background{Kind: "halo", Source: ""} },
		func(p *themeBundle) { p.Theme.Background = &background{Kind: "halo", Source: "external"} },
		func(p *themeBundle) { p.Theme.Background = &background{Kind: "image", Source: "assets/missing.png"} },
		func(p *themeBundle) {
			p.Theme.Background = &background{Kind: "image", Source: "https://example.org/bg.png"}
		},
		func(p *themeBundle) { p.Theme.Background = &background{Kind: "video", Source: ""} },
		func(p *themeBundle) { p.Theme.Background = &background{Kind: "halo", Blur: 25} },
		func(p *themeBundle) { p.Assets = make([]asset, 33) },
	} {
		p := base
		mutate(&p)
		err := validatePackage(p)
		valid := index == 1 || index == 3 || index == 5 || index == 8
		if (err == nil) != valid {
			t.Fatalf("validation case %d: %v", index, err)
		}
	}
	for _, valid := range []themeBundle{
		base,
		{Format: base.Format, Version: 1, Theme: theme{Name: "Halo", Primary: "#112233", Accent: "#abcdef", Background: &background{Kind: "halo", Source: ""}}},
	} {
		if err := validatePackage(valid); err != nil {
			t.Fatal(err)
		}
	}
	for _, source := range []string{"javascript:alert(1)", "http://remote.example/bg.png", "https://user:pass@themes.example/bg.png"} {
		p := base
		p.Theme.Background = &background{Kind: "image", Source: source}
		if validatePackage(p) == nil {
			t.Fatal("unsafe theme background accepted: " + source)
		}
	}
	oversized := base
	oversized.Theme.CSS = strings.Repeat("x", 1_000_001)
	if validatePackage(oversized) == nil {
		t.Fatal("oversized publisher CSS accepted")
	}
	data := zipBody(t, map[string][]byte{"theme.json": []byte(`{"name":"No assets","primary":"#112233","accent":"#abcdef"}`)})
	if _, err := normalizePackage(data, "application/octet-stream"); err != nil {
		t.Fatal(err)
	}
	if _, err := normalizePackage(zipBody(t, map[string][]byte{"theme.json": []byte("{}"), "assets/big.png": bytes.Repeat([]byte("x"), 3_000_001)}), "application/zip"); err == nil {
		t.Fatal("oversized expanded zip")
	}
}

func TestAdditionalStorageBoundaries(t *testing.T) {
	s, now, root := fixture(t, 100_000_000)
	if upload(s, "past", "2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z").Code != 400 {
		t.Fatal("past")
	}
	if upload(s, "long", "2026-11-20T00:00:00Z", "2029-01-01T00:00:00Z").Code != 400 {
		t.Fatal("duration")
	}
	if upload(s, "badend", "2026-11-20T00:00:00Z", "bad").Code != 400 {
		t.Fatal("end")
	}
	if request(s, "GET", "/v1/packages/invalid.json", "", false).Code != 404 {
		t.Fatal("bad digest")
	}
	if request(s, "GET", "/v1/packages/"+strings.Repeat("a", 64)+".json", "", false).Code != 404 {
		t.Fatal("unpublished")
	}
	if upload(s, "one", "2026-11-20T00:00:00Z", "2026-11-21T00:00:00Z").Code != 201 {
		t.Fatal("upload")
	}
	if upload(s, "two", "2026-11-21T00:00:00Z", "2026-11-22T00:00:00Z").Code != 201 {
		t.Fatal("touching intervals")
	}
	*now = time.Date(2026, 11, 21, 0, 0, 0, 0, time.UTC)
	if current(t, s)["active_event"].(map[string]any)["event_id"] != "two" {
		t.Fatal("boundary")
	}
	for i := 0; i < cap(s.gate); i++ {
		s.gate <- struct{}{}
	}
	if request(s, "GET", "/healthz", "", false).Code != 503 {
		t.Fatal("concurrency gate")
	}
	for i := 0; i < cap(s.gate); i++ {
		<-s.gate
	}
	if err := os.WriteFile(s.packagePath(s.state.Events["two"].SHA), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if request(s, "GET", "/v1/packages/"+s.state.Events["two"].SHA+".json", "", false).Code != 503 {
		t.Fatal("corrupted package")
	}
	if _, err := diskUsage(filepath.Join(root, "missing")); err == nil {
		t.Fatal("missing root")
	}
	s.limit = 1
	if err := s.atomicWrite(filepath.Join(root, "new"), []byte("x")); err != errQuota {
		t.Fatal("quota")
	}
}

func TestPersistenceFailures(t *testing.T) {
	s, _, root := fixture(t, 100_000_000)
	file := filepath.Join(root, "temporary-test")
	if err := os.WriteFile(file+".tmp", []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if s.atomicWrite(file, []byte("new")) == nil {
		t.Fatal("existing temporary file overwritten")
	}
	if s.atomicWrite(filepath.Join(root, "absent", "file"), []byte("new")) == nil {
		t.Fatal("missing parent")
	}
	if err := os.WriteFile(filepath.Join(root, "data", "packages", "unknown-file"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.gcPackages(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "data", "packages", "unknown-file")); err != nil {
		t.Fatal("unexpected user file removed")
	}
	if err := os.WriteFile(s.catalogPath(), []byte(`{"version":99}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := newService(root, "https://themes.example", testToken, 100_000_000, time.Now); err == nil {
		t.Fatal("bad catalog version")
	}
	if _, err := newService(root, "https://themes.example", testToken, 100_000_001, time.Now); err == nil {
		t.Fatal("limit above 100 MB")
	}
	if _, err := newService(root, "https://themes.example", testToken, 0, time.Now); err == nil {
		t.Fatal("zero limit")
	}
	blocked := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocked, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := newService(blocked, "https://themes.example", testToken, 100_000_000, time.Now); err == nil {
		t.Fatal("root is file")
	}
	badJSON := jsonResponse(200, make(chan int))
	if badJSON.status != 500 {
		t.Fatal("invalid JSON response")
	}
	s.state.Events = map[string]event{}
	for i := 0; i < maxEvents; i++ {
		s.state.Events[fmt.Sprint(i)] = event{Start: time.Date(2028, 1, 1, 0, 0, 0, 0, time.UTC), End: time.Date(2029, 1, 1, 0, 0, 0, 0, time.UTC)}
	}
	if upload(s, "full", "2026-11-20T00:00:00Z", "2026-12-20T00:00:00Z").Code != 507 {
		t.Fatal("full catalog")
	}
}
