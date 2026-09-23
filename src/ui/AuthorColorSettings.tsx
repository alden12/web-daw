/**
 * The accent colours of everyone whose edits this project carries: you, the agent voice, and any
 * collaborator seen in the feed - so you can give each a distinct hue rather than the auto-assigned
 * one. Picking applies live: it writes the author-colour store, which repaints every
 * author-coloured surface (feed, tracks, notes, knobs) and the `--color-*` CSS vars immediately.
 * Colours live only in this browser.
 *
 * Your own row is first and is an ordinary row, which took some getting to. It used to be a section
 * of its own above this list, and before that it lived in a separate account modal when auth was on
 * and here when it was off. They are all the same question - which colour is this person - so they
 * are one list. Rendered inside the Account tab, under whatever names you (`AccountSettings`).
 */
import { useMemo, useSyncExternalStore } from "react";
import type { EditLog } from "../audio/commands/editLog";
import { useEditLog } from "../audio/commands/useEditLog";
import { readCurrentUser, subscribeCurrentUser } from "./currentUser";
import { writeAuthorColors, colorForAuthor, SWATCHES, type AuthorColorConfig } from "./authorColors";
import { authorLabel } from "./authorStyle";
import { voiceLabel, type Voice } from "./authorVoice";
import { isAgentAuthor } from "../audio/commands/authors";

// One agent row, not one per model or per driver: an AI edit is the agent's whoever drove it and
// whatever model is behind it, and every agent shares this colour (the feed label names the driver).
const VOICES: { voice: Voice; hint: string }[] = [{ voice: "agent", hint: "the in-app agent and MCP" }];

export function AuthorColorSettings({ config, editLog }: { config: AuthorColorConfig; editLog: EditLog }) {
  const pick = (author: string, hex: string) => writeAuthorColors({ ...config, [author]: hex });
  const currentUser = useSyncExternalStore(subscribeCurrentUser, readCurrentUser, readCurrentUser);
  const { entries } = useEditLog(editLog);

  // Collaborators = distinct human authors seen in the feed, minus the reserved voices and yourself
  // (both already have their own rows). These are the peers whose colour you may want to override.
  const collaborators = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!isAgentAuthor(entry.author) && entry.author !== currentUser) seen.add(entry.author);
    }
    return [...seen];
  }, [entries, currentUser]);

  return (
    <div className="flex flex-col gap-4">
      <SwatchRow
        author={currentUser}
        label={authorLabel(currentUser, currentUser)}
        hint="your edits"
        config={config}
        self={currentUser}
        onPick={pick}
      />
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
              label={authorLabel(author, currentUser)}
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
                selected ? "border-strong" : "border-transparent hover:border-line"
              }`}
              style={{ background: swatch.hex }}
            />
          );
        })}
      </div>
    </div>
  );
}
