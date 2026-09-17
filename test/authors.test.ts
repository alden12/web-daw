/**
 * DAW-34: an agent edit belongs to the user who drove it.
 *
 * The author used to be a bare voice, which made an agent edit belong to everyone in a shared
 * session and to nobody in particular - so undoing it could take back the work another person's
 * agent had just done. Naming the driver in the author is what fixes that, and these say what the
 * shape means.
 */
import { describe, expect, it } from "vitest";
import { agentAuthor, agentDriver, isAgentAuthor, isOwnWork, UNATTRIBUTED_AGENT } from "../src/audio/commands/authors";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { authorSchema } from "../src/audio/project/schema";
import { authorLabel } from "../src/ui/authorStyle";
import { clipAuthor } from "../src/audio/project/projectSerialization";

describe("an agent author", () => {
  it("names the user it acts for", () => {
    expect(agentAuthor("alice")).toBe("agent:alice");
    expect(agentDriver(agentAuthor("alice"))).toBe("alice");
  });

  it("reads as an agent whoever drove it", () => {
    expect(isAgentAuthor(agentAuthor("alice"))).toBe(true);
    expect(isAgentAuthor(UNATTRIBUTED_AGENT)).toBe(true);
    expect(isAgentAuthor("alice")).toBe(false);
    expect(isAgentAuthor("you")).toBe(false);
  });

  // A user whose id merely starts with the word is a person, not an agent.
  it("does not mistake a user called 'agentine' for one", () => {
    expect(isAgentAuthor("agentine")).toBe(false);
    expect(agentDriver("agentine")).toBeNull();
  });

  it("has no driver when there is nothing after the prefix", () => {
    expect(agentDriver(UNATTRIBUTED_AGENT)).toBeNull();
    expect(agentDriver("agent:")).toBeNull();
  });

  // The schema has to hold a prefix plus a user id, and a user id can itself be long.
  it("still validates with a maximum-length user id", () => {
    expect(authorSchema.safeParse(agentAuthor("u".repeat(64))).success).toBe(true);
  });
});

describe("whose work an edit is", () => {
  it("counts your own edits and an agent you drove", () => {
    expect(isOwnWork("alice", "alice")).toBe(true);
    expect(isOwnWork(agentAuthor("alice"), "alice")).toBe(true);
  });

  it("does not count another person, or their agent", () => {
    expect(isOwnWork("bob", "alice")).toBe(false);
    expect(isOwnWork(agentAuthor("bob"), "alice")).toBe(false);
  });

  // The point of recording a driver: with none there is no way to tell it was not made for someone
  // else, so nobody owns it and nobody's undo reaches it.
  it("counts an agent with no driver as nobody's", () => {
    expect(isOwnWork(UNATTRIBUTED_AGENT, "alice")).toBe(false);
    expect(isOwnWork(UNATTRIBUTED_AGENT, "you")).toBe(false);
  });
});

describe("the log's agent author", () => {
  it("follows the current user, so an agent edit lands on whoever is driving", () => {
    const log = new EditLog(new ProjectStore(false));
    expect(log.agentAuthor).toBe("agent:you");
    log.setLocalAuthor("alice");
    expect(log.agentAuthor).toBe("agent:alice");
  });

  it("stamps it on a dispatch made as the agent, so no caller names a voice", () => {
    const log = new EditLog(
      new ProjectStore(false),
      (() => {
        let next = 0;
        return () => `e-${next++}`;
      })(),
    );
    log.setLocalAuthor("alice");
    log.dispatchAsAgent({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });

    expect(log.getEntries().at(-1)?.author).toBe("agent:alice");
  });
});

describe("the label an agent edit shows", () => {
  it("says plain Agent for one I drove, and names the driver for anyone else's", () => {
    expect(authorLabel(agentAuthor("alice"), "alice")).toBe("Agent");
    expect(authorLabel(agentAuthor("bob"), "alice")).toBe("Agent (bob)");
  });

  it("falls back to Agent when no driver was recorded", () => {
    expect(authorLabel(UNATTRIBUTED_AGENT, "alice")).toBe("Agent");
  });

  it("leaves a person's label alone", () => {
    expect(authorLabel("you")).toBe("You");
    expect(authorLabel("alice", "bob")).toBe("alice");
  });
});

// A clip's stored stamp used to be collapsed to one of three voices on load, which quietly erased
// a collaborator's id from a clip they authored - and would have erased the driving user out of an
// agent author too. A stamp is a display key: an unrecognised one costs a colour, a rewritten one
// costs the truth.
describe("reading a stored author stamp", () => {
  it("keeps a collaborator's id rather than calling their clip yours", () => {
    expect(clipAuthor("alice")).toBe("alice");
  });

  it("keeps the driver in an agent stamp", () => {
    expect(clipAuthor(agentAuthor("alice"))).toBe("agent:alice");
  });

  it("falls back to the default user for something that is not an author at all", () => {
    expect(clipAuthor(undefined)).toBe("you");
    expect(clipAuthor(42)).toBe("you");
    expect(clipAuthor("")).toBe("you");
  });
});
