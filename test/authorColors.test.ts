import { describe, expect, it } from "vitest";
import { colorForAuthor } from "../src/ui/authorColors";
import { DEFAULT_VOICE_COLORS } from "../src/ui/authorVoice";

// Colouring is perspective-relative: the viewer's own id reads teal ("you"), the AI voices are absolute,
// and every other id gets a stable hashed hue - so two collaborators never rely on a single privileged
// "you" identity (the asymmetry the earlier model had).
describe("colorForAuthor (perspective-relative)", () => {
  it("paints the viewer's own edits with the you/teal hue, whoever they are", () => {
    expect(colorForAuthor("you", {}, "you")).toBe(DEFAULT_VOICE_COLORS.you);
    expect(colorForAuthor("bob", {}, "bob")).toBe(DEFAULT_VOICE_COLORS.you);
  });

  it("does NOT give a peer the teal hue just because their id is the default 'you'", () => {
    // Viewer is "bob"; a peer whose id is "you" is just another collaborator, not teal.
    expect(colorForAuthor("you", {}, "bob")).not.toBe(DEFAULT_VOICE_COLORS.you);
  });

  it("keeps the AI voices absolute (same colour for everyone)", () => {
    expect(colorForAuthor("claude", {}, "bob")).toBe(DEFAULT_VOICE_COLORS.claude);
    expect(colorForAuthor("agent", {}, "bob")).toBe(DEFAULT_VOICE_COLORS.agent);
  });

  it("lets a configured override win, even for self or a voice", () => {
    expect(colorForAuthor("bob", { bob: "#123456" }, "alice")).toBe("#123456");
    expect(colorForAuthor("bob", { bob: "#123456" }, "bob")).toBe("#123456"); // self override beats teal
  });

  it("gives distinct collaborators stable, different hues", () => {
    const alice = colorForAuthor("alice", {}, "me");
    const bob = colorForAuthor("bob", {}, "me");
    expect(colorForAuthor("alice", {}, "me")).toBe(alice); // stable
    expect(alice).not.toBe(bob);
  });

  it("defaults self to 'you' (solo/back-compat: the lone user is teal)", () => {
    expect(colorForAuthor("you")).toBe(DEFAULT_VOICE_COLORS.you);
  });
});
