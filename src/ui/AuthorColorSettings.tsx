/**
 * Authors settings section: pick the accent colour for each voice (you / agent / claude) from a
 * fixed swatch palette. Picking applies live - it writes the author-colour store, which repaints
 * every author-coloured surface (the `--color-*` CSS vars are synced from it) and the last-editor
 * tint immediately. Colours live only in this browser. One tab of SettingsPanel.tsx; the store is
 * a generic author -> hex map, so this readily extends to per-person colours for multi-user later.
 */
import { writeAuthorColors, colorForAuthor, SWATCHES, type AuthorColorConfig } from "./authorColors";
import { voiceLabel, type Voice } from "./authorVoice";

const VOICES: { voice: Voice; hint: string }[] = [
  { voice: "you", hint: "your edits" },
  { voice: "agent", hint: "the in-app agent" },
  { voice: "claude", hint: "Claude over MCP" },
];

export function AuthorColorSettings({ config }: { config: AuthorColorConfig }) {
  const pick = (voice: Voice, hex: string) => writeAuthorColors({ ...config, [voice]: hex });

  return (
    <div className="flex flex-col gap-4">
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
