/**
 * The `ui://` resource for the MCP Apps probe (AGENT-27), and the script it loads.
 *
 * **Restructured as a bisect after the first render came back as a large empty box.** Not a blank
 * page with broken diagnostics - genuinely empty, including the static heading that needs no
 * JavaScript at all. That rules out everything the previous version was designed to measure and
 * points at a layer underneath it, so the page now reports on itself from the outside in:
 *
 * 1. **Static markup renders** - proves the HTML arrived and is being treated as HTML. If this
 *    line is missing, nothing below it can be concluded, and the problem is delivery.
 * 2. **An inline script runs** - the spec's default CSP is `script-src 'self' 'unsafe-inline'`,
 *    but a host may be stricter. Inline being blocked would produce exactly the empty box seen,
 *    and would mean every view has to ship its logic externally.
 * 3. **An external script from a declared `resourceDomain` runs** - the workaround if inline is
 *    blocked, and a strong signal for the cross-origin AudioWorklet question, since both are
 *    governed by `script-src`.
 *
 * Each stage announces itself in the markup, so a partial failure is legible instead of blank.
 * Only once stage 3 runs do the real probes happen, and they live in the external file so that
 * they exist to be run at all under a strict policy.
 *
 * Delete all of this once AGENT-27 has its answers.
 */

/** A real processor: it bit-crushes, so a silent or unquantised buffer proves it never ran. */
export const PROBE_WORKLET_SOURCE = `
class CrushProbeProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const levels = 7; // 3-bit: quantises to k/7, so exactly 15 distinct values
    for (let channel = 0; channel < output.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      for (let i = 0; i < outputChannel.length; i++) {
        outputChannel[i] = Math.round((inputChannel ? inputChannel[i] : 0) * levels) / levels;
      }
    }
    return true;
  }
}
registerProcessor("crush-probe", CrushProbeProcessor);
`;

/**
 * The probe logic, served as a separate file from the declared `resourceDomain` rather than
 * inlined. If a strict `script-src` is what produced the empty box, this is the only form in which
 * any of it can run.
 */
