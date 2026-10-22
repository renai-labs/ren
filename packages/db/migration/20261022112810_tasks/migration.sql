CREATE TABLE "label" (
	"id" text PRIMARY KEY,
	"organization_id" text,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "label_name_length_check" CHECK (char_length("name") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text,
	"human_review" boolean DEFAULT false NOT NULL,
	"human_review_reason" text,
	"due_at" timestamp,
	"agent_id" text,
	"owner_id" text,
	"created_by_user_id" text,
	"created_by_agent_id" text,
	"created_by_session_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "task_title_length_check" CHECK (char_length("title") between 1 and 256),
	CONSTRAINT "task_status_check" CHECK ("status" in ('todo', 'in_progress', 'done', 'dismissed')),
	CONSTRAINT "task_priority_check" CHECK ("priority" in ('low', 'medium', 'high')),
	CONSTRAINT "task_human_review_check" CHECK ("human_review" = ("human_review_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "task_comment" (
	"id" text PRIMARY KEY,
	"task_id" text NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text,
	"author_agent_id" text,
	"author_session_id" text,
	"edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "task_event" (
	"id" text PRIMARY KEY,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"kind" text GENERATED ALWAYS AS ("task_event"."data" ->> '_tag') STORED NOT NULL,
	"actor_user_id" text,
	"actor_agent_id" text,
	"actor_session_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_label" (
	"task_id" text,
	"label_id" text,
	CONSTRAINT "task_label_pkey" PRIMARY KEY("task_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "task_link" (
	"id" text PRIMARY KEY,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_sequence" (
	"organization_id" text PRIMARY KEY,
	"prefix" text NOT NULL,
	"last_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_session" (
	"task_id" text,
	"session_id" text,
	"agent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_session_pkey" PRIMARY KEY("task_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "agent_order" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "label_organization_id_name_uidx" ON "label" ("organization_id",lower("name")) WHERE ("archived_at" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "label_system_name_uidx" ON "label" (lower("name")) WHERE "organization_id" is null and "archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_organization_id_number_uidx" ON "task" ("organization_id","number");--> statement-breakpoint
CREATE INDEX "task_space_id_status_idx" ON "task" ("space_id","status") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE INDEX "task_agent_id_idx" ON "task" ("agent_id") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE INDEX "task_owner_id_idx" ON "task" ("owner_id") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE INDEX "task_comment_task_id_created_at_id_idx" ON "task_comment" ("task_id","created_at","id") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE INDEX "task_event_task_id_created_at_id_idx" ON "task_event" ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_label_label_id_idx" ON "task_label" ("label_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_link_task_id_kind_key_uidx" ON "task_link" ("task_id","kind","key");--> statement-breakpoint
CREATE INDEX "task_link_organization_id_kind_key_idx" ON "task_link" ("organization_id","kind","key");--> statement-breakpoint
CREATE INDEX "task_session_task_id_agent_id_created_at_idx" ON "task_session" ("task_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "task_session_session_id_idx" ON "task_session" ("session_id");--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_agent_id_agent_id_fkey" FOREIGN KEY ("created_by_agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_session_id_agent_session_id_fkey" FOREIGN KEY ("created_by_session_id") REFERENCES "agent_session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_author_user_id_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_author_agent_id_agent_id_fkey" FOREIGN KEY ("author_agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_author_session_id_agent_session_id_fkey" FOREIGN KEY ("author_session_id") REFERENCES "agent_session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_actor_agent_id_agent_id_fkey" FOREIGN KEY ("actor_agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_actor_session_id_agent_session_id_fkey" FOREIGN KEY ("actor_session_id") REFERENCES "agent_session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_label" ADD CONSTRAINT "task_label_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_label" ADD CONSTRAINT "task_label_label_id_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "label"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_link" ADD CONSTRAINT "task_link_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_link" ADD CONSTRAINT "task_link_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_sequence" ADD CONSTRAINT "task_sequence_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_session" ADD CONSTRAINT "task_session_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_session" ADD CONSTRAINT "task_session_session_id_agent_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_session" ADD CONSTRAINT "task_session_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;