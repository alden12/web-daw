--> statement-breakpoint
-- DAW-34: the per-model author voice is gone. An AI edit is the agent's, and a new one carries the
-- user who drove it (`agent:<userId>`); these predate that, so there is no driver to attribute them
-- to. They become the unattributed agent: coloured and labelled as the agent, owned by nobody, so an
-- undo cannot take back work on someone else's behalf.
UPDATE "edits" SET "author" = 'agent' WHERE "author" = 'claude';
