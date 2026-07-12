CREATE TABLE "files" (
	"project_id" text NOT NULL,
	"path" text NOT NULL,
	"json" jsonb,
	"bytes" "bytea",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_project_id_path_pk" PRIMARY KEY("project_id","path"),
	CONSTRAINT "files_one_payload" CHECK (("files"."json" is null) != ("files"."bytes" is null))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text DEFAULT 'Untitled' NOT NULL,
	"project_schema" integer DEFAULT 0 NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;