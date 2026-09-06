# Promotos

Turns rough context into a well-structured prompt.

## Run it

```
npm install
cp .env.example .env     # then paste your real key into .env
node server.js
```

Then open http://localhost:3000

Without a key it still runs. It falls back to local keyword rules and
says so in the UI, rather than erroring.

## Files

| File | Runs on | Job |
|---|---|---|
| `index.html` | client | structure and content of the page |
| `style.css` | client | how the page looks |
| `app.js` | client | reacts to clicks, calls the API, renders the reply |
| `server.js` | server | serves the files, routes HTTP, nothing else |
| `improver.js` | server | calls Claude, falls back to local rules on any failure |

## Where each Phase 1 concept lives in the code

| Concept | Where to look |
|---|---|
| Website (files served from elsewhere) | `serveStaticFile()` in `server.js` |
| Client / frontend | `index.html`, `style.css`, `app.js` |
| Server / backend | `server.js` |
| Browser | whatever you open localhost:3000 in |
| Web server | `http.createServer()` in `server.js` |
| Request | the `req` object, and `fetch()` in `app.js` |
| Response | the `res` object, and `sendJson()` in `server.js` |
| HTTP methods | `req.method === "POST"` routing in `server.js` |
| Status codes | 200, 400, 404, 405, 413 in `server.js` |
| URL and path | `new URL(req.url, ...)` in `server.js` |
| HTML | `index.html` |
| CSS | `style.css` |
| JavaScript | `app.js` on the client, `server.js` on the server |
| API | everything under `/api/` |
| Endpoint | `POST /api/improve` |
| JSON | `JSON.stringify` in `app.js`, `JSON.parse` in `readJsonBody()` |
| Data flow | `app.js improvePrompt()` → `server.js handleImprove()` → `improver.js improve()` → back to `render()` |
| Secrets stay server-side | `ANTHROPIC_API_KEY` is read in `improver.js` only, never sent to the browser |

## The whole loop, in order

```
1. browser        GET /                        -> server sends index.html
2. browser        GET /style.css, GET /app.js  -> server sends both
3. user types context, clicks the button
4. app.js         POST /api/improve  {"context": "..."}
5. server.js      reads JSON, detects task type, builds the prompt
6. server.js      responds 200 with JSON  {"prompt": "...", ...}
7. app.js         parses the JSON, writes it into the page
8. user reads the improved prompt
```

## Phase 2: the model call

`improver.js` now calls `claude-opus-5` to do the rewriting. Two things
matter about how it is wired:

**It never hard-fails.** No key, a rejected key, a rate limit, a network
drop, or a model refusal all fall back to the Phase 1 keyword rules. The
response says which path ran via its `mode` field, and the UI shows it.
Degrading silently would be worse than degrading loudly.

**The key never reaches the browser.** It is read in `improver.js`, which
runs only on the server. `.env` is gitignored; `.env.example` is the
committed template. This is the practical payoff of the client/server
split: `app.js` is readable by anyone who visits, `improver.js` is not.

Tuning knob: `output_config.effort` in `improver.js`. Raise to `high` for
better prompts, drop to `low` for faster ones.
