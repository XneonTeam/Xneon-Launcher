package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const testToken = "synthetic-test-token-not-a-real-secret"
const themePackage = `{"format":"xneon-event-theme","version":1,"theme":{"name":"Winter","primary":"#8899aa","accent":"#44aacc","background":{"kind":"particles","source":"","particleStyle":"snow"}},"assets":[]}`

func fixture(t *testing.T, limit int64) (*service, *time.Time, string) {
	t.Helper()
	now := time.Date(2026, 11, 19, 0, 0, 0, 0, time.UTC)
	root := t.TempDir()
	s, err := newService(root, "https://themes.example", testToken, limit, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	return s, &now, root
}

func request(s *service, method, target, body string, authorized bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	if authorized {
		r.Header.Set("Authorization", "Bearer "+testToken)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func upload(s *service, id string, start, end string) *httptest.ResponseRecorder {
	return request(s, "PUT", "/v1/admin/events/"+id+"?start_date="+start+"&end_date="+end, themePackage, true)
}

func current(t *testing.T, s *service) map[string]any {
	t.Helper()
	w := request(s, "GET", "/v1/events/current", "", false)
	if w.Code != 200 {
		t.Fatalf("current: %d %s", w.Code, w.Body.String())
	}
	var data map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestScheduleDownloadExpiryAndRestart(t *testing.T) {
	s, now, root := fixture(t, 100_000_000)
	w := upload(s, "winter-2026", "2026-11-20T00:00:00Z", "2027-01-15T00:00:00Z")
	if w.Code != 201 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	if current(t, s)["active_event"] != nil {
		t.Fatal("event active before start")
	}
	*now = now.Add(24 * time.Hour)
	active := current(t, s)["active_event"].(map[string]any)
	if active["event_id"] != "winter-2026" {
		t.Fatal(active)
	}
	url := active["package_url"].(string)
	w = request(s, "GET", url, "", false)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("Winter")) {
		t.Fatalf("download: %d", w.Code)
	}
	s, err := newService(root, "https://themes.example", testToken, 100_000_000, func() time.Time { return *now })
	if err != nil {
		t.Fatal(err)
	}
	if current(t, s)["active_event"] == nil {
		t.Fatal("schedule lost after restart")
	}
	*now = time.Date(2027, 1, 15, 0, 0, 0, 0, time.UTC)
	if current(t, s)["active_event"] != nil {
		t.Fatal("end must be exclusive")
	}
	if request(s, "GET", url, "", false).Code != 404 {
		t.Fatal("expired package still served")
	}
	files, err := os.ReadDir(filepath.Join(root, "data", "packages"))
	if err != nil || len(files) != 0 {
		t.Fatalf("expired package not cleaned: %v %v", files, err)
	}
	if upload(s, "winter-2026", "2027-02-01T00:00:00Z", "2027-02-02T00:00:00Z").Code != 409 {
		t.Fatal("event_id reused")
	}
}

func TestAuthorizationOverlapAndValidation(t *testing.T) {
	s, _, _ := fixture(t, 100_000_000)
	if request(s, "PUT", "/v1/admin/events/test", "", false).Code != 401 {
		t.Fatal("admin endpoint unprotected")
	}
	if upload(s, "first", "2026-11-20T00:00:00Z", "2026-12-20T00:00:00Z").Code != 201 {
		t.Fatal("first upload")
	}
	if upload(s, "overlap", "2026-12-01T00:00:00Z", "2026-12-30T00:00:00Z").Code != 409 {
		t.Fatal("overlap accepted")
	}
	if upload(s, "bad", "wrong", "2026-12-30T00:00:00Z").Code != 400 {
		t.Fatal("invalid dates accepted")
	}
	// CSS — доверенный контент издателя, как в Custom Themes; это не script API.
	css := `{"format":"xneon-event-theme","version":1,"theme":{"name":"CSS","primary":"#ffffff","accent":"#ffffff","css":"body{display:none}"},"assets":[]}`
	endpoint := "/v1/admin/events/css?start_date=2027-01-01T00:00:00Z&end_date=2027-01-02T00:00:00Z"
	if request(s, "PUT", endpoint, css, false).Code != 401 {
		t.Fatal("publisher CSS bypassed authorization")
	}
	if request(s, "PUT", endpoint, css, true).Code != 201 {
		t.Fatal("authorized publisher CSS rejected")
	}
	for _, invalid := range []string{
		`{"format":"xneon-event-theme","version":1,"theme":{"name":"Bad","primary":"#ffffff","accent":"#ffffff","script":"alert(1)"},"assets":[]}`,
		`{"format":"xneon-event-theme","version":1,"theme":{"name":"Bad","primary":"#ffffff","accent":"#ffffff","background":{"kind":"image","source":"javascript:alert(1)"}},"assets":[]}`,
		`{"format":"xneon-event-theme","version":1,"theme":{"name":"Bad","primary":"#ffffff","accent":"#ffffff","background":{"kind":"image","source":"http://remote.example/bg.png"}},"assets":[]}`,
	} {
		if request(s, "PUT", "/v1/admin/events/bad?start_date=2027-02-01T00:00:00Z&end_date=2027-02-02T00:00:00Z", invalid, true).Code != 400 {
			t.Fatal("unsafe or executable theme accepted")
		}
	}
}

func TestQuotaAndRevocation(t *testing.T) {
	s, now, root := fixture(t, 2000)
	if err := os.WriteFile(filepath.Join(root, "deployment-overhead"), bytes.Repeat([]byte("x"), 1400), 0600); err != nil {
		t.Fatal(err)
	}
	w := upload(s, "winter", "2026-11-20T00:00:00Z", "2026-12-20T00:00:00Z")
	if w.Code != 507 {
		t.Fatalf("quota: %d %s", w.Code, w.Body.String())
	}
	if err := os.Remove(filepath.Join(root, "deployment-overhead")); err != nil {
		t.Fatal(err)
	}
	if upload(s, "winter", "2026-11-20T00:00:00Z", "2026-12-20T00:00:00Z").Code != 201 {
		t.Fatal("retry after quota failure")
	}
	*now = now.Add(24 * time.Hour)
	if request(s, "DELETE", "/v1/admin/events/winter", "", true).Code != 204 {
		t.Fatal("revoke")
	}
	if current(t, s)["active_event"] != nil {
		t.Fatal("revoked event active")
	}
}

func TestHTTPRoundTrip(t *testing.T) {
	s, _, _ := fixture(t, 100_000_000)
	server := httptest.NewServer(s)
	defer server.Close()
	response, err := http.Get(server.URL + "/v1/events/current")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 200 {
		t.Fatal(fmt.Sprint(err), string(data))
	}
}
