-- A Cloudflare artifact published before dispatch namespaces keeps a remote that the provider cannot use. Clear it: the next deploy publishes the artifact into the namespace, at its new URL.
UPDATE "artifact" SET "remote" = NULL, "remote_version" = "remote_version" + 1, "url" = NULL, "published_deployment_id" = NULL
WHERE "provider" = 'cloudflare' AND "remote" IS NOT NULL AND ("remote" ->> 'version') IS DISTINCT FROM '3';
