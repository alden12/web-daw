/**
 * Authors settings section: pick the accent colour for each voice (you / agent / claude) from a
 * fixed swatch palette. Picking applies live - it writes the author-colour store, which repaints
 * every author-coloured surface (the `--color-*` CSS vars are synced from it) and the last-editor
 * tint immediately. Colours live only in this browser. One tab of SettingsPanel.tsx; the store is
 * a generic author -> hex map, so this readily extends to per-person colours for multi-user later.
 */
import { useState, useSyncExternalStore } from "react";
import { writeAuthorColors, colorForAuthor, SWATCHES, type AuthorColorConfig } from "./authorColors";
import { readCurrentUser, writeCurrentUser, subscribeCurrentUser, DEFAULT_USER } from "./currentUser";
import { voiceLabel, type Voice } from "./authorVoice";

const VOICES: { voice: Voice; hint: string }[] = [
  { voice: "you", hint: "your edits" },
  { voice: "agent", hint: "the in-app agent" },
  { voice: "claude", hint: "Claude over MCP" },
];

export function AuthorColorSettings({ config }: { config: AuthorColorConfig }) {
  const pick = (author: string, hex: string) => writeAuthorColors({ ...config, [author]: hex });
  const currentUser = useSyncExternalStore(subscribeCurrentUser, readCurrentUser, readCurrentUser);

  return (
    <div className="flex flex-col gap-4">
      <IdentityField currentUser={currentUser} config={config} onPick={pick} />
      {VOICES.map(({ voice, hint }) => {
        const current = colorForAuthor(voice, config);
        return (
          <div key={voice} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: current }} />
              <span className="text-[12.5px] text-ink">{voiceLabel(voice)}</span>
              <span className="text-[11px] text-faint">{hint}</span>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${voiceLabel(voice)} colour`}>
              {SWATCHES.map((swatch) => {
                const selected = current.toLowerCase() === swatch.hex.toLowerCase();
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    onClick={() => pick(voice, swatch.hex)}
                    aria-label={`${voiceLabel(voice)}: ${swatch.name}`}
                    aria-pressed={selected}
                    title={swatch.name}
                    className={`w-6 h-6 rounded-full cursor-pointer border-2 ${
                      selected ? "border-bright" : "border-transparent hover:border-line"
                    }`}
                    style={{ background: swatch.hex }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-faint leading-relaxed">
        Colours mark who last edited each track, note, and control, and run through the activity feed and version
        history. They are saved only in this browser.
      </p>
    </div>
  );
}

/**
 * TEMPORARY (pre-auth): set the identity stamped on your edits, so two people (or two tabs, via
 * `?user=`) editing one project appear as distinct, differently-coloured authors. Removed once real
 * auth supplies the identity. Commits on blur / Enter; empty resets to the default.
 */
function IdentityField({
  currentUser,
  config,
  onPick,
}: {
  currentUser: string;
  config: AuthorColorConfig;
  onPick: (author: string, hex: string) => void;
}) {
  const [draft, setDraft] = useState(currentUser);
  const commit = () => writeCurrentUser(draft);
  const current = colorForAuthor(currentUser, config);

  return (
    <div className="flex flex-col gap-1.5 pb-2 border-b border-line">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: current }} />
        <span className="text-[12.5px] text-ink">You are</span>
        <span className="text-[11px] text-faint">edits are stamped with this name</span>
      </div>
      <input
        type="text"
        value={draft}
        placeholder={DEFAULT_USER}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
        aria-label="Your name"
        className="w-full text-[12.5px] text-ink bg-ground border border-line rounded-md px-2 py-1 focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-1"
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Your colour">
        {SWATCHES.map((swatch) => {
          const selected = current.toLowerCase() === swatch.hex.toLowerCase();
          return (
            <button
              key={swatch.id}
              type="button"
              onClick={() => onPick(currentUser, swatch.hex)}
              aria-label={swatch.name}
              aria-pressed={selected}
              title={swatch.name}
              className={`w-6 h-6 rounded-full cursor-pointer border-2 ${
                selected ? "border-bright" : "border-transparent hover:border-line"
              }`}
              style={{ background: swatch.hex }}
            />
          );
        })}
      </div>
      <p className="text-[11px] text-faint leading-relaxed">
        Temporary: sets who your edits belong to for live collaboration. Also settable with{" "}
        <code className="text-muted">?user=</code> in the URL.
      </p>
    </div>
  );
}