export const probeScriptSource = (origin: string): string => `
const SERVER_ORIGIN = ${JSON.stringify(origin)};
const WORKLET_URL = SERVER_ORIGIN + "/mcp-probe/worklet.js";
const BLOB_SOURCE = ${JSON.stringify(PROBE_WORKLET_SOURCE.replace("crush-probe", "crush-blob"))};

const mark = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
mark("stage-external", "3. external script from a declared resourceDomain: RAN");

// ---- the postMessage JSON-RPC transport the spec defines for a view ----
let nextId = 1;
const pending = new Map();
const hostFacts = { initialized: false, capabilities: null, error: null };
const findings = [];

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.jsonrpc !== "2.0" || message.id === undefined) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message || "host error"));
  else entry.resolve(message.result);
});

function callHost(method, params, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error("no response in " + timeoutMs + "ms")); }
    }, timeoutMs);
  });
}

const notifyHost = (method, params) => window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");

async function handshake() {
  try {
    const result = await callHost("ui/initialize", {
      appInfo: { name: "webdaw-sandbox-probe", version: "1.0.0" },
      appCapabilities: {},
    });
    hostFacts.initialized = true;
    hostFacts.capabilities = (result && result.hostCapabilities) || {};
    notifyHost("ui/notifications/initialized", {});
  } catch (error) {
    hostFacts.error = error.message;
  }
}

const PROBES = [
  {
    name: "ui/initialize handshake",
    why: "Everything the spec offers rides on this. No answer means the view is an isolated page, not an MCP App.",
    run: async () => {
      if (hostFacts.error) throw new Error(hostFacts.error);
      if (!hostFacts.initialized) throw new Error("no result");
      return "host capabilities: " + JSON.stringify(hostFacts.capabilities);
    },
  },
  {
    name: "addModule() from a blob: URL",
    why: "Passed in the Artifacts sandbox. The MCP Apps default CSP has no blob:, and worklets are governed by script-src, so a failure here is expected and a pass means this host is more permissive than the spec default.",
    run: async () => {
      const context = new OfflineAudioContext(1, 128, 44100);
      const url = URL.createObjectURL(new Blob([BLOB_SOURCE], { type: "text/javascript" }));
      try {
        await context.audioWorklet.addModule(url);
        return "loaded (host is more permissive than the spec default)";
      } finally { URL.revokeObjectURL(url); }
    },
  },
  {
    name: "addModule() cross-origin from a declared resourceDomain",
    why: "The workaround, and the one that decides the architecture. If this works, worklets ship from our own origin and blob: does not matter.",
    run: async () => {
      const context = new OfflineAudioContext(1, 128, 44100);
      await context.audioWorklet.addModule(WORKLET_URL);
      return "loaded from " + WORKLET_URL;
    },
  },
  {
    name: "Custom DSP actually renders",
    why: "addModule() resolving proves loading, not running. A 3-bit crusher quantises to k/7, so exactly 15 distinct levels proves the processor executed.",
    run: async () => {
      const sampleRate = 44100;
      const context = new OfflineAudioContext(1, sampleRate / 4, sampleRate);
      await context.audioWorklet.addModule(WORKLET_URL);
      const oscillator = new OscillatorNode(context, { frequency: 220, type: "sine" });
      oscillator.connect(new AudioWorkletNode(context, "crush-probe")).connect(context.destination);
      oscillator.start();
      const samples = (await context.startRendering()).getChannelData(0);
      let peak = 0;
      const distinct = new Set();
      for (let i = 0; i < samples.length; i++) {
        peak = Math.max(peak, Math.abs(samples[i]));
        distinct.add(samples[i].toFixed(4));
      }
      if (peak < 0.01) throw new Error("silent: the processor never ran");
      if (distinct.size > 64) throw new Error(distinct.size + " distinct levels: the crusher was bypassed");
      return "peak " + peak.toFixed(3) + ", " + distinct.size + " distinct levels";
    },
  },
  {
    name: "fetch() to a declared connectDomain",
    why: "Nothing outbound worked in Artifacts, which is why samples were ruled out. That sandbox had no way to declare domains; this one does, so the question is genuinely reopened.",
    run: async () => {
      const response = await fetch(SERVER_ORIGIN + "/mcp-probe/ping", { mode: "cors" });
      return "status " + response.status + ", body " + (await response.text()).slice(0, 40);
    },
  },
  {
    name: "Origin is stable across invocations",
    why: "Decides whether project state can live here. Surviving a reload is not the same as being found on the NEXT tool call. Run the tool twice.",
    run: async () => {
      const key = "__mcp_probe_origin__";
      const previous = localStorage.getItem(key);
      localStorage.setItem(key, location.origin);
      if (!previous) throw Object.assign(new Error("first invocation; call the tool again"), { name: "SECOND RUN NEEDED" });
      if (previous !== location.origin) throw new Error("origin CHANGED: was " + previous + ", now " + location.origin);
      return "same origin as last invocation (" + location.origin + ")";
    },
  },
  {
    name: "IndexedDB opens",
    why: "The storage a widget would actually use: OPFS failed on iOS, and BundleStore already has a backend seam for it.",
    run: async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("__mcp_probe__", 1);
        request.onerror = () => reject(request.error || new Error("open failed"));
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => request.result.createObjectStore("kv");
      });
      database.close();
      return "opened cleanly";
    },
  },
];

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function summarise() {
  return (
    "host: " + navigator.userAgent + "\\norigin: " + location.origin + "\\n\\n" +
    findings.map((f) => (f.ok ? "PASS  " : "FAIL  ") + f.name + " -- " + f.detail).join("\\n")
  );
}

async function runAll() {
  findings.length = 0;
  document.getElementById("probes").innerHTML = PROBES.map(
    (probe, index) =>
      '<li><div class="head"><span class="name">' + escapeHtml(probe.name) +
      '</span><span class="chip run" id="chip' + index + '">running</span></div>' +
      '<p class="why">' + escapeHtml(probe.why) + '</p>' +
      '<p class="detail" id="detail' + index + '">...</p></li>',
  ).join("");

  for (let index = 0; index < PROBES.length; index++) {
    const chip = document.getElementById("chip" + index);
    const detail = document.getElementById("detail" + index);
    try {
      detail.textContent = await PROBES[index].run();
      chip.className = "chip pass";
      chip.textContent = "pass";
      findings.push({ name: PROBES[index].name, ok: true, detail: detail.textContent });
    } catch (error) {
      const second = error && error.name === "SECOND RUN NEEDED";
      chip.className = second ? "chip warn" : "chip fail";
      chip.textContent = second ? "run again" : "fail";
      detail.textContent = (error && error.name ? error.name + ": " : "") + ((error && error.message) || String(error));
      findings.push({ name: PROBES[index].name, ok: false, detail: detail.textContent });
    }
    notifyHost("ui/notifications/size-changed", {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    });
  }
}

/** Report by calling a tool: the model sees tool results, not rendered views. */
async function report() {
  const summary = summarise();
  const lines = [];
  try {
    await callHost("tools/call", { name: "report_probe_results", arguments: { summary, results: findings } }, 8000);
    lines.push("tools/call: accepted by the host");
  } catch (error) {
    lines.push("tools/call: FAILED - " + error.message);
  }
  try {
    await callHost("ui/update-model-context", { content: [{ type: "text", text: "web-daw probe findings:\\n" + summary }] });
    lines.push("ui/update-model-context: accepted by the host");
  } catch (error) {
    lines.push("ui/update-model-context: FAILED - " + error.message);
  }
  mark("report", lines.join("\\n"));
}

function renderEnvironment() {
  const facts = [
    ["origin", location.origin === "null" ? "null (opaque)" : location.origin],
    ["isSecureContext", String(window.isSecureContext)],
    ["in an iframe", String(window.self !== window.top)],
    ["userAgent", navigator.userAgent],
  ];
  document.getElementById("env").innerHTML = facts
    .map(([term, value]) => "<div><dt>" + term + "</dt><dd>" + escapeHtml(value) + "</dd></div>")
    .join("");
}

document.getElementById("again").addEventListener("click", () => runAll().then(report));
renderEnvironment();
handshake().then(runAll).then(report);
`;

