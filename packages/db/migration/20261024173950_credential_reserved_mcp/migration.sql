-- Custom SQL migration file, put your code below! --
-- K45: only credential.connect makes MCP_ labels. A pasted MCP_ key would shadow a connected one, so each one gets Reconnect.
UPDATE "credential" SET "status" = 'reconnect' WHERE "label" LIKE 'MCP\_%' AND "app_id" IS NULL;
