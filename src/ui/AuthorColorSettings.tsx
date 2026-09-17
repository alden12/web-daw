/**
 * Authors settings section: set your identity and pick accent colours. Picking applies live - it writes
 * the author-colour store, which repaints every author-coloured surface (feed, tracks, notes, knobs) and
 * the `--color-*` CSS vars immediately. Colours live only in this browser. Rows: your identity + colour,
 * the two AI voices (agent / Claude), and any collaborators seen in this project's feed - so you can give
 * each person a distinct colour rather than the auto-assigned hue. One tab of SettingsPanel.tsx.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import type { EditLog } from "../audio/commands/editLog";
import { useEditLog } from "../audio/commands/useEditLog";
import { writeAuthorColors, colorForAuthor, SWATCHES, type AuthorColorConfig } from "./authorColors";
import { readCurrentUser, writeCurrentUser, subscribeCurrentUser, DEFAULT_USER } from "./currentUser";
import { authorLabel } from "./authorStyle";
import { voiceLabel, type Voice } from "./authorVoice";

const VOICES: { voice: Voice; hint: string }[] = [
  { voice: "agent", hint: "the in-app agent" },
  { voice: "claude", hint: "Claude over MCP" },
];

const RESERVED = new Set<string>(["agent", "claude"]);

export function AuthorColorSettings({ config, editLog }: { config: AuthorColorConfig; editLog: EditLog }) {
  const pick = (author: string, hex: string) => writeAuthorColors({ ...config, [author]: hex });
  const currentUser = useSyncExternalStore(subscribeCurrentUser, readCurrentUser, readCurrentUser);
  const { entries } = useEditLog(editLog);

  // Collaborators = distinct human authors seen in the feed, minus the reserved voices and yourself
  // (both already have their own rows). These are the peers whose colour you may want to override.
  const collaborators = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!RESERVED.has(entry.author) && entry.author !== currentUser) seen.add(entry.author);
    }
    return [...seen];
  }, [entries, currentUser]);

  return (
    <div className="flex flex-col gap-4">
      <IdentityField currentUser={currentUser} config={config} onPick={pick} />
      {VOICES.map(({ voice, hint }) => (
        <SwatchRow
          key={voice}
          author={voice}
          label={voiceLabel(voice)}
          hint={hint}
          config={config}
          self={currentUser}
          onPick={pick}
        />
      ))}
      {collaborators.length > 0 && (
        <div className="flex flex-col gap-3 pt-2 border-t border-line">
          <span className="text-[11px] uppercase tracking-wide text-faint">Collaborators</span>
          {collaborators.map((author) => (
            <SwatchRow
              key={author}
              author={author}
              label={authorLabel(author)}
              config={config}
              self={currentUser}
              onPick={pick}
            />
          ))}
        </div>
      )}
      <p className="text-[11px] text-faint leading-relaxed">
        Colours mark who last edited each track, note, and control, and run through the activity feed and version
        history. They are saved only in this browser.
      </p>
    </div>
  );
}

/** One author's colour picker: a label + the swatch palette, the current pick ringed. */
function SwatchRow({
  author,
  label,
  hint,
  config,
  self,
  onPick,
}: {
  author: string;
  label: string;
  hint?: string;
  config: AuthorColorConfig;
  self: string;
  onPick: (author: string, hex: string) => void;
}) {
  const current = colorForAuthor(author, config, self);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: current }} />
        <span className="text-[12.5px] text-ink">{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${label} colour`}>
        {SWATCHES.map((swatch) => {
          const selected = current.toLowerCase() === swatch.hex.toLowerCase();
          return (
            <button
              key={swatch.id}
              type="button"
              onClick={() => onPick(author, swatch.hex)}
              aria-label={`${label}: ${swatch.name}`}
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
  const current = colorForAuthor(currentUser, config, currentUser);

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
