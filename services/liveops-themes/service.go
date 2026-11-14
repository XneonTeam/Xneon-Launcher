package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const hardDiskLimit int64 = 100_000_000
const maxPackage int64 = 4_000_000
const maxCatalog = 1_000_000
const maxEvents = 32
const maxStoredPackages int64 = 60_000_000

var eventID = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
var digestID = regexp.MustCompile(`^[a-f0-9]{64}$`)
var errQuota = errors.New("disk budget exceeded")

type event struct {
	ID    string    `json:"event_id"`
	Name  string    `json:"name"`
	Start time.Time `json:"start_date"`
	End   time.Time `json:"end_date"`
	SHA   string    `json:"sha256"`
	Size  int64     `json:"size"`
	URL   string    `json:"package_url,omitempty"`
}
type catalog struct {
	Version int              `json:"version"`
	Events  map[string]event `json:"events"`
	Used    map[string]bool  `json:"used_ids"`
}
type service struct {
	mu              sync.Mutex
	root, publicURL string
	token           [32]byte
	limit           int64
	now             func() time.Time
	state           catalog
	gate            chan struct{}
}

func newService(root, publicURL, token string, limit int64, now func() time.Time) (*service, error) {
	u, err := url.Parse(publicURL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("invalid public URL")
	}
	if len(token) < 32 || limit <= 0 || limit > hardDiskLimit {
		return nil, errors.New("invalid token or disk limit")
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(root, "data", "packages"), 0700); err != nil {
		return nil, err
	}
	s := &service{root: root, publicURL: strings.TrimRight(publicURL, "/"), token: sha256.Sum256([]byte("Bearer " + token)), limit: limit, now: now, gate: make(chan struct{}, 16)}
	s.state = catalog{Version: 1, Events: map[string]event{}, Used: map[string]bool{}}
	data, err := os.ReadFile(s.catalogPath())
	if err == nil {
		if len(data) > maxCatalog || json.Unmarshal(data, &s.state) != nil || s.state.Version != 1 || s.state.Events == nil || s.state.Used == nil || len(s.state.Events) > maxEvents || len(s.state.Used) > 4096 {
			return nil, errors.New("invalid catalog")
		}
		for id, e := range s.state.Events {
			if !eventID.MatchString(id) || e.ID != id || !digestID.MatchString(e.SHA) || e.Size <= 0 || e.Size > maxPackage || !e.End.After(e.Start) || !s.state.Used[id] {
				return nil, errors.New("invalid catalog event")
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := s.gcPackages(); err != nil {
		return nil, err
	}
	if _, err := os.Stat(s.catalogPath()); errors.Is(err, os.ErrNotExist) {
		if err = s.commit(s.state); err != nil {
			return nil, err
		}
	}
	if err := s.cleanupLocked(); err != nil {
		return nil, err
	}
	used, err := diskUsage(root)
	if err != nil || used > s.ceiling() {
		return nil, fmt.Errorf("deployment exceeds disk budget: %w", errQuota)
	}
	return s, nil
}

func (s *service) catalogPath() string { return filepath.Join(s.root, "data", "catalog.json") }
func (s *service) packagePath(sha string) string {
	return filepath.Join(s.root, "data", "packages", sha+".json")
}
func (s *service) ceiling() int64 {
	reserve := s.limit / 10
	if reserve > 5_000_000 {
		reserve = 5_000_000
	}
	return s.limit - reserve
}

func diskUsage(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(_ string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			return errors.New("symlinks are not allowed in deployment")
		}
		if !d.IsDir() {
			info, e := d.Info()
			if e != nil {
				return e
			}
			if !info.Mode().IsRegular() {
				return errors.New("non-regular deployment file")
			}
			total += info.Size()
		}
		return nil
	})
	return total, err
}

// Проверяется пиковый размер: старый файл ещё существует, временный уже записывается.
func (s *service) atomicWrite(file string, data []byte) error {
	used, err := diskUsage(s.root)
	if err != nil {
		return err
	}
	if used+int64(len(data)) > s.ceiling() {
		return errQuota
	}
	tmp := file + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp) }()
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

