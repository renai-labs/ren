# Artifact application samples

- `dashboard/public/report.html`: static quarterly report; publish the public files alone with entry `report.html` for the static-only sample.
- `dashboard`: server-code API dashboard. Publish `_worker.js` plus the contents of `public/` at the artifact root; entry `index.html`. The local Wrangler config is harness metadata, not an artifact file.
- `state-candidate`: CRUD guestbook and realtime room sharing one SQLite Durable Object. Publish with `config.durableObjects: { STATE: "SampleState" }`. OpenCode supplies this via a `ren-artifact.json` file containing `{"durableObjects":{"STATE":"SampleState"}}`. No external services or Node APIs are used.

Wrangler configs exercise assets-first routing and `env.ASSETS` fallback locally. No dependencies need bundling. All payloads are far below the 500-file / 5 MiB per file / 20 MiB total limits.

Run from `packages/core`:

```sh
REN_SLOW=1 bun test test/artifacts.slow.test.ts
```

The tests publish through Ren's durable deployment workflows and real workerd. SQLite guestbook data and room history survive updates, failed code deployment recovery and stop/redeploy. Binding names and exported class names are append-only: removal, rebinding and renaming are rejected, including after stop. Export each class from `_worker.js`; `cloudflare:workers` imports work without bundling. Access namespaces through `env.STATE` and use stable `idFromName` names. Local data lives under the artifact's stable `ARTIFACT_ROOT` directory, not its deployment directory; deleting that directory loses data. Live WebSockets disconnect on update/stop and clients must reconnect. This does not prove Cloudflare provisioning or backup guarantees. The room is not authenticated or bounded production chat.
