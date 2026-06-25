/**
 * Id generators for commands. Ids are assigned at the dispatch site (as the MCP
 * server already does) so a command is complete and reproducible the moment it
 * is logged, and both ends of the bridge agree on the id.
 */
const short = () => crypto.randomUUID().slice(0, 8);

export const newTrackId = () => `t-${short()}`;
export const newGroupId = () => `g-${short()}`;
export const newEffectId = () => `fx-${short()}`;
export const newVariantId = () => `v-${short()}`;
export const newNoteId = () => crypto.randomUUID();
