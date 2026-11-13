ALTER TABLE "credential_caller" RENAME COLUMN "address" TO "machine_id";--> statement-breakpoint
ALTER INDEX "credential_caller_address_uidx" RENAME TO "credential_caller_machine_id_uidx";