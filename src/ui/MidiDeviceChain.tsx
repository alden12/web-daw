/**
 * The selected instrument track's MIDI-device chain, rendered inline in the signal-chain
 * strip BEFORE the instrument card: one compact card per device (bypass / reorder / remove
 * + its knobs). Devices transform note events (live + playback) on their way to the
 * instrument. Mirrors EffectChain.tsx; every edit goes through the project store, the same
 * model MCP drives. Adding a device is done from the library panel (MIDI FX section).
 */
import type { ProjectStore } from "../audio/project/projectStore";
import { useProject } from "../audio/project/useProject";
import { midiDeviceCatalogEntry, midiDeviceSchema } from "../audio/midi/device/catalog";
import type { Dispatch } from "../audio/commands/types";
import { midiDeviceParamKey } from "../audio/commands/authorship";
import { DeviceParams } from "./DeviceParams";
import { FlowArrow } from "./EffectChain";

const iconBtn = "font-mono text-[11px] w-5 h-5 rounded border border-line text-ink cursor-pointer";

export function MidiDeviceChain({
  projectStore,
  trackId,
  dispatch,
}: {
  projectStore: ProjectStore;
  trackId: string;
  dispatch: Dispatch;
}) {
  const project = useProject(projectStore);
  const track = project.tracks.find((track) => track.id === trackId);
  if (!track || track.kind !== "instrument") return null;
  const devices = track.midiDevices;

  return (
    <>
      {devices.map((device, i) => {
        const store = projectStore.getMidiDevice(trackId, device.id)?.params;
        if (!store) return null;
        // Each device card carries its own trailing arrow (into the next device / the
        // instrument) in one flex group, so the arrow stays glued to its right edge on wrap.
        return (
          <div key={device.id} className="flex items-stretch shrink-0">
            <div className={`shrink-0 border border-line rounded-xl bg-card ${device.bypassed ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line">
                <span
                  className="font-mono text-[12px] font-semibold text-bright mr-1 truncate"
                  title={midiDeviceCatalogEntry(device.type).label}
                >
                  {midiDeviceCatalogEntry(device.type).label}
                </span>
                <button
                  type="button"
                  title={device.bypassed ? "Enable" : "Bypass"}
                  onClick={() =>
                    dispatch({ type: "bypassMidiDevice", trackId, deviceId: device.id, bypassed: !device.bypassed })
                  }
                  className={`font-mono text-[10px] h-5 px-1.5 rounded border cursor-pointer ${
                    device.bypassed ? "border-line text-muted" : "border-you/45 text-you"
                  }`}
                >
                  {device.bypassed ? "Off" : "On"}
                </button>
                <button
                  type="button"
                  title="Move earlier"
                  disabled={i === 0}
                  onClick={() => dispatch({ type: "moveMidiDevice", trackId, deviceId: device.id, toIndex: i - 1 })}
                  className={`${iconBtn} disabled:opacity-30`}
                >
                  ←
                </button>
                <button
                  type="button"
                  title="Move later"
                  disabled={i === devices.length - 1}
                  onClick={() => dispatch({ type: "moveMidiDevice", trackId, deviceId: device.id, toIndex: i + 1 })}
                  className={`${iconBtn} disabled:opacity-30`}
                >
                  →
                </button>
                <button
                  type="button"
                  title="Remove MIDI device"
                  onClick={() => dispatch({ type: "removeMidiDevice", trackId, deviceId: device.id })}
                  className={iconBtn}
                >
                  ×
                </button>
              </div>
              <DeviceParams
                schema={midiDeviceSchema(device.type)}
                store={store}
                onChange={(id, value) =>
                  dispatch({ type: "setMidiDeviceParam", trackId, deviceId: device.id, id, value })
                }
                authorOf={(paramId) => projectStore.authorOf(midiDeviceParamKey(trackId, device.id, paramId))}
              />
            </div>
            <FlowArrow />
          </div>
        );
      })}
    </>
  );
}
