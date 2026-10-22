ALTER TABLE "task" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_id_space_id_unique" UNIQUE("id","space_id");--> statement-breakpoint
CREATE INDEX "task_parent_id_space_id_idx" ON "task" ("parent_id","space_id");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_parent_fk" FOREIGN KEY ("parent_id","space_id") REFERENCES "task"("id","space_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_parent_check" CHECK ("parent_id" <> "id");