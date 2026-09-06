/* ---------------------------------------------------------------
   The brain. Phase 1 built the pipes; this is what now runs inside
   them. Everything here is backend-only and never reaches a browser,
   which is exactly why the API key can safely live in this file's
   reach and not in app.js.

   Two paths, always:
     - a real Claude call when ANTHROPIC_API_KEY is set
     - the Phase 1 keyword rules when it is not, or when the call fails

   The app therefore never hard-fails just because the network,
   the key, or the API is having a bad day.
   --------------------------------------------------------------- */

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-opus-5";
const FALLBACK_MODEL = "claude-opus-4-8";

// Built once and reused. Constructing a client per request wastes the
// connection pool. With no argument it reads ANTHROPIC_API_KEY itself.
let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `You rewrite a user's rough, half-formed context into one high-quality prompt they can paste into any AI assistant.

Rules:
- Output ONLY the finished prompt. No preamble, no explanation, no surrounding quotes, no markdown fences.
- Write it addressed to the assistant that will receive it, not to the user.
- Open by assigning a specific role suited to the task.
- State the task concretely, preserving every real detail the user gave. Never invent facts they did not provide.
- Where the user's context is genuinely ambiguous, instruct the assistant to ask before assuming, rather than guessing yourself.
- Add a short requirements section and a short output-format section.
- Keep the whole thing tight. A prompt nobody reads is a prompt that does not work.`;

async function improve(context) {
  const taskType = detectTaskType(context);

  if (!hasApiKey()) {
    return withRules(context, taskType, "No ANTHROPIC_API_KEY set, so the local rules wrote this.");
  }

  try {
    /* The beta namespace is required for refusal fallbacks. If Opus 5
       declines the request on policy grounds, the API reruns it against
       the fallback model inside this same call, so we do not have to
       orchestrate a second request ourselves. */
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      // Effort is the quality/latency dial. Raise to "high" if the
      // prompts come back thin; drop to "low" to make it snappier.
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: context }],
    });

    // A refusal is an HTTP 200, not a thrown error. Check it before
    // touching content, or you read an empty array and show blank output.
    if (response.stop_reason === "refusal") {
      return withRules(context, taskType, "The model declined this one, so the local rules wrote it instead.");
    }

    // content is a list of blocks of differing types. Keep the text ones.
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      return withRules(context, taskType, "The model returned nothing usable, so the local rules wrote it.");
    }

    return {
      prompt: text,
      taskType: taskType,
      mode: "model",
      model: response.model,
      note: null,
    };
  } catch (error) {
    // Never let a bad API moment take the whole feature down.
    return withRules(context, taskType, describeError(error));
  }
}

// Most specific error class first, least specific last.
function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return "The API key was rejected, so the local rules wrote this. Check ANTHROPIC_API_KEY.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited, so the local rules wrote this. Try again shortly.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The API refused the request shape, so the local rules wrote this. ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the API, so the local rules wrote this. Check the network.";
  }
  if (error instanceof Anthropic.APIError) {
    return `API error ${error.status}, so the local rules wrote this.`;
  }
  return "Something went wrong calling the model, so the local rules wrote this.";
}

function withRules(context, taskType, note) {
  return {
    prompt: buildPromptFromRules(context, taskType),
    taskType: taskType,
    mode: "rules",
    model: null,
    note: note,
  };
}

/* ---------------- the Phase 1 rules, still here as the safety net ---------------- */

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

function buildPromptFromRules(context, taskType) {
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

module.exports = { improve, hasApiKey, MODEL };
