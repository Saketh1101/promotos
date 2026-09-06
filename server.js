/* ---------------------------------------------------------------
   BACKEND. This runs on the SERVER, using Node.js. The user never
   sees this code. It has two responsibilities:

     1. serve the frontend files when a browser asks for a page
     2. expose an API endpoint that takes data in and sends data back

   No frameworks, no installs. Node's built-in http module only, so
   nothing here is hidden behind someone else's abstraction.
   --------------------------------------------------------------- */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

// Which file extension maps to which Content-Type. The browser uses
// this header to decide how to treat the bytes we send back.
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

/* The request handler. Node calls this function once per incoming
   HTTP request. `req` is the request, `res` is the response we build.
   This is the request/response pair, as actual objects.             */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`${req.method} ${url.pathname}`);

  // ROUTING: method + path together decide which code runs.
  // That pairing is what the word "endpoint" means.
  if (req.method === "POST" && url.pathname === "/api/improve") {
    return handleImprove(req, res);
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
  } catch (error) {
    // 400 means "your request was malformed", not "we broke".
    return sendJson(res, 400, { error: "Body must be valid JSON." });
  }

  const context = typeof body.context === "string" ? body.context.trim() : "";

  if (!context) {
    return sendJson(res, 400, { error: "Field 'context' is required." });
  }

  if (context.length > 4000) {
    return sendJson(res, 413, { error: "Context too long. Keep it under 4000 characters." });
  }

  const taskType = detectTaskType(context);
  const prompt = buildPrompt(context, taskType);

  // 200 plus a JSON body. The frontend parses this and renders it.
  sendJson(res, 200, {
    prompt: prompt,
    taskType: taskType,
    stats: {
      inputWords: countWords(context),
      outputWords: countWords(prompt),
    },
    generatedAt: new Date().toISOString(),
  });
}

/* ---------------- the actual "improving" ----------------
   Deliberately plain rules, no AI service yet. The point of Phase 1
   is the wiring, not the intelligence. When an AI call gets added
   later, it slots in right here and nothing else has to change.  */

const TASK_PATTERNS = [
  { type: "code", words: ["code", "function", "bug", "script", "api", "debug", "refactor", "error"] },
  { type: "email", words: ["email", "message", "reply", "landlord", "boss", "client", "apologize"] },
  { type: "analysis", words: ["analyze", "compare", "evaluate", "research", "pros", "cons", "decide"] },
  { type: "writing", words: ["write", "essay", "blog", "post", "story", "caption", "article"] },
  { type: "explanation", words: ["explain", "teach", "understand", "simplify", "what is", "how does"] },
];

function detectTaskType(context) {
  const lower = context.toLowerCase();
  for (const pattern of TASK_PATTERNS) {
    if (pattern.words.some((word) => lower.includes(word))) return pattern.type;
  }
  return "general";
}

const ROLES = {
  code: "an experienced software engineer",
  email: "a clear, professional communicator",
  analysis: "a rigorous analyst",
  writing: "a skilled writer",
  explanation: "a patient teacher",
  general: "a thoughtful assistant",
};

function buildPrompt(context, taskType) {
  return [
    `Act as ${ROLES[taskType]}.`,
    "",
    "TASK",
    summarizeTask(context, taskType),
    "",
    "CONTEXT",
    context,
    "",
    "REQUIREMENTS",
    "- Ask for any missing detail you genuinely need before answering.",
    "- Be specific and concrete; avoid filler and generic advice.",
    "- State any assumption you make explicitly.",
    ...extraRequirements(taskType),
    "",
    "OUTPUT FORMAT",
    outputFormat(taskType),
  ].join("\n");
}

function summarizeTask(context, taskType) {
  const firstSentence = context.split(/[.!?\n]/)[0].trim();
  const verbs = {
    code: "Help with the following technical problem:",
    email: "Draft the message described below:",
    analysis: "Analyze the situation described below:",
    writing: "Write the piece described below:",
    explanation: "Explain the topic described below:",
    general: "Help with the following:",
  };
  return `${verbs[taskType]} ${firstSentence || context.slice(0, 120)}`;
}

function extraRequirements(taskType) {
  const extras = {
    code: ["- Show working code, then explain the key lines.", "- Note edge cases that could break it."],
    email: ["- Match the tone requested; do not over-apologize.", "- Keep it under 200 words unless told otherwise."],
    analysis: ["- Give both sides before recommending one.", "- Flag where evidence is weak."],
    writing: ["- Match the requested voice and length.", "- Avoid cliches and padding."],
    explanation: ["- Start from first principles.", "- Use one concrete example."],
    general: [],
  };
  return extras[taskType];
}

function outputFormat(taskType) {
  const formats = {
    code: "A short diagnosis, then the code block, then a brief walkthrough.",
    email: "Subject line, then the body, ready to send.",
    analysis: "Bullet points per option, then a one-line recommendation.",
    writing: "The finished piece only, no preamble.",
    explanation: "Plain language, short paragraphs, one example.",
    general: "Direct answer first, then supporting detail.",
  };
  return formats[taskType];
}

/* ---------------- serving the frontend files ---------------- */

function serveStaticFile(pathname, res) {
  // "/" means the homepage, which is index.html.
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);

  // Security: never let a URL escape this folder via "../".
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);

  fs.readFile(filePath, (error, content) => {
    if (error) {
      // 404: the classic "we could not find what you asked for".
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }

    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

/* ---------------- small helpers ---------------- */

// An HTTP body arrives in pieces ("chunks"), so we collect them all
// before parsing. This is why the function has to wait.
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

// Every JSON reply goes out through here: status code, header, body.
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
});
