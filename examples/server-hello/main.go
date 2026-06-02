// server-hello — a minimal end-to-end Salmo example.
//
// Run from this directory:
//
//	cd examples/server-hello && go run .
//
// Then open http://localhost:8080 (or http://localhost:8080/?name=Mo).
//
// The Go server renders a Salmo component as Declarative Shadow DOM
// on first paint; the matching client-side component in
// static/app.js upgrades the host once the JS runtime loads. See
// README.md in this directory for what to look for in the browser.
package main

import (
	"context"
	"embed"
	"html/template"
	"io/fs"
	"log"
	"net/http"

	"github.com/mohsalsaleem/salmo/server/render"
)

//go:embed static
var staticFS embed.FS

// Greeting is the SSR side of the x-greeting component. The shadow
// content emitted here is what a DSD-aware browser paints before any
// JS executes. The client-side definition in static/app.js takes over
// once the Salmo runtime loads.
type Greeting struct {
	Name string
}

func (Greeting) Tag() string                { return "x-greeting" }
func (Greeting) Shadow() bool               { return true }
func (g Greeting) Attrs() map[string]string { return map[string]string{"name": g.Name} }

func (g Greeting) Render(_ context.Context) (template.HTML, error) {
	safe := template.HTMLEscapeString(g.Name)
	return template.HTML(
		`<style>` + greetingStyle + `</style>` +
			`<h1>Hello, ` + safe + `!</h1>` +
			`<p>Server-rendered. Once JS loads, an interactive counter will appear below.</p>`,
	), nil
}

const greetingStyle = `
:host{display:block;padding:32px;font-family:system-ui,-apple-system,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border-radius:8px;text-align:center;max-width:480px;margin:48px auto}
h1{margin:0 0 12px;font-size:32px}
p{margin:0;opacity:.85;line-height:1.5}
button{margin-top:16px;background:#fff;color:#764ba2;border:0;padding:10px 20px;border-radius:6px;font-size:16px;cursor:pointer;font-weight:600}
button:hover{background:#f0f0f0}
`

func main() {
	mux := http.NewServeMux()

	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("embed sub: %v", err)
	}
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServerFS(staticSub)))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		name := r.URL.Query().Get("name")
		if name == "" {
			name = "World"
		}
		opts := render.PageOpts{
			Title: "salmo / server-hello",
			Scripts: []string{
				// Salmo runtime from the documented CDN install path.
				"https://cdn.jsdelivr.net/gh/mohsalsaleem/salmo@v0.1.0/src/index.js",
				// Client-side component definition (served from the embedded FS).
				"/static/app.js",
			},
		}
		if err := render.Page(w, r, opts, Greeting{Name: name}); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})

	const addr = ":8080"
	log.Printf("server-hello listening at http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
