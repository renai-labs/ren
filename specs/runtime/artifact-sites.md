# Artifacts on useren.site

Every artifact is served at `https://<label>.useren.site/`, where `<label>` comes from the artifact's ID. One dispatcher Worker on Workers for Platforms sends each request to the artifact's own Worker. This change is a PR stacked on [artifact-refactor.md](artifact-refactor.md): it uses that change's direct upload, deployment table and provider contract.

This is the usual layout for sites on one shared domain: one Cloudflare zone, one proxied wildcard record, one wildcard certificate, one dispatcher for all hosts, a redirect on the bare domain, and the domain on the Public Suffix List. Hostnames come from the ID. Names that people choose are out of scope (section 9).

## 1. Situation

1. The Cloudflare provider publishes each artifact as an ordinary Worker named `a-<56 hex of sha256(id)>`, at `https://<name>.<account>.workers.dev/` (`core/src/artifact-provider/cloudflare-code.ts:5`, `cloudflare.ts:51`).
2. An account holds a limited number of ordinary Workers. Ren needs one Worker for each artifact, with no fixed limit.
3. Ordinary Workers cannot send a request to another Worker chosen at request time. One dispatcher for all artifacts needs a dispatch namespace, which only Workers for Platforms has.
4. Setting `ARTIFACT_CLOUDFLARE_NAMESPACE` stops the server at startup (`cloudflare.ts:72-75`).
5. A Durable Object's data belongs to its Worker. An ordinary Worker cannot move into a namespace and keep its data.

## 2. Request path

```
                  GET /any/path?q=1
                  Host: art-0193ab12cd34xyz….useren.site              route *.useren.site/*
 ┌───────────┐    ──────────────────────────────────────────────▶  ┌────────────────────────────┐
 │           │                                                     │                            │
 │  browser  │                                                     │  Cloudflare edge           │
 │           │                                                     │  DNS * AAAA 100:: proxied  │
 └───────────┘                                                     │  cert *.useren.site        │
                                                                   │                            │
                                                                   └────────────────────────────┘

                  env.ARTIFACTS.get("art-0193ab12cd34xyz…")
                  .fetch(request)   (path, query, body and
                  Upgrade unchanged)
 ┌──────────────────────┐    ─────────────────────────────────────▶  ┌────────────────────────────────┐
 │                      │                                            │                                │
 │  dispatcher Worker   │    label not valid, or no such Worker      │  artifact Worker in namespace  │
 │  (Terraform)         │    → 404                                   │  ren-artifacts-production      │
 │                      │                                            │  (Ren publishes)               │
 └──────────────────────┘                                            │  main.js: probe → assets →     │
                                                                     │  _worker.js → SQLite DO        │
                                                                     │                                │
                                                                     └────────────────────────────────┘
```

| Owner     | Owns                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terraform | The zones, DNS records, the wildcard route, the redirect of the bare domain, zone settings, the dispatch namespaces and the dispatcher Worker with its bindings. |
| Ren       | One Worker in the namespace for each artifact, its Durable Objects and their SQLite data.                                                                        |

## 3. Decisions

1. **Label.** `Artifact.label(id)` in `@ren/schema/artifact`: `"art-" + Identifier.suffix(id).toLowerCase()`. An ID is `art_` and 26 characters (`schema/src/identifier.ts:21-30`), so a label has 30 characters. An ID has `_` and capital letters, which a hostname cannot keep. The label is also the script name in the namespace, so the dispatcher needs no lookup.
2. **Label collision.** Two IDs that differ only in letter case give one label. The create upload sends `If-None-Match: *`, so the second one fails with a final `failed`, not an overwrite.
3. **The Cloudflare provider changes to Workers for Platforms.** It keeps the provider ID `cloudflare`. Its state changes from `{ account, subdomain }` to `{ account, namespace, domain }`. A state with `subdomain` fails with a `Failed` that is not retryable. No code keeps ordinary Workers.
4. **No reserved path.** The dispatcher passes every path to the artifact. Readiness uses the `x-ren-artifact-probe` header, which the artifact's platform-owned `main.js` answers (`cloudflare-code.ts:47`).
5. **Separate staging.** Staging uses its own domain, its own zone and the namespace `ren-artifacts-staging`. Universal SSL covers only one level, so `*.staging.useren.site` cannot get a certificate without Advanced Certificate Manager.
6. **Two tokens.** Terraform's token changes zones, DNS, routes, zone settings, redirect rules and the dispatcher. The server's token writes Workers scripts in the namespace only. The server's token has no zone permissions. Check each permission against its endpoint.

