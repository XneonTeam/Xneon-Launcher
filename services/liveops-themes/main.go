package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) > 0 && (args[0] == "put" || args[0] == "list" || args[0] == "delete") {
		return adminCommand(args)
	}
	if len(args) > 0 && args[0] == "serve" {
		args = args[1:]
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet("themesvc serve", flag.ContinueOnError)
	root := flags.String("root", filepath.Dir(executable), "Deployment directory including the executable")
	address := flags.String("listen", "127.0.0.1:8091", "HTTP listen address")
	publicURL := flags.String("public-url", "http://127.0.0.1:8091", "Public HTTPS origin, or loopback URL for development")
	cert := flags.String("tls-cert", "", "TLS certificate file")
	key := flags.String("tls-key", "", "TLS key file")
	if err = flags.Parse(args); err != nil {
		return err
	}
	*root, err = filepath.Abs(*root)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(*root, 0700); err != nil {
		return err
	}
	relative, err := filepath.Rel(*root, executable)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return errors.New("server executable must be inside deployment root; build it there, do not deploy go run")
	}
	info, err := os.Stat(executable)
	if err != nil {
		return err
	}
	if info.Size() > 16_000_000 {
		return errors.New("server executable exceeds reserved 16 MB; build with -ldflags=-s -w")
	}
	if (*cert == "") != (*key == "") {
		return errors.New("specify both tls-cert and tls-key")
	}
	listener, err := net.Listen("tcp", *address)
	if err != nil {
		return err
	}
	defer listener.Close()
	token, err := adminToken(filepath.Join(*root, "admin.token"))
	if err != nil {
		return err
	}
	s, err := newService(*root, *publicURL, token, hardDiskLimit, time.Now)
	if err != nil {
		return err
	}
	httpServer := &http.Server{Handler: s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() {
		if *cert != "" {
			done <- httpServer.ServeTLS(listener, *cert, *key)
		} else {
			done <- httpServer.Serve(listener)
		}
	}()
	log.Printf("Theme service listening on %s; admin token is stored in admin.token (not logged)", listener.Addr())
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err = s.Cleanup(); err != nil {
				log.Print("theme cleanup failed")
			}
		case err = <-done:
			if !errors.Is(err, http.ErrServerClosed) {
				return err
			}
			return nil
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			return httpServer.Shutdown(shutdown)
		}
	}
}

func adminToken(file string) (string, error) {
	info, err := os.Lstat(file)
	if errors.Is(err, os.ErrNotExist) {
		bytes := make([]byte, 32)
		if _, err = rand.Read(bytes); err != nil {
			return "", err
		}
		f, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return "", err
		}
		_, writeErr := f.WriteString(hex.EncodeToString(bytes) + "\n")
		closeErr := f.Close()
		if writeErr != nil {
			return "", writeErr
		}
		if closeErr != nil {
			return "", closeErr
		}
	} else if err != nil {
		return "", err
	} else if !info.Mode().IsRegular() {
		return "", errors.New("admin token must be a regular file")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return "", err
	}
	token := strings.TrimSpace(string(data))
	if len(token) < 32 || len(token) > 256 {
		return "", errors.New("invalid admin token file")
	}
	return token, nil
}

func adminCommand(args []string) error {
	command := args[0]
	flags := flag.NewFlagSet("themesvc "+command, flag.ContinueOnError)
	server := flags.String("url", "http://127.0.0.1:8091", "Service URL")
	tokenFile := flags.String("token-file", "admin.token", "Local admin token file")
	id := flags.String("id", "", "Unique event ID")
	start := flags.String("start", "", "RFC3339 start, inclusive")
	end := flags.String("end", "", "RFC3339 end, exclusive")
	file := flags.String("file", "", "JSON package or ZIP containing theme.json and assets/")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	data, err := os.ReadFile(*tokenFile)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(*server, "/") + "/v1/admin/events"
	method := "GET"
	var body io.Reader
	if command != "list" {
		if !eventID.MatchString(*id) {
			return errors.New("invalid event ID")
		}
		endpoint += "/" + *id
	}
	contentType := "application/json"
	if command == "delete" {
		method = "DELETE"
	}
	if command == "put" {
		method = "PUT"
		input, err := os.Open(*file)
		if err != nil {
			return err
		}
		defer input.Close()
		info, err := input.Stat()
		if err != nil {
			return err
		}
		if info.Size() > maxPackage {
			return errors.New("upload exceeds 4 MB")
		}
		body = input
		if strings.EqualFold(filepath.Ext(*file), ".zip") {
			contentType = "application/zip"
		}
		query := url.Values{"start_date": {*start}, "end_date": {*end}}
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequest(method, endpoint, body)
	if err != nil {
		return err
	}
	if req.URL.Scheme != "https" && req.URL.Hostname() != "127.0.0.1" && req.URL.Hostname() != "localhost" && req.URL.Hostname() != "::1" {
		return errors.New("use HTTPS outside loopback")
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(data)))
	req.Header.Set("Content-Type", contentType)
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	result, err := client.Do(req)
	if err != nil {
		return err
	}
	defer result.Body.Close()
	output, err := io.ReadAll(io.LimitReader(result.Body, 64_001))
	if err != nil {
		return err
	}
	if len(output) > 64_000 {
		return errors.New("admin response too large")
	}
	if result.StatusCode >= 300 {
		return fmt.Errorf("service returned HTTP %d: %s", result.StatusCode, output)
	}
	_, err = os.Stdout.Write(append(output, '\n'))
	return err
}
