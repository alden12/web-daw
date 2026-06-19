/**
 * The MCP bridge wire protocol. Pure types, imported by BOTH the browser bridge
 * and the Node server so the two ends can never drift. Messages are sent as
 * JSON over a WebSocket.
 */
import type { ParamValue, PatchValues } from '../params/types';

/** Sent by the browser tab to the server. */
export type BrowserToServer =
  | { type: 'snapshot'; values: PatchValues }
  | { type: 'paramChanged'; id: string; value: ParamValue };

/** Sent by the server to the browser tab. */
export type ServerToBrowser =
  | { type: 'setParam'; id: string; value: ParamValue }
  | { type: 'noteOn'; midi: number }
  | { type: 'noteOff' };

export const DEFAULT_WS_PORT = 8765;