## 4. Dispatcher

`infra/cloudflare/dispatcher.js`, about 20 lines. Terraform uploads it.

```js
export default {
  async fetch(request, env) {
    const host = new URL(request.url).hostname
    const label = host.endsWith(`.${env.DOMAIN}`) ? host.slice(0, -env.DOMAIN.length - 1) : ""
    if (!/^art-[0-9a-z]{26}$/.test(label)) return new Response("No artifact here", { status: 404 })
    try {
      return await env.ARTIFACTS.get(label).fetch(request)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Worker not found"))
        return new Response("No artifact here", { status: 404 })
      throw error
    }
  },
}
```

1. It passes the original `Request`, so the path, the query, the body and a WebSocket upgrade reach the artifact unchanged. It does not rebuild the URL.
2. A label with a dot (`a.b.useren.site`) fails the pattern.
3. It sets no cookies and reads none.
4. Bindings: `ARTIFACTS` (dispatch namespace), `DOMAIN` (plain text).

## 5. Infrastructure

New stack `infra/cloudflare`, with a partial `backend "s3" {}` as `infra/aws/versions.tf` has. One module, two instances: production and staging.

| Resource           | Value                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Zone               | `useren.site`; staging: its own domain. Output the name servers. Set them at the registrar by hand. |
| DNS `*`            | `AAAA 100::`, proxied                                                                               |
| DNS apex           | `AAAA 100::`, proxied, for the redirect                                                             |
| Redirect rule      | `useren.site/*` → `https://useren.ai`, 301                                                          |
| DNS `_psl` TXT     | The Public Suffix List pull request URL (section 6)                                                 |
| Zone settings      | Always Use HTTPS on; minimum TLS 1.2                                                                |
| Dispatch namespace | `ren-artifacts-production`; `ren-artifacts-staging`                                                 |
| Workers script     | The dispatcher, with `ARTIFACTS` and `DOMAIN`                                                       |
| Workers route      | `*.useren.site/*` → the dispatcher. The apex does not match, so it gets only the redirect.          |

Check the resource names against the Cloudflare provider version that the stack pins.

`infra/aws`: `artifact_cloudflare` adds `namespace` and `domain`. The server gets `ARTIFACT_CLOUDFLARE_NAMESPACE` and `ARTIFACT_DOMAIN`.

## 6. Public Suffix List

Without it, `art-a….useren.site` can set a cookie for `useren.site` that `art-b….useren.site` receives, and browsers treat both as the same site.

1. The list asks for a minimum registration term. Register the domain for longer than it.
2. Open a pull request to `publicsuffix/list` that adds `useren.site` to the private section.
3. Add the `_psl` TXT record with the pull request's URL (Terraform, section 5).
4. Inclusion takes weeks. The service works before inclusion, with the cookie risk above.

## 7. Provider changes

