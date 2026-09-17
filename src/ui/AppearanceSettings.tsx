/**
 * Appearance settings: the theme choice. One tab of SettingsPanel.tsx.
 *
 * Three states rather than a two-way switch, because "follow the OS" is a real answer and
 * not the same as picking the theme the OS currently happens to be on: a machine that
 * flips to dark at sunset should take the app with it. The palette itself is CSS
 * (`index.css`); this only writes `data-theme`. See `theme.ts`.
 */
import { THEME_CHOICES, useThemeChoice, type ThemeChoice } from "./theme";

const LABELS: Record<ThemeChoice, string> = { system: "System", dark: "Dark", light: "Light" };
const HINTS: Record<ThemeChoice, string> = {
  system: "Follows the operating system, and changes with it.",
  dark: "Always dark, whatever the system is set to.",
  light: "Always light, whatever the system is set to.",
};

export function AppearanceSettings() {
  const [choice, setChoice] = useThemeChoice();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Theme</span>
        <div className="inline-flex self-start rounded-md border border-line overflow-hidden" role="radiogroup">
          {THEME_CHOICES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={choice === value}
              onClick={() => setChoice(value)}
              className={`px-3 py-1.5 text-[12px] cursor-pointer border-r border-line last:border-r-0 ${
                choice === value ? "bg-you/20 text-you" : "text-muted hover:text-ink"
              }`}
            >
              {LABELS[value]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint leading-relaxed">{HINTS[choice]}</p>
      </div>

      <p className="text-[11px] text-faint leading-relaxed">
        Editor colours (teal for you, violet for the agent, coral for Claude) keep their hue in both themes: they say
        who made an edit, so they stay recognisable rather than changing identity with the background. In light mode
        they are darkened to stay readable on white, which is the same colour wearing a different amount of light.
        Change them under Authors.
      </p>
    </div>
  );
}
