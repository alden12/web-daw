/**
 * The API contract: one shared, plain-data definition of the surface, imported by both
 * the server (to mount + validate) and the client (to derive typed calls). This barrel
 * re-exports the DOM/Node-free definition only (routes, message unions, param/error
 * schemas), so it is safe to import from the server. The browser client implementation
 * that touches `fetch`/`WebSocket` lives in ./client and is imported directly by client
 * code, never through here.
 */
export * from "./errors";
export * from "./http";
export * from "./ws";