func (s *service) commit(next catalog) error {
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if len(data) > maxCatalog {
		return errQuota
	}
	if err = s.atomicWrite(s.catalogPath(), data); err != nil {
		return err
	}
	s.state = next
	return nil
}
func (s *service) clone() catalog {
	next := catalog{Version: 1, Events: map[string]event{}, Used: map[string]bool{}}
	for id, e := range s.state.Events {
		next.Events[id] = e
	}
	for id, used := range s.state.Used {
		next.Used[id] = used
	}
	return next
}
func (s *service) gcPackages() error {
	referenced := map[string]bool{}
	for _, e := range s.state.Events {
		referenced[e.SHA+".json"] = true
	}
	entries, err := os.ReadDir(filepath.Join(s.root, "data", "packages"))
	if err != nil {
		return err
	}
	for _, file := range entries {
		name := file.Name()
		base := strings.TrimSuffix(strings.TrimSuffix(name, ".tmp"), ".json")
		if digestID.MatchString(base) && !referenced[name] {
			if err = os.Remove(filepath.Join(s.root, "data", "packages", name)); err != nil {
				return err
			}
		}
	}
	if err = os.Remove(s.catalogPath() + ".tmp"); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
func (s *service) cleanupLocked() error {
	next := s.clone()
	changed := false
	for id, e := range next.Events {
		if !s.now().Before(e.End) {
			delete(next.Events, id)
			changed = true
		}
	}
	if changed {
		if err := s.commit(next); err != nil {
			return err
		}
	}
	return s.gcPackages()
}
func (s *service) Cleanup() error { s.mu.Lock(); defer s.mu.Unlock(); return s.cleanupLocked() }

type response struct {
	status  int
	body    []byte
	headers map[string]string
}

func jsonResponse(status int, value any) response {
	data, err := json.Marshal(value)
	if err != nil {
		return failure(500, "internal_error", "Internal error")
	}
	return response{status, data, map[string]string{"Content-Type": "application/json; charset=utf-8"}}
}
func failure(status int, code, message string) response {
	return jsonResponse(status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func (s *service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	select {
	case s.gate <- struct{}{}:
		defer func() { <-s.gate }()
	default:
		w.Header().Set("Retry-After", "5")
		writeResponse(w, failure(503, "busy", "Retry later"))
		return
	}
	if strings.HasPrefix(r.URL.Path, "/v1/admin/") {
		hash := sha256.Sum256([]byte(r.Header.Get("Authorization")))
		if subtle.ConstantTimeCompare(hash[:], s.token[:]) != 1 {
			writeResponse(w, failure(401, "unauthorized", "Admin token required"))
			return
		}
	}
	s.mu.Lock()
	result := func() response {
		if err := s.cleanupLocked(); err != nil {
			return failure(503, "storage_unavailable", "Storage maintenance failed")
		}
		return s.route(r)
	}()
	s.mu.Unlock()
	writeResponse(w, result)
}
func writeResponse(w http.ResponseWriter, result response) {
	for key, value := range result.headers {
		w.Header().Set(key, value)
	}
	w.WriteHeader(result.status)
	if len(result.body) > 0 {
		_, _ = w.Write(result.body)
	}
}

func (s *service) route(r *http.Request) response {
	now := s.now().UTC()
	if r.Method == "GET" && r.URL.Path == "/healthz" {
		return jsonResponse(200, map[string]bool{"ok": true})
	}
	if r.Method == "GET" && r.URL.Path == "/v1/events/current" {
		var active *event
		nextCheck := now.Add(5 * time.Minute)
		for _, e := range s.state.Events {
			if e.Start.After(now) && e.Start.Before(nextCheck) {
				nextCheck = e.Start
			}
			if !now.Before(e.Start) && now.Before(e.End) {
				copy := e
				copy.URL = s.publicURL + "/v1/packages/" + e.SHA + ".json"
				active = &copy
				if e.End.Before(nextCheck) {
					nextCheck = e.End
				}
			}
		}
		return jsonResponse(200, map[string]any{"version": 1, "server_time": now, "next_check_at": nextCheck, "active_event": active})
	}
	if r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/v1/packages/") {
		name := strings.TrimPrefix(r.URL.Path, "/v1/packages/")
		sha := strings.TrimSuffix(name, ".json")
		if name != sha+".json" || !digestID.MatchString(sha) {
			return failure(404, "not_found", "Package not found")
		}
		allowed := false
		for _, e := range s.state.Events {
			if e.SHA == sha && !now.Before(e.Start) && now.Before(e.End) {
				allowed = true
			}
		}
		if !allowed {
			return failure(404, "not_found", "Package not found")
		}
		data, err := os.ReadFile(s.packagePath(sha))
		if err != nil || len(data) > int(maxPackage) {
			return failure(503, "package_unavailable", "Package unavailable")
		}
		hash := sha256.Sum256(data)
		if hex.EncodeToString(hash[:]) != sha {
			return failure(503, "package_corrupted", "Package unavailable")
		}
		result := jsonResponse(200, nil)
		result.body = data
		result.headers["ETag"] = `"` + sha + `"`
		return result
	}
	if r.Method == "GET" && r.URL.Path == "/v1/admin/events" {
		events := []event{}
		for _, e := range s.state.Events {
			events = append(events, e)
		}
		sort.Slice(events, func(i, j int) bool { return events[i].Start.Before(events[j].Start) })
		used, err := diskUsage(s.root)
		if err != nil {
			return failure(500, "storage_error", "Cannot measure storage")
		}
		return jsonResponse(200, map[string]any{"events": events, "disk_bytes": used, "limit_bytes": s.limit, "used_ids": len(s.state.Used)})
	}
	if strings.HasPrefix(r.URL.Path, "/v1/admin/events/") {
		id := strings.TrimPrefix(r.URL.Path, "/v1/admin/events/")
		if !eventID.MatchString(id) {
			return failure(400, "invalid_id", "Use a unique lowercase event_id")
		}
		if r.Method == "DELETE" {
			next := s.clone()
			delete(next.Events, id)
			if err := s.commit(next); err != nil {
				return failure(503, "storage_error", "Cannot revoke event")
			}
			if err := s.gcPackages(); err != nil {
				return failure(503, "storage_error", "Cannot remove package")
			}
			return response{status: 204}
		}
		if r.Method == "PUT" {
			return s.upload(r, id, now)
		}
	}
	return failure(404, "not_found", "Endpoint not found")
}

func (s *service) upload(r *http.Request, id string, now time.Time) response {
	if s.state.Used[id] {
		return failure(409, "id_reused", "event_id is immutable; create a new ID")
	}
	if len(s.state.Events) >= maxEvents || len(s.state.Used) >= 4096 {
		return failure(507, "catalog_full", "Catalog capacity reached")
	}
	start, err := time.Parse(time.RFC3339, r.URL.Query().Get("start_date"))
	if err != nil {
		return failure(400, "invalid_dates", "Use RFC3339 dates with timezone")
	}
	end, err := time.Parse(time.RFC3339, r.URL.Query().Get("end_date"))
	if err != nil || !end.After(start) || !end.After(now) || end.Sub(start) > 366*24*time.Hour {
		return failure(400, "invalid_dates", "Require start < end, future end and duration <= 366 days")
	}
	for _, e := range s.state.Events {
		if start.Before(e.End) && e.Start.Before(end) {
			return failure(409, "overlap", "Event periods cannot overlap")
		}
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxPackage+1))
	if err != nil {
		return failure(400, "invalid_body", "Cannot read upload")
	}
	if int64(len(body)) > maxPackage {
		return failure(413, "too_large", "Upload exceeds 4 MB")
	}
	pkg, err := normalizePackage(body, r.Header.Get("Content-Type"))
	if err != nil {
		return failure(400, "invalid_package", err.Error())
	}
	data, err := json.Marshal(pkg)
	if err != nil || int64(len(data)) > maxPackage {
		return failure(413, "too_large", "Normalized package exceeds 4 MB")
	}
	hash := sha256.Sum256(data)
	sha := hex.EncodeToString(hash[:])
	file := s.packagePath(sha)
	if _, err = os.Stat(file); errors.Is(err, os.ErrNotExist) {
		entries, e := os.ReadDir(filepath.Dir(file))
		if e != nil {
			return failure(503, "storage_error", "Cannot inspect storage")
		}
		var stored int64
		for _, entry := range entries {
			info, e := entry.Info()
			if e != nil {
				return failure(503, "storage_error", "Cannot inspect storage")
			}
			stored += info.Size()
		}
		if stored+int64(len(data)) > maxStoredPackages {
			return failure(507, "quota_exceeded", "Theme storage capacity reached")
		}
		if err = s.atomicWrite(file, data); err != nil {
			if errors.Is(err, errQuota) {
				return failure(507, "quota_exceeded", "Disk budget exceeded")
			}
			return failure(503, "storage_error", "Cannot store package")
		}
	} else if err != nil {
		return failure(503, "storage_error", "Cannot inspect package")
	}
	next := s.clone()
	next.Used[id] = true
	next.Events[id] = event{ID: id, Name: pkg.Theme.Name, Start: start.UTC(), End: end.UTC(), SHA: sha, Size: int64(len(data))}
	if err = s.commit(next); err != nil {
		_ = s.gcPackages()
		if errors.Is(err, errQuota) {
			return failure(507, "quota_exceeded", "Disk budget exceeded")
		}
		return failure(503, "storage_error", "Cannot store catalog")
	}
	result := jsonResponse(201, next.Events[id])
	result.headers["Location"] = "/v1/admin/events/" + id
	return result
}

// Для ограниченных JSON-документов: неизвестные поля и хвост после объекта отклоняются.
func strictJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("invalid JSON structure")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("unexpected data after JSON")
	}
	return nil
}
