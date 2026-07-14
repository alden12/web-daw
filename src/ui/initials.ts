/** Up to two initials for an account avatar: first+last word, else the first two characters, else "?". */
export function initials(nameOrEmail: string): string {
  const words = nameOrEmail.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return (words[0]?.slice(0, 2) || "?").toUpperCase();
}
