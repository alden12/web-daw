/**
 * The rebuild benchmark as a page you can open on a phone (DAW-34 stage F).
 *
 * Dev-only, and deliberately not a React view: it runs before the app mounts, renders with plain DOM
 * and inline styles, and needs no console. A phone has no editor and no easy devtools, so a number
 * that only reaches a console is a number you cannot read on the device that matters - the same
 * reasoning as `safeAreaSimulation`, taken one step further because this one has output.
 *
 * Open `?bench=rebuild` on the device. Sizes run smallest first with a yield between, so the biggest
 * one arriving late does not stop you reading the rest.
 */
import { BENCH_SIZES, measureRebuild, type RebuildSample } from "../audio/history/rebuildBench";

/** Whether this page load asked for the benchmark. */
export const wantsRebuildBench = (): boolean => {
  try {
    return new URLSearchParams(location.search).get("bench") === "rebuild";
  } catch {
    return false;
  }
};

const style = (element: HTMLElement, css: Partial<CSSStyleDeclaration>): void => {
  Object.assign(element.style, css);
};

const cell = (text: string, header: boolean): HTMLElement => {
  const element = document.createElement(header ? "th" : "td");
  element.textContent = text;
  style(element, { padding: "6px 10px", textAlign: "right", borderBottom: "1px solid #2a3038" });
  return element;
};

const ms = (value: number): string => (value < 10 ? value.toFixed(2) : Math.round(value).toString());

/**
 * Run the sweep and render it. Returns when every size has been measured.
 *
 * `await null` between sizes hands the frame back so each row paints as it lands. It costs nothing
 * and it is what kept the page readable when the biggest size took twelve seconds (DAW-39); a phone
 * slow enough to bring that back would otherwise just show a blank screen, which reads as a hang.
 */
export async function renderRebuildBench(): Promise<void> {
  document.body.innerHTML = "";
  style(document.body, {
    background: "#0a0c0e",
    color: "#e8e7e3",
    font: "14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
    padding: "16px",
    margin: "0",
  });

  const heading = document.createElement("h1");
  heading.textContent = "Rebuild cost";
  style(heading, { font: "600 18px/1.3 system-ui, sans-serif", margin: "0 0 4px" });

  const note = document.createElement("p");
  note.textContent = `${navigator.userAgent}`;
  style(note, { color: "#8b929c", fontSize: "11px", margin: "0 0 16px", wordBreak: "break-all" });

  const table = document.createElement("table");
  style(table, { borderCollapse: "collapse", width: "100%", fontVariantNumeric: "tabular-nums" });
  const head = document.createElement("tr");
  for (const label of ["edits", "parse", "load", "replay", "total", "keyframe"]) head.append(cell(label, true));
  table.append(head);

  const status = document.createElement("p");
  style(status, { color: "#8b929c", fontSize: "12px", marginTop: "12px" });

  document.body.append(heading, note, table, status);

  const samples: RebuildSample[] = [];
  for (const size of BENCH_SIZES) {
    status.textContent = `measuring ${size.toLocaleString()} edits…`;
    await null; // let the row above paint before the next size blocks the thread
    const sample = measureRebuild(size);
    samples.push(sample);
    const row = document.createElement("tr");
    for (const value of [
      sample.entries.toLocaleString(),
      `${ms(sample.parseMs)}ms`,
      `${ms(sample.loadMs)}ms`,
      `${ms(sample.replayMs)}ms`,
      `${ms(sample.totalMs)}ms`,
      `${Math.round(sample.keyframeBytes / 1024).toLocaleString()}KB`,
    ])
      row.append(cell(value, false));
    table.append(row);
  }

  status.textContent = "done - the replay column is the one that scales with how far back undo reaches";
  // Also on the console, for the case where the device IS tethered and you want to paste the numbers.
  console.table(samples);
}
