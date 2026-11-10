# Artifact providers — remaining work

## Phase 3 — Cloudflare

`ArtifactCloudflare.layer`: upload each artifact as a user Worker to a shared
dispatch namespace (staging and production), with a version tag. Ren's dispatch
Worker routes `<artifact>.<domain>` to it. Confirm the version tag through the
dispatch route before the provider's `deploy` returns. Needs `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, the namespace, and the artifacts domain.

Keep the existing `Artifact.Config.durableObjects` binding-to-exported-class
contract. Provision SQLite Durable Objects with stable artifact/class identity
across updates and stop/redeploy. Existing bindings/classes cannot be removed or
renamed. Production must persist migration history rather than replay local
Wrangler's initial migration on every upload. Stop removes only the deployment;
source archives and application data remain.

Done when switching the layer at the composition root changes no caller and the
report, dashboard, guestbook and realtime room tests pass through the dispatch
route. No provider registry, billing, metering or celld changes in this phase.

## Phase 4 — user-supplied providers

A provider registry, configuration, credential validation, and selection per
artifact. Provider migration is a separate operation.
