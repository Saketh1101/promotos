# Promotos

Turns rough context into a well-structured prompt.

## Run it

```
node server.js
```

Then open http://localhost:3000

No installs, no dependencies. Node's built-in modules only.

## Files

| File | Runs on | Job |
|---|---|---|
| `index.html` | client | structure and content of the page |
| `style.css` | client | how the page looks |
| `app.js` | client | reacts to clicks, calls the API, renders the reply |
| `server.js` | server | serves the files, and answers `POST /api/improve` |

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
| Data flow | `app.js improvePrompt()` → `server.js handleImprove()` → back to `render()` |

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

## Not here yet, on purpose

The prompt is built by plain rules in `buildPrompt()`, not by an AI model.
Phase 1 is about the wiring. When a model gets added later it slots into
that one function and nothing else has to change.
