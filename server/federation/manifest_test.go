package federation

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManifest_MarshalsExpectedShape(t *testing.T) {
	m := Manifest{
		Name:    "acme-widgets",
		Version: "1.0.0",
		Framework: &Framework{
			Name:       "salmo",
			MinVersion: "0.1.0",
		},
		Components: []Component{
			{
				Tag:       "acme-calendar",
				Src:       "./calendar.js",
				Integrity: "sha384-abc",
				Props:     []Prop{{Name: "date", Type: "string"}},
				Events:    []Event{{Name: "select"}},
			},
		},
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	got := string(b)

	// Spot-check against the schema in src/manifest.js. We avoid
	// asserting the entire byte string because Go map iteration is
	// unstable inside event.detail, but our test case doesn't use
	// that branch.
	mustContain(t, got, `"name":"acme-widgets"`)
	mustContain(t, got, `"version":"1.0.0"`)
	mustContain(t, got, `"framework":{"name":"salmo","minVersion":"0.1.0"}`)
	mustContain(t, got, `"tag":"acme-calendar"`)
	mustContain(t, got, `"src":"./calendar.js"`)
	mustContain(t, got, `"integrity":"sha384-abc"`)
}

func TestManifest_OmitsEmptyOptionals(t *testing.T) {
	m := Manifest{
		Name:    "x",
		Version: "1.0.0",
		Components: []Component{
			{Tag: "x-y", Src: "./y.js"},
		},
	}
	b, _ := json.Marshal(m)
	got := string(b)

	if strings.Contains(got, `"framework"`) {
		t.Errorf("framework should be omitted when nil, got: %s", got)
	}
	if strings.Contains(got, `"integrity"`) {
		t.Errorf("integrity should be omitted when empty, got: %s", got)
	}
	if strings.Contains(got, `"props"`) {
		t.Errorf("props should be omitted when nil, got: %s", got)
	}
	if strings.Contains(got, `"events"`) {
		t.Errorf("events should be omitted when nil, got: %s", got)
	}
}

func TestHandler_ServesJSONOnGET(t *testing.T) {
	m := Manifest{
		Name:       "x",
		Version:    "1.0.0",
		Components: []Component{{Tag: "x-y", Src: "./y.js"}},
	}
	srv := httptest.NewServer(Handler(m))
	defer srv.Close()

	res, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}

	var got Manifest
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Name != "x" || got.Version != "1.0.0" {
		t.Errorf("round-trip lost data: %+v", got)
	}
}

func TestHandler_Rejects_NonGET(t *testing.T) {
	srv := httptest.NewServer(Handler(Manifest{Name: "x", Version: "1.0.0"}))
	defer srv.Close()

	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		req, _ := http.NewRequest(method, srv.URL, nil)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", method, err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("%s: status = %d, want 405", method, res.StatusCode)
		}
		if allow := res.Header.Get("Allow"); allow != "GET" {
			t.Errorf("%s: Allow = %q, want GET", method, allow)
		}
	}
}

func TestHandler_EmptyComponents_SerializeAsArrayNotNull(t *testing.T) {
	// The JS validator iterates manifest.components; null would
	// crash it. Make sure nil → [] in the response body.
	srv := httptest.NewServer(Handler(Manifest{Name: "x", Version: "1.0.0"}))
	defer srv.Close()

	res, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer res.Body.Close()
	body := readAll(t, res)

	if !strings.Contains(body, `"components":[]`) {
		t.Errorf("nil components must serialize as [], got: %s", body)
	}
	if strings.Contains(body, `"components":null`) {
		t.Errorf("nil components must not serialize as null, got: %s", body)
	}
}

func TestIntegrityFor_KnownVector(t *testing.T) {
	// sha384("") is a well-known constant.
	// Verified via: printf '' | openssl dgst -sha384 -binary | openssl base64
	const want = "sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"
	if got := IntegrityFor([]byte("")); got != want {
		t.Errorf("IntegrityFor(\"\") = %q, want %q", got, want)
	}
}

func TestIntegrityFor_MatchesFileVersion(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "test.js")
	const content = "export const x = 1;"
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		t.Fatalf("write tmp: %v", err)
	}

	a := IntegrityFor([]byte(content))
	b, err := IntegrityForFile(tmp)
	if err != nil {
		t.Fatalf("IntegrityForFile: %v", err)
	}
	if a != b {
		t.Errorf("IntegrityFor and IntegrityForFile disagree:\n bytes: %s\n file:  %s", a, b)
	}
	if !strings.HasPrefix(a, "sha384-") {
		t.Errorf("SRI string should start with sha384-, got: %s", a)
	}
}

func TestIntegrityForFile_MissingFileReturnsError(t *testing.T) {
	_, err := IntegrityForFile("/nonexistent/path/that/does/not/exist.js")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

// --- helpers ---------------------------------------------------------------

func mustContain(t *testing.T, haystack, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Errorf("expected %q in:\n%s", needle, haystack)
	}
}

func readAll(t *testing.T, res *http.Response) string {
	t.Helper()
	var b strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			b.Write(buf[:n])
		}
		if err != nil {
			break
		}
	}
	return b.String()
}
