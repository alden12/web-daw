/**
 * The audio-start gate. Browsers won't create/resume an AudioContext until the
 * user interacts with the page, so we make that requirement explicit with a modal
 * rather than an easy-to-miss button. Shown until the engine has started.
 */
export function StartDialog({ onStart, error }: { onStart: () => void; error?: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-title"
    >
      <div className="bg-panel border border-line rounded-2xl p-8 max-w-sm mx-4 text-center flex flex-col items-center gap-4 shadow-2xl">
        <span
          className="w-9 h-9 rounded-full"
          style={{ background: "conic-gradient(from 200deg, var(--color-you), var(--color-claude), var(--color-you))" }}
        />
        <h2 id="start-title" className="text-lg font-semibold text-strong">
          Start the audio engine
        </h2>
        <p className="text-sm text-muted leading-relaxed">
          Browsers won't play sound until you interact with the page. Click start to enable playback, the keyboard, and
          anything Claude triggers over MCP.
        </p>
        <button
          type="button"
          onClick={onStart}
          autoFocus
          className="mt-1 font-mono text-sm font-semibold px-5 py-2.5 rounded-lg bg-you text-ground cursor-pointer"
        >
          ▶ Start audio
        </button>
        {/* Startup can fail for reasons the page cannot fix by retrying - most often an
            insecure context, where AudioWorklet is unavailable and the button otherwise
            just appears to do nothing. Say so rather than leaving the modal sitting there. */}
        {error && (
          <p role="alert" className="text-xs text-red-300 leading-relaxed">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
