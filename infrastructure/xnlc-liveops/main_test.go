package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAdminCLI(t *testing.T) {
	s, _, root := fixture(t, 100_000_000)
	server := httptest.NewServer(s)
	defer server.Close()
	token := filepath.Join(root, "token")
	if err := os.WriteFile(token, []byte(testToken), 0600); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "upload.json")
	if err := os.WriteFile(file, []byte(themePackage), 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"put", "--url", server.URL, "--token-file", token, "--id", "cli", "--start", "2026-11-20T00:00:00Z", "--end", "2026-12-20T00:00:00Z", "--file", file},
		{"list", "--url", server.URL, "--token-file", token},
		{"delete", "--url", server.URL, "--token-file", token, "--id", "cli"},
	} {
		if err := run(args); err != nil {
			t.Fatal(err)
		}
	}
	for _, args := range [][]string{
		{"delete", "--url", server.URL, "--token-file", token, "--id", "BAD"},
		{"list", "--url", "http://untrusted.example", "--token-file", token},
		{"put", "--url", server.URL, "--token-file", token, "--id", "bad", "--file", filepath.Join(root, "missing")},
		{"list", "--token-file", filepath.Join(root, "missing")},
		{"list", "--unknown"},
	} {
		if run(args) == nil {
			t.Fatal("invalid CLI invocation succeeded")
		}
	}
	if run([]string{"serve", "--unknown"}) == nil {
		t.Fatal("invalid serve args accepted")
	}
	if run([]string{"serve", "--root", root}) == nil {
		t.Fatal("executable outside root accepted")
	}
}

func TestAdminRedirectAndResponseErrors(t *testing.T) {
	token := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(token, []byte(testToken), 0600); err != nil {
		t.Fatal(err)
	}
	for _, handler := range []http.HandlerFunc{
		func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Location", "https://untrusted.example")
			w.WriteHeader(302)
		},
		func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, strings.Repeat("x", 64001)) },
		func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(403) },
	} {
		server := httptest.NewServer(handler)
		err := adminCommand([]string{"list", "--url", server.URL, "--token-file", token})
		server.Close()
		if err == nil {
			t.Fatal("invalid admin response accepted")
		}
	}
}

func TestServeConfiguration(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	// Только проверки до записи токена: используем каталог временного test-binary Go.
	root := filepath.Dir(executable)
	if err = run([]string{"serve", "--root", root, "--tls-cert", "missing"}); err == nil || !strings.Contains(err.Error(), "both tls-cert") {
		t.Fatalf("partial TLS config: %v", err)
	}
	if err = run([]string{"serve", "--root", root, "--listen", "invalid-address"}); err == nil {
		t.Fatal("invalid listen address")
	}
}
