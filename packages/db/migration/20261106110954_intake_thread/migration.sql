ALTER TABLE "channel_thread" RENAME TO "intake_thread";--> statement-breakpoint
ALTER TABLE "intake_thread" RENAME COLUMN "provider" TO "origin";--> statement-breakpoint
ALTER TABLE "intake_thread" RENAME COLUMN "install" TO "scope";--> statement-breakpoint
ALTER INDEX "channel_thread_provider_install_thread_uidx" RENAME TO "intake_thread_origin_scope_thread_uidx";--> statement-breakpoint
ALTER INDEX "channel_thread_session_id_idx" RENAME TO "intake_thread_session_id_idx";