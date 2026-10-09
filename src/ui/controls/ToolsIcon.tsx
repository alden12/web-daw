/**
 * Sliders: a surface's tools (snap, grid, quantize, zoom and the like). The trigger for the roll's
 * and the arrangement's tools menus on both shells (MOBILE-19), so a surface's tools look the same
 * wherever you meet them, and do not look like a kebab of miscellany.
 */
export function ToolsIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className={className}
    >
      <path d="M2.5 4.5h11M2.5 11.5h11" />
      <circle cx="6" cy="4.5" r="1.6" fill="var(--color-panel)" />
      <circle cx="10.5" cy="11.5" r="1.6" fill="var(--color-panel)" />
    </svg>
  );
}
