// Package federation is the server-side counterpart to FEDERATION.md.
// Two concerns it owns, both deliberately narrow:
//
//  1. Manifest emission: serving the JSON manifest that
//     `loadFromManifest` in src/manifest.js consumes. Schema lives
//     here in [Manifest] / [Component] / [Framework] etc.; the
//     wire format must match the JS validator.
//
//  2. Cross-origin auth via short-lived JWTs (HS256). When a host
//     embeds a remote across origins, the host's session cookie
//     can't travel to the remote's backend. The host instead signs
//     a JWT that the remote forwards to its own backend, which
//     validates against a shared secret (HS256) or a JWKS endpoint
//     (RS256 — not in v0). See FULLSTACK.md "Open questions" #2 for
//     the design rationale and rejected alternatives.
//
// What this package does NOT own:
//   - CORS policy (wrap [Handler] with your CORS middleware; the
//     framework can't know which origins are allowed)
//   - the JWKS / RS256 path (planned; HS256 is the v0 baseline)
//   - the manifest *contents* — caller assembles the [Manifest]
//     value and is responsible for the integrity hashes, SRC URLs,
//     etc. that go into it
package federation

import (
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// Manifest is the JSON document a federated host serves at a known
// URL so clients calling `loadFromManifest` can discover and register
// the host's components. Schema matches src/manifest.js's validator.
type Manifest struct {
	Name       string      `json:"name"`
	Version    string      `json:"version"`
	Framework  *Framework  `json:"framework,omitempty"`
	Components []Component `json:"components"`
}

// Framework declares which framework version the manifest targets.
// The JS validator compares MinVersion against the running framework
// version and reacts per the host's onVersionMismatch setting.
type Framework struct {
	Name       string `json:"name"`
	MinVersion string `json:"minVersion,omitempty"`
}

// Component describes one federated component. Src is resolved
// relative to the manifest URL on the client. Integrity, when set,
// must be a valid SRI string (e.g., "sha384-...") — use [IntegrityFor]
// or [IntegrityForFile] to compute one.
type Component struct {
	Tag       string  `json:"tag"`
	Src       string  `json:"src"`
	Integrity string  `json:"integrity,omitempty"`
	Props     []Prop  `json:"props,omitempty"`
	Events    []Event `json:"events,omitempty"`
}

// Prop documents a public reactive property a federated component
// accepts. Name is required; Type is a free-form hint for tooling.
type Prop struct {
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
}

// Event documents a custom event the component dispatches. Detail
// is a free-form hint mirroring the event.detail shape.
type Event struct {
	Name   string         `json:"name"`
	Detail map[string]any `json:"detail,omitempty"`
}

// Handler returns an http.Handler that serves m as JSON. The handler:
//
//   - responds to GET only (returns 405 for other methods)
//   - sets Content-Type: application/json; charset=utf-8
//   - marshals m once at handler-build time, so per-request work is
//     just a byte copy
//
// Does NOT emit CORS headers. Federation manifests are fetched
// cross-origin by definition; wrap Handler with your CORS middleware
// to control which origins may load this manifest. The package can't
// know which origins are allowed for your deployment.
func Handler(m Manifest) http.Handler {
	if m.Components == nil {
		// Force [] in JSON output rather than null, since the JS
		// validator iterates components.
		m.Components = []Component{}
	}
	body, err := json.Marshal(m)
	if err != nil {
		// Marshaling our own well-typed structs should never fail.
		// Panic at build time rather than per-request.
		panic(fmt.Errorf("federation: encode manifest: %w", err))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(body)
	})
}

// IntegrityFor returns the SRI-formatted SHA-384 hash of data —
// suitable for the integrity attribute of a federated component.
// SHA-384 is the SRI spec's recommended baseline.
func IntegrityFor(data []byte) string {
	sum := sha512.Sum384(data)
	return "sha384-" + base64.StdEncoding.EncodeToString(sum[:])
}

// IntegrityForFile reads the file at path and returns its
// SRI-formatted SHA-384 hash. Convenience over [IntegrityFor] for
// the common case of hashing a script file at handler-build time.
func IntegrityForFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha512.New384()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	sum := h.Sum(nil)
	return "sha384-" + base64.StdEncoding.EncodeToString(sum), nil
}
