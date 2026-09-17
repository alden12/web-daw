/**
 * The account panel: a small modal (opened from the rail avatar) showing who you're signed in as - the
 * avatar, display name, and email - with a Sign out button. This is the single home for sign-out (the
 * Authors settings tab just shows the identity now). Mirrors `SettingsPanel`'s overlay + card idiom.
 */
import { useSyncExternalStore } from "react";
import { readAuthState, signOut, subscribeAuth } from "../auth/session";
import { colorForAuthor, writeAuthorColors, SWATCHES } from "./authorColors";
import { useAuthorPresence } from "./authorColorsContext";
import { initials } from "./initials";

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const state = useSyncExternalStore(subscribeAuth, readAuthState, readAuthState);
  const { config, self } = useAuthorPresence();
  if (state.status !== "signed-in") return null;

  const { name, email } = state.user;
  const color = colorForAuthor(self, config, self);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-panel border border-line rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 id="account-title" className="text-[15px] font-semibold text-bright">
            Account
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account"
            title="Close"
            className="ml-auto text-lg leading-none text-muted hover:text-ink cursor-pointer px-1"
          >
            ×
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold leading-none shrink-0"
            style={{ background: color, color: "var(--color-ground)" }}
          >
            {initials(name || email || "?")}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] text-ink truncate">{name}</div>
            {email && <div className="text-[11px] text-faint truncate">{email}</div>}
          </div>
        </div>

        {/* Your accent colour: marks who edited each track/note/control, runs through the feed + history.
            Picking applies live (repaints every author-coloured surface). Saved only in this browser. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink">Your colour</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Your colour">
            {SWATCHES.map((swatch) => {
              const selected = color.toLowerCase() === swatch.hex.toLowerCase();
              return (
                <button
                  key={swatch.id}
                  type="button"
                  onClick={() => writeAuthorColors({ ...config, [self]: swatch.hex })}
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
        </div>

        <button
          type="button"
          onClick={() => {
            void signOut();
            onClose();
          }}
          className="w-full text-sm font-semibold px-4 py-2 rounded-lg border border-line bg-card text-ink hover:border-faint cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
