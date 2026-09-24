/**
 * Every tool group, registered against one context. The local server (a browser tab over a
 * WebSocket) and the hosted one (a stored project on the sync service) register the same set, so the
 * two cannot drift apart.
 */
import type { ToolContext } from "../context";
import { registerTracksTools } from "./tracks";
import { registerCustomDevicesTools } from "./customDevices";
import { registerGroupsTools } from "./groups";
import { registerParametersTools } from "./parameters";
import { registerEffectsTools } from "./effects";
import { registerMidiDevicesTools } from "./midiDevices";
import { registerClipNotesTools } from "./clipNotes";
import { registerClipPoolTools } from "./clipPool";
import { registerPlacementsTools } from "./placements";
import { registerTransportTools } from "./transport";
import { registerVersionHistoryTools } from "./versionHistory";
import { registerPatchesTools } from "./patches";
import { registerFeedTools } from "./feed";
import { registerLiveNotesTools } from "./liveNotes";

export function registerDawTools(context: ToolContext): void {
  registerTracksTools(context);
  registerCustomDevicesTools(context);
  registerGroupsTools(context);
  registerParametersTools(context);
  registerEffectsTools(context);
  registerMidiDevicesTools(context);
  registerClipNotesTools(context);
  registerClipPoolTools(context);
  registerPlacementsTools(context);
  registerTransportTools(context);
  registerVersionHistoryTools(context);
  registerPatchesTools(context);
  registerFeedTools(context);
  registerLiveNotesTools(context);
}
