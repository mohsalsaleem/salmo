// blog-go — the hello-blog tutorial from FULLSTACK.md.
//
// Pure server-rendered blog exercising all three Go packages
// (dsd + render + session) against sqlite via stdlib database/sql.
// No JavaScript runtime is loaded — the demo's interactivity is
// browser-native forms over plain HTTP. See examples/server-hello/
// for the client-side hydration story.
//
// Run from this directory:
//
//	cd examples/blog-go && go run .
//
// Then open http://localhost:8080. A sqlite file blog.db is created
// in the current directory on first run.
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mohsalsaleem/salmo/server/dsd"
	"github.com/mohsalsaleem/salmo/server/render"
	"github.com/mohsalsaleem/salmo/server/session"
	_ "modernc.org/sqlite"
)

// --- domain ---------------------------------------------------------------

type Post struct {
	ID        int64
	AuthorID  string
	Title     string
	Body      string
	CreatedAt time.Time
}

// Identity is the session payload — an opaque random ID issued on
// first visit so the server can tie posts back to the same visitor
// across requests. Persisting across browser restarts comes free
// from the cookie's MaxAge.
type Identity struct {
	ID string `json:"id"`
}

const schema = `
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_author ON posts (author_id);
`

// --- app wiring -----------------------------------------------------------

type app struct {
	db    *sql.DB
	store *session.CookieStore[Identity]
}

// --- DB helpers (raw SQL per FULLSTACK.md tutorial decision) ---------------

func (a *app) listPosts(ctx context.Context) ([]Post, error) {
	rows, err := a.db.QueryContext(ctx,
		`SELECT id, author_id, title, body, created_at FROM posts ORDER BY id DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Post
	for rows.Next() {
		var p Post
		var ts int64
		if err := rows.Scan(&p.ID, &p.AuthorID, &p.Title, &p.Body, &ts); err != nil {
			return nil, err
		}
		p.CreatedAt = time.Unix(ts, 0)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (a *app) getPost(ctx context.Context, id int64) (Post, error) {
	var p Post
	var ts int64
	err := a.db.QueryRowContext(ctx,
		`SELECT id, author_id, title, body, created_at FROM posts WHERE id = ?`, id).
		Scan(&p.ID, &p.AuthorID, &p.Title, &p.Body, &ts)
	if err != nil {
		return Post{}, err
	}
	p.CreatedAt = time.Unix(ts, 0)
	return p, nil
}

func (a *app) insertPost(ctx context.Context, authorID, title, body string) (int64, error) {
	r, err := a.db.ExecContext(ctx,
		`INSERT INTO posts (author_id, title, body, created_at) VALUES (?, ?, ?, ?)`,
		authorID, title, body, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return r.LastInsertId()
}

func (a *app) countByAuthor(ctx context.Context, authorID string) (int, error) {
	var n int
	err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM posts WHERE author_id = ?`, authorID).Scan(&n)
	return n, err
}

// --- session ---------------------------------------------------------------

// identityOrIssue reads the session identity, issuing + setting a
// fresh one if none exists or the existing cookie is invalid. The
// new-identity branch writes a Set-Cookie header.
func (a *app) identityOrIssue(w http.ResponseWriter, r *http.Request) (Identity, error) {
	id, err := a.store.Get(r)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, session.ErrNoSession) && !errors.Is(err, session.ErrInvalidSession) {
		return Identity{}, err
	}
	fresh := Identity{ID: randID()}
	if err := a.store.Set(w, fresh); err != nil {
		return Identity{}, err
	}
	return fresh, nil
}