| Change                                                                                                                                  | Where                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Script name `Artifact.label(id)`, not `ArtifactCloudflareCode.name`                                                                     | `cloudflare-code.ts:5`, `cloudflare.ts`       |
| Endpoints under `/accounts/<id>/workers/dispatch/namespaces/<ns>/scripts/<label>`: metadata read, `assets-upload-session`, script `PUT` | `cloudflare.ts`                               |
| Remove the `workers.dev` subdomain read, `workers_dev`, `preview_urls` and the per-script subdomain enable                              | `cloudflare.ts:87-92`, `:201-202`, `:317-332` |
| URL and probe at `https://<label>.<domain>/`                                                                                            | `cloudflare.ts:51`, `:111`, `:133`            |
| Config: `ARTIFACT_CLOUDFLARE_NAMESPACE` and `ARTIFACT_DOMAIN` required for `cloudflare`. Remove the startup refusal.                    | `cloudflare.ts:64`, `:72-75`                  |
| Stop stays a 410 tombstone. Never delete a namespace script: a forced delete also deletes its Durable Objects.                          | `cloudflare-code.ts:20-21`                    |
| Update [docs/artifact-cloudflare.md](../../docs/artifact-cloudflare.md) and `infra/aws/README.md` ("Artifacts on Cloudflare").          |                                               |

## 8. Order and gates

| Step | Work                                                                                                                                                                                                                                                                        | Gate                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0    | Set up the domains and Workers for Platforms on the account. Open the Public Suffix List pull request.                                                                                                                                                                      | Approval                                                                                                                |
| 1    | On the staging namespace, with a script: create a namespace script with `If-None-Match: *`, read its ETag, update it with `If-Match`, and send a stale `If-Match`. Upload a script with a SQLite Durable Object, declarative `exports` and the `immediate` update strategy. | The stale update returns 412, and the Durable Object script uploads. Else stop: publication fencing needs a new design. |
| 2    | `infra/cloudflare`: plan and apply staging.                                                                                                                                                                                                                                 | Approval of the apply                                                                                                   |
| 3    | Provider changes (section 7), dispatcher, label.                                                                                                                                                                                                                            |                                                                                                                         |
| 4    | Live tests on staging through the final URL (section 10).                                                                                                                                                                                                                   | All pass                                                                                                                |
| 5    | Count production rows with `provider = 'cloudflare'`.                                                                                                                                                                                                                       | Zero: continue. More than zero: stop and decide. Their Durable Object data cannot move.                                 |
| 6    | Apply production, set the server's configuration, release.                                                                                                                                                                                                                  | Approval of the apply and the release                                                                                   |

## 9. Out of scope

1. Names that people choose, and renames with redirects. They need a name → label map (Workers KV) that Ren writes.
2. Custom domains of customers.
3. Access control (sign-in before an artifact opens).
4. Per-artifact CPU and subrequest limits through the dispatcher.

## 10. Tests

Run the live scenarios of `artifacts-cloudflare.slow.test.ts` and `artifacts-brain.slow.test.ts` through `https://<label>.<staging-domain>/`. Add these cases:

| Case                                                              | Expected                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /a/b/c?x=1` on an artifact whose `_worker.js` echoes the URL | The artifact receives `/a/b/c?x=1`                                             |
| WebSocket to the realtime room                                    | Messages pass in both directions                                               |
| A label that is valid but not published                           | 404 "No artifact here"                                                         |
| `a.b.<domain>`, and a host that is not a label                    | 404                                                                            |
| The bare domain                                                   | 301 to `https://useren.ai`                                                     |
| Stop, then the URL                                                | 410; after a redeploy, the same URL serves, and the SQLite data is still there |
| Two deploys race                                                  | The stale upload gets 412 on the namespace endpoint; one version serves        |
| A deploy whose readiness fails                                    | Recovery serves the previous version at the same URL                           |
| Process loss before and after each remote write                   | The next call recovers; no Durable Object class is lost                        |
| A production host on staging, and the reverse                     | Each namespace serves only its own artifacts                                   |

## 11. Open

1. **Deep links in static single-page apps.** Without `_worker.js`, `GET /settings` on a client-routed app returns 404: the assets config has no `not_found_handling` (`cloudflare.ts:204`). The `single-page-application` mode also changes real 404s and may answer `GET /api/*` with `index.html` before `_worker.js` runs. Decide separately.
2. **The staging domain name.**
