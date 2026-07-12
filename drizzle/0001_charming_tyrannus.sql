CREATE TABLE "edits" (
	"project_id" text NOT NULL,
	"seq" integer NOT NULL,
	"command" jsonb NOT NULL,
	"author" text NOT NULL,
	"time" bigint NOT NULL,
	"kind" text,
	"label" text,
	CONSTRAINT "edits_project_id_seq_pk" PRIMARY KEY("project_id","seq")
);
--> statement-breakpoint
ALTER TABLE "edits" ADD CONSTRAINT "edits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;