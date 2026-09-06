/* ---------------------------------------------------------------
   FRONTEND JavaScript. This runs inside the user's browser, on the
   CLIENT. It can see the page and react to clicks, but it cannot
   see the server's files or secrets.

   Its job here is exactly three things:
     1. read what the user typed
     2. send it to the backend as an HTTP request
     3. put the response on screen
   --------------------------------------------------------------- */

// Grab references to elements defined in index.html, by their id.
const contextEl = document.getElementById("context");
const buttonEl = document.getElementById("improve-btn");
const statusEl = document.getElementById("status");
const resultPanelEl = document.getElementById("result-panel");
const resultEl = document.getElementById("result");
const metaEl = document.getElementById("meta");
const copyEl = document.getElementById("copy-btn");

// An "event listener": run this function whenever the button is clicked.
buttonEl.addEventListener("click", improvePrompt);

// Convenience: Cmd/Ctrl + Enter submits too.
contextEl.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") improvePrompt();
});

async function improvePrompt() {
  const context = contextEl.value.trim();

  // Cheap validation on the client so we do not waste a round trip.
  if (!context) {
    setStatus("Type some context first.", true);
    contextEl.focus();
    return;
  }

  setLoading(true);
  setStatus("Sending to the server...");

  try {
    /* THE REQUEST.
       fetch() is the browser's built-in way to make an HTTP request.
         - "/api/improve" is the ENDPOINT we are calling
         - method POST means "here is data, do something with it"
         - the Content-Type header tells the server the body is JSON
         - JSON.stringify turns a JavaScript object into a JSON string,
           because HTTP bodies travel as text, not as live objects    */
    const response = await fetch("/api/improve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: context }),
    });

    /* THE RESPONSE.
       response.ok is true for status codes 200-299.
       response.json() parses the JSON text back into a real object. */
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Server returned ${response.status}`);
    }

    render(data);
    setStatus(`Done. Server said ${response.status}.`);
  } catch (error) {
    // Runs if the server is unreachable, or if we threw above.
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
}

// Put the server's data into the page. This is the frontend's job,
// never the backend's: the backend only ever sends data back.
function render(data) {
  resultEl.textContent = data.prompt;
  metaEl.textContent =
    `Detected task: ${data.taskType} · ` +
    `${data.stats.inputWords} words in, ${data.stats.outputWords} words out · ` +
    `generated ${new Date(data.generatedAt).toLocaleTimeString()}`;
  resultPanelEl.hidden = false;
}

function setLoading(isLoading) {
  buttonEl.disabled = isLoading;
  buttonEl.textContent = isLoading ? "Working..." : "Improve my prompt";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

copyEl.addEventListener("click", async () => {
  await navigator.clipboard.writeText(resultEl.textContent);
  copyEl.textContent = "Copied";
  setTimeout(() => (copyEl.textContent = "Copy"), 1200);
});
