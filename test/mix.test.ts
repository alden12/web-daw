import { describe, expect, it } from "vitest";
import { soloMutedTrackIds } from "../src/audio/engine/mix";

const g = (id: string, parentId: string | null, solo = false) => ({ id, parentId, solo });
const t = (id: string, parentId: string, muted = false, solo = false) => ({ id, parentId, muted, solo });

describe("soloMutedTrackIds", () => {
  it("with no solo, only explicitly-muted tracks are silenced", () => {
    const muted = soloMutedTrackIds([g("grp", null)], [t("a", "grp", true), t("b", "grp")]);
    expect([...muted]).toEqual(["a"]);
  });

  it("with a soloed track, every other track is silenced", () => {
    const muted = soloMutedTrackIds([g("grp", null)], [t("a", "grp", false, true), t("b", "grp"), t("c", "grp")]);
    expect(muted.has("a")).toBe(false);
    expect(muted.has("b")).toBe(true);
    expect(muted.has("c")).toBe(true);
  });

  it("soloing a group keeps its tracks (incl. nested) and silences the rest", () => {
    const groups = [g("lead", null, true), g("drums", null)];
    const tracks = [t("synth", "lead"), t("kick", "drums"), t("hat", "drums")];
    const muted = soloMutedTrackIds(groups, tracks);
    expect(muted.has("synth")).toBe(false); // in the soloed group
    expect(muted.has("kick")).toBe(true);
    expect(muted.has("hat")).toBe(true);
  });

  it("explicit mute still silences a solo-active track", () => {
    const muted = soloMutedTrackIds([g("grp", null)], [t("a", "grp", true, true)]);
    expect(muted.has("a")).toBe(true); // soloed but also muted -> silent
  });
});
