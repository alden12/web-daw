/**
 * Voice presence: map an edit/clip/commit author to its accent classes, in one place so
 * every author-coloured surface (activity feed, clip rail, version timeline, patch list)
 * stays consistent. Three voices: "you" = teal, the built-in agent = violet, "claude" =
 * coral (the MCP / Claude Code driver, which is genuinely Claude). Old projects that only
 * know "you"/"claude" still map correctly; adding a voice is one entry here.
 */
export type Voice = "you" | "agent" | "claude";

export function voiceOf(author: string): Voice {
  return author === "agent" ? "agent" : author === "claude" ? "claude" : "you";
}

const DOT: Record<Voice, string> = { you: "bg-you", agent: "bg-agent", claude: "bg-claude" };
const BORDER: Record<Voice, string> = { you: "border-you", agent: "border-agent", claude: "border-claude" };
const LABEL: Record<Voice, string> = { you: "You", agent: "Agent", claude: "Claude" };

export const voiceDot = (author: string): string => DOT[voiceOf(author)];
export const voiceBorder = (author: string): string => BORDER[voiceOf(author)];
export const voiceLabel = (author: string): string => LABEL[voiceOf(author)];
