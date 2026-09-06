/* ---------------------------------------------------------------
   BACKEND. Runs on the SERVER under Node. The user never sees it.

     1. serve the frontend files when a browser asks for a page
     2. expose an API endpoint that takes data in and sends data back

   This file is deliberately only about HTTP. The actual prompt work
   lives in improver.js, so routing and thinking stay separable.
   --------------------------------------------------------------- */

// Loads .env into process.env if the file exists. Built into Node, so
// no dotenv package needed. Absent .env is fine, we just run keyless.
try {
  process.loadEnvFile();
} catch {
  // no .env present, which is a supported way to run
}

const http = require("http");
const fs = require("fs");
const path = require("path");
const { improve, hasApiKey, MODEL } = require("./improver");

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`${req.method} ${url.pathname}`);

  // Method plus path together decide which code runs. That pairing
  // is what the word "endpoint" means.
  if (req.method === "POST" && url.pathname === "/api/improve") {
    return handleImprove(req, res);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, model: MODEL, usingModel: hasApiKey() });
  }

  if (req.method === "GET") {
    return serveStaticFile(url.pathname, res);
  }

  sendJson(res, 405, { error: `${req.method} not allowed on ${url.pathname}` });
});

/* ---------------- the API endpoint ---------------- */

async function handleImprove(req, res) {
  let body;

  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "Body must be valid JSON." });
  }

  const context = typeof body.context === "string" ? body.context.trim() : "";

  if (!context) {
    return sendJson(res, 400, { error: "Field 'context' is required." });
  }

  if (context.length > 4000) {
    return sendJson(res, 413, { error: "Context too long. Keep it under 4000 characters." });
  }

  // Hand off to the brain. It always resolves, never throws, because
  // it falls back to local rules rather than failing the request.
  const result = await improve(context);

  sendJson(res, 200, {
    prompt: result.prompt,
    taskType: result.taskType,
    mode: result.mode,
    model: result.model,
    note: result.note,
    stats: {
      inputWords: countWords(context),
      outputWords: countWords(result.prompt),
    },
    generatedAt: new Date().toISOString(),
  });
}

/* ---------------- serving the frontend files ---------------- */

function serveStaticFile(pathname, res) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);

  // Never let a URL escape this folder via "../".
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }

    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

/* ---------------- small helpers ---------------- */

// An HTTP body arrives in chunks, so collect them all before parsing.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("error", reject);
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

server.listen(PORT, () => {
  console.log(`Promotos running at http://localhost:${PORT}`);
  console.log(hasApiKey() ? `Using ${MODEL}.` : "No ANTHROPIC_API_KEY found, running on local rules.");
});
