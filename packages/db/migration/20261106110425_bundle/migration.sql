CREATE TABLE "bundle" (
	"kind" text PRIMARY KEY,
	"version" text NOT NULL,
	"sha256" text NOT NULL,
	"built_at" timestamp NOT NULL
);
