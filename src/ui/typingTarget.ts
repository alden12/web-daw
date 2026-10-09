// Non-text inputs (checkbox / radio / range / button ...) don't consume typed text, so
// keyboard shortcuts and computer-keyboard playing should keep working while one is
// focused. Only genuine text entry (text inputs, textareas, selects, contentEditable)
// should swallow keys. Fixes toggles blocking keyboard play after you click them.
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName === "INPUT") return TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  return false;
}