/** The view. `origin` is the server's own public origin, declared in the resource's CSP metadata. */
export const probeViewHtml = (origin: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP Apps sandbox probe</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #eef2f3; --surface: #fff; --surface2: #f6f9fa; --ink: #0f1619; --muted: #566a72;
    --faint: #82969e; --line: #d8e2e5; --accent: #0e7c86;
    --pass: #1c7f4b; --passbg: #d8f0e2; --fail: #b3382c; --failbg: #fadedb;
    --warn: #96660f; --warnbg: #fbeccd;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #090d0f; --surface: #121a1d; --surface2: #172023; --ink: #e7eef1; --muted: #93a7af;
      --faint: #6b7f87; --line: #232f34; --accent: #35c9d6;
      --pass: #4fd68b; --passbg: #10301f; --fail: #ff7b6e; --failbg: #351714;
      --warn: #f2bd48; --warnbg: #33270c;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; padding: 14px;
  }
  h1 { font-size: 15px; margin: 0 0 2px; }
  p.lede { margin: 0 0 12px; color: var(--muted); font-size: 12.5px; }
  h2 {
    font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--faint);
    margin: 16px 0 7px; font-weight: 600;
  }
  .stages { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .stages li {
    font-family: ui-monospace, Menlo, monospace; font-size: 11.5px;
    background: var(--surface2); border-radius: 4px; padding: 5px 8px;
  }
  .env { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px; }
  .env div { background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 6px 8px; }
  .env dt { font-size: 10px; color: var(--faint); }
  .env dd { margin: 2px 0 0; font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; word-break: break-all; }
  ol#probes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  ol#probes li { background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 8px 10px; }
  .head { display: flex; gap: 8px; align-items: center; }
  .name { font-weight: 600; font-size: 12.5px; }
  .chip {
    margin-left: auto; font-size: 9.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
    padding: 2px 7px; border-radius: 99px; white-space: nowrap;
  }
  .pass { color: var(--pass); background: var(--passbg); }
  .fail { color: var(--fail); background: var(--failbg); }
  .warn { color: var(--warn); background: var(--warnbg); }
  .run  { color: var(--faint); background: var(--surface2); }
  .why { margin: 4px 0 0; color: var(--muted); font-size: 11.5px; }
  .detail {
    margin: 5px 0 0; font-family: ui-monospace, Menlo, monospace; font-size: 11px;
    background: var(--surface2); border-radius: 4px; padding: 5px 7px; white-space: pre-wrap; word-break: break-word;
  }
  button {
    font: inherit; font-size: 12.5px; padding: 6px 11px; border-radius: 5px; margin-top: 12px;
    border: 1px solid var(--accent); background: var(--accent); color: var(--bg); cursor: pointer;
  }
</style>
</head>
<body>
  <h1>MCP Apps sandbox probe</h1>
  <p class="lede">web-daw &middot; AGENT-27. Read the three stages first: whichever is the last to say RAN is the layer this host stops at.</p>

  <h2>Stages</h2>
  <ul class="stages">
    <li id="stage-static">1. static HTML: RENDERED (you can read this line, so the resource arrived and is treated as HTML)</li>
    <li id="stage-inline">2. inline script: DID NOT RUN (if this never changes, the host's script-src forbids inline)</li>
    <li id="stage-external">3. external script from a declared resourceDomain: DID NOT RUN</li>
  </ul>

  <h2>Environment</h2>
  <dl class="env" id="env"></dl>

  <h2>Probes</h2>
  <ol id="probes"></ol>

  <h2>Reporting back</h2>
  <p class="detail" id="report">not attempted yet</p>

  <button id="again">Run again</button>

  <script>
    document.getElementById("stage-inline").textContent = "2. inline script: RAN";
  </script>
  <script src="${origin}/mcp-probe/view.js"></script>
</body>
</html>`;