func randID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failures on Linux are catastrophic — let the
		// process crash so it's obvious.
		log.Fatalf("crypto/rand: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

// --- components ------------------------------------------------------------

// HomePage is the list view at /. Renders via html/template so the
// post-body interpolation gets auto-escaped.
type HomePage struct {
	Posts         []Post
	UserPostCount int
}

func (HomePage) Tag() string { return "blog-home" }
func (h HomePage) Render(_ context.Context) (template.HTML, error) {
	var b strings.Builder
	if err := homeTpl.Execute(&b, h); err != nil {
		return "", err
	}
	return template.HTML(b.String()), nil
}

var homeTpl = template.Must(template.New("home").Parse(`
<style>
  blog-home { display: block; max-width: 720px; margin: 48px auto;
              font-family: system-ui, -apple-system, sans-serif;
              color: #222; padding: 0 16px; }
  h1 { margin: 0 0 8px; }
  .meta { color: #666; margin: 0 0 32px; }
  ul { list-style: none; padding: 0; }
  li { padding: 12px 0; border-top: 1px solid #eee; }
  li a { font-size: 18px; text-decoration: none; color: #333; }
  li a:hover { text-decoration: underline; }
  li small { color: #888; display: block; margin-top: 4px; }
  .empty { color: #888; font-style: italic; }
  .write { display: inline-block; padding: 8px 16px; background: #764ba2;
           color: #fff; border-radius: 6px; text-decoration: none; }
</style>
<h1>Blog</h1>
<p class="meta">You've posted {{.UserPostCount}} time{{if ne .UserPostCount 1}}s{{end}}.
   <a class="write" href="/new">Write a post</a></p>
{{if .Posts}}
<ul>
  {{range .Posts}}
  <li>
    <a href="/posts/{{.ID}}">{{.Title}}</a>
    <small>by {{.AuthorID}} on {{.CreatedAt.Format "2006-01-02"}}</small>
  </li>
  {{end}}
</ul>
{{else}}
<p class="empty">No posts yet. Be the first.</p>
{{end}}
`))

// PostDetail renders one post.
type PostDetail struct {
	Post Post
}

func (PostDetail) Tag() string { return "post-detail" }
func (p PostDetail) Render(_ context.Context) (template.HTML, error) {
	var b strings.Builder
	if err := postTpl.Execute(&b, p.Post); err != nil {
		return "", err
	}
	return template.HTML(b.String()), nil
}

var postTpl = template.Must(template.New("post").Parse(`
<style>
  post-detail { display: block; max-width: 720px; margin: 48px auto;
                font-family: system-ui, -apple-system, sans-serif;
                color: #222; padding: 0 16px; line-height: 1.6; }
  h1 { margin: 0 0 8px; }
  .meta { color: #666; margin: 0 0 32px; font-size: 14px; }
  .body { white-space: pre-wrap; }
  a.back { color: #764ba2; }
</style>
<article>
  <h1>{{.Title}}</h1>
  <p class="meta">by {{.AuthorID}} on {{.CreatedAt.Format "2006-01-02 15:04"}}</p>
  <div class="body">{{.Body}}</div>
  <p><a class="back" href="/">← Back to all posts</a></p>
</article>
`))

// PostForm is the /new view. Pure HTML form; submission is browser-native
// (POST to /posts), no client-side JS required.
type PostForm struct{}

func (PostForm) Tag() string { return "post-form" }
func (PostForm) Render(_ context.Context) (template.HTML, error) {
	return template.HTML(`
<style>
  post-form { display: block; max-width: 720px; margin: 48px auto;
              font-family: system-ui, -apple-system, sans-serif;
              color: #222; padding: 0 16px; }
  h1 { margin: 0 0 24px; }
  label { display: block; margin-top: 16px; font-weight: 600; }
  input, textarea { width: 100%; padding: 10px; border: 1px solid #ddd;
                    border-radius: 4px; font: inherit; font-size: 14px;
                    box-sizing: border-box; }
  textarea { min-height: 240px; resize: vertical; }
  button { margin-top: 20px; background: #764ba2; color: #fff; border: 0;
           padding: 10px 24px; border-radius: 6px; font-size: 16px;
           cursor: pointer; }
  button:hover { background: #5a3782; }
  a.cancel { display: inline-block; margin-left: 12px; color: #666; }
</style>
<form method="post" action="/posts">
  <h1>Write a post</h1>
  <label for="title">Title</label>
  <input id="title" name="title" required maxlength="200">
  <label for="body">Body</label>
  <textarea id="body" name="body" required></textarea>
  <div>
    <button type="submit">Publish</button>
    <a class="cancel" href="/">cancel</a>
  </div>
</form>
`), nil
}

// --- handlers --------------------------------------------------------------

func (a *app) home(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	me, err := a.identityOrIssue(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	posts, err := a.listPosts(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	count, err := a.countByAuthor(r.Context(), me.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	a.renderPage(w, r, "Blog", HomePage{Posts: posts, UserPostCount: count})
}

func (a *app) newPost(w http.ResponseWriter, r *http.Request) {
	if _, err := a.identityOrIssue(w, r); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	a.renderPage(w, r, "Write a post", PostForm{})
}

func (a *app) createPost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	title := strings.TrimSpace(r.FormValue("title"))
	body := strings.TrimSpace(r.FormValue("body"))
	if title == "" || body == "" {
		http.Error(w, "title and body required", http.StatusBadRequest)
		return
	}
	me, err := a.identityOrIssue(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	id, err := a.insertPost(r.Context(), me.ID, title, body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, fmt.Sprintf("/posts/%d", id), http.StatusSeeOther)
}

func (a *app) showPost(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/posts/")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	p, err := a.getPost(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	a.renderPage(w, r, p.Title, PostDetail{Post: p})
}

// renderPage wraps a component in the document scaffold. No Salmo
// runtime is loaded — see examples/server-hello/ for that flow.
func (a *app) renderPage(w http.ResponseWriter, r *http.Request, title string, body dsd.Component) {
	opts := render.PageOpts{
		Title: title + " — Salmo Blog",
	}
	if err := render.Page(w, r, opts, body); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// --- main ------------------------------------------------------------------

func main() {
	db, err := sql.Open("sqlite", "blog.db")
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()
	if _, err := db.ExecContext(context.Background(), schema); err != nil {
		log.Fatalf("schema: %v", err)
	}

	// Cookie-signing secret. Regenerated on every run for the demo —
	// production would load from env / vault so sessions persist
	// across restarts. With this throwaway secret, restarting the
	// server invalidates everyone's session.
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		log.Fatalf("rand: %v", err)
	}

	opts := session.DefaultCookieOptions()
	opts.Name = "salmo_blog"
	opts.Secure = false // local HTTP demo; flip to true behind HTTPS

	store, err := session.NewCookieStore[Identity](secret, opts)
	if err != nil {
		log.Fatalf("session store: %v", err)
	}

	a := &app{db: db, store: store}

	mux := http.NewServeMux()
	mux.HandleFunc("/", a.home)
	mux.HandleFunc("/new", a.newPost)
	mux.HandleFunc("/posts", a.createPost)
	mux.HandleFunc("/posts/", a.showPost)

	const addr = ":8080"
	log.Printf("blog-go listening at http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
