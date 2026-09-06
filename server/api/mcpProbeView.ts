/**
 * The HTML served as the `ui://` resource for the MCP Apps probe (AGENT-27).
 *
 * A throwaway. It exists to answer four host-behaviour questions that the Artifacts sandbox
 * could not, and it should be deleted with the rest of the probe once they are answered:
 *
 * 1. **Does the MCP Apps CSP allow a `blob:` AudioWorklet module?** The spec's default is
 *    `script-src 'self' 'unsafe-inline'`, which does NOT include `blob:` - and worklet modules are
 *    governed by `script-src`. That would block the exact route that passed in Artifacts, and it
 *    fails invisibly: stock nodes keep working while every custom device dies.
 * 2. **Does `_meta.ui.csp.resourceDomains` rescue it?** If a cross-origin `addModule()` from a
 *    declared domain works, the worklets can simply be served from the app's own origin.
 * 3. **Does `connectDomains` reopen samples?** Nothing outbound worked in Artifacts, which is why
 *    samples were ruled out. That conclusion came from a sandbox with no way to declare domains.
 * 4. **Is the origin stable across invocations?** Storage persisting across a reload is not the
 *    same as being found again on the next tool call.
 *
 * Plus the one that decides whether "agent ears" is possible at all: whether
 * `ui/update-model-context` actually resolves, which is how a rendered analysis would get back to
 * the model.
 *
 * Written as a plain string with no build step because it is served verbatim as resource content.
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
  p.lede { margin: 0 0 14px; color: var(--muted); font-size: 12.5px; }
  h2 {
    font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--faint);
    margin: 18px 0 7px; font-weight: 600;
  }
  .env { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px; }
  .env div { background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 6px 8px; }
  .env dt { font-size: 10px; color: var(--faint); }
  .env dd {
    margin: 2px 0 0; font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; word-break: break-all;
  }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 8px 10px; }
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
    background: var(--surface2); border-radius: 4px; padding: 5px 7px; white-space: pre-wrap;
    word-break: break-word;
  }
  button {
    font: inherit; font-size: 12.5px; padding: 6px 11px; border-radius: 5px; margin-top: 12px;
    border: 1px solid var(--accent); background: var(--accent); color: var(--bg); cursor: pointer;
  }
</style>
</head>
<body>
  <h1>MCP Apps sandbox probe</h1>
  <p class="lede">web-daw &middot; AGENT-27. Answers what the Artifacts sandbox could not: this host's real CSP, and whether anything survives between invocations.</p>

  <h2>Environment</h2>
  <dl class="env" id="env"></dl>

  <h2>Probes</h2>
  <ol id="probes"></ol>

  <button id="again">Run again</button>

<script>
const SERVER_ORIGIN = ${JSON.stringify(origin)};
const WORKLET_URL = SERVER_ORIGIN + "/mcp-probe/worklet.js";
const BLOB_SOURCE = ${JSON.stringify(PROBE_WORKLET_SOURCE.replace("crush-probe", "crush-blob"))};

// ---- the postMessage JSON-RPC transport the spec defines for a view ----
let nextId = 1;
const pending = new Map();
const hostFacts = { initialized: false, capabilities: null, error: null };

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.jsonrpc !== "2.0" || message.id === undefined) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message || "host error"));
  else entry.resolve(message.result);
});

function callHost(method, params, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("no response in " + timeoutMs + "ms"));
      }
    }, timeoutMs);
  });
}

function notifyHost(method, params) {
  window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
}

async function handshake() {
  try {
    const result = await callHost("ui/initialize", {
      appInfo: { name: "webdaw-sandbox-probe", version: "1.0.0" },
      appCapabilities: {},
    });
    hostFacts.initialized = true;
    hostFacts.capabilities = result && result.hostCapabilities ? result.hostCapabilities : {};
    notifyHost("ui/notifications/initialized", {});
  } catch (error) {
    hostFacts.error = error.message;
  }
}

// ---- probes ----
const PROBES = [
  {
    name: "ui/initialize handshake",
    why: "Everything else the spec offers rides on this. If it never answers, the view is an isolated page, not an MCP App.",
    run: async () => {
      if (hostFacts.error) throw new Error(hostFacts.error);
      if (!hostFacts.initialized) throw new Error("no result");
      return "host capabilities: " + JSON.stringify(hostFacts.capabilities);
    },
  },
  {
    name: "addModule() from a blob: URL",
    why: "Passed in the Artifacts sandbox, but the MCP Apps DEFAULT CSP is script-src 'self' 'unsafe-inline' - no blob:. Worklets are governed by script-src, so this is expected to fail here. A pass means the host is more permissive than the spec's default.",
    run: async () => {
      const context = new OfflineAudioContext(1, 128, 44100);
      const url = URL.createObjectURL(new Blob([BLOB_SOURCE], { type: "text/javascript" }));
      try {
        await context.audioWorklet.addModule(url);
        return "loaded (host is more permissive than the spec default)";
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  },
  {
    name: "addModule() cross-origin from a declared resourceDomain",
    why: "The workaround, and the one that decides the architecture. The resource declares this server in _meta.ui.csp.resourceDomains. If this works, worklets ship from our own origin and blob: does not matter.",
    run: async () => {
      const context = new OfflineAudioContext(1, 128, 44100);
      await context.audioWorklet.addModule(WORKLET_URL);
      return "loaded from " + WORKLET_URL;
    },
  },
  {
    name: "Custom DSP actually renders",
    why: "addModule() resolving proves loading, not running. A 3-bit crusher quantises to k/7, so exactly 15 distinct levels is proof the processor executed.",
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
    why: "Nothing outbound worked in Artifacts, which is why samples were ruled out. That sandbox had no way to declare domains. This one does, so the samples question is genuinely reopened.",
    run: async () => {
      const response = await fetch(SERVER_ORIGIN + "/mcp-probe/ping", { mode: "cors" });
      return "status " + response.status + ", body " + (await response.text()).slice(0, 40);
    },
  },
  {
    name: "Origin is stable across invocations",
    why: "The one that decides whether project state can live here. Storage surviving a reload is not the same as being found on the NEXT tool call. Run the tool a second time: this should report a match.",
    run: async () => {
      const key = "__mcp_probe_origin__";
      const previous = localStorage.getItem(key);
      localStorage.setItem(key, location.origin);
      if (!previous) throw Object.assign(new Error("first invocation. Call the tool again to complete this."), { name: "SECOND RUN NEEDED" });
      if (previous !== location.origin) throw new Error("origin CHANGED: was " + previous + ", now " + location.origin);
      return "same origin as last invocation (" + location.origin + ")";
    },
  },
  {
    name: "ui/update-model-context reaches the model",
    why: "How a rendered analysis would get back for the model to reason about. Without it there are no agent ears, only a picture.",
    run: async () => {
      await callHost("ui/update-model-context", {
        content: [{ type: "text", text: "web-daw sandbox probe: DSP and storage results were collected in the view." }],
      });
      return "accepted by the host";
    },
  },
  {
    name: "IndexedDB opens",
    why: "The storage the widget would actually use: OPFS failed on iOS, and BundleStore already has a backend seam for this.",
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

async function runAll() {
  const list = document.getElementById("probes");
  list.innerHTML = PROBES.map(
    (probe, index) =>
      '<li><div class="head"><span class="name">' +
      escapeHtml(probe.name) +
      '</span><span class="chip run" id="chip' + index + '">running</span></div><p class="why">' +
      escapeHtml(probe.why) +
      '</p><p class="detail" id="detail' + index + '">…</p></li>',
  ).join("");

  for (let index = 0; index < PROBES.length; index++) {
    const chip = document.getElementById("chip" + index);
    const detail = document.getElementById("detail" + index);
    try {
      detail.textContent = await PROBES[index].run();
      chip.className = "chip pass";
      chip.textContent = "pass";
    } catch (error) {
      const pending = error && error.name === "SECOND RUN NEEDED";
      chip.className = pending ? "chip warn" : "chip fail";
      chip.textContent = pending ? "run again" : "fail";
      detail.textContent = (error && error.name ? error.name + ": " : "") + (error && error.message ? error.message : String(error));
    }
    notifyHost("ui/notifications/size-changed", {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    });
  }
}

document.getElementById("again").addEventListener("click", runAll);

renderEnvironment();
handshake().then(runAll);
</script>
</body>
</html>`;
