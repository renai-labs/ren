# Artifact providers — remaining work

Ordinary Cloudflare Workers are implemented and configurable at the composition
root. See [the setup and verification guide](../../docs/artifact-cloudflare.md).
The next work is in the two specs that section "Next: refactor, then useren.site" links.

## Tools, binary files and size

OpenCode's artifact tools take file contents only as UTF-8 text
([anomalyco/opencode#62122](https://github.com/anomalyco/opencode/issues/62122)),
and keep each artifact's record in the brain's own OpenCode storage. Of the 116
artifacts in v1, 66 have images or fonts, and 4 are over the old 5 MiB file or
20 MiB total limit. So Ren does not use OpenCode's artifact plugin:

- The cell removes `opencode.tool.artifact` and its `ren.artifact` plugin serves
  OpenCode's tool names and inputs under the `opencode` namespace:
  `artifact_create`, `artifact_update`, `artifact_read` and `artifact_delete`,
  plus `artifact_status`. Create and update also take `directory`, a folder on
  the environment, published with its binary files. Read returns the
  artifact's title, entry and URL from Ren's database (`artifacts.read`), not
  its files as OpenCode's does; with `directory`, a new folder on the
  environment gets every file back. A chat without an environment cannot read
  an artifact's files.
- Bytes never pass through the Host API. `artifacts.upload` gives a presigned
  PUT URL. The executor's `files.pack` uploads a folder as a `.tar.gz` with one
  top-level folder; the cell writes one itself for inline `files`.
  `artifacts.deploy` names the upload, and Ren checks it (at most 2000 files,
  25 MiB each, 200 MiB in all; safe paths; the entry; `ren-artifact.json`),
  copies the version it checked to an immutable key and queues the deployment.
  Uploads sit under `artifact-uploads/`; a deploy deletes its own, and a
  bucket lifecycle rule removes the rest after a day. `artifacts.download`
  gives a presigned GET URL that the executor's `files.unpack` reads.
- An executor without `files.pack` cannot publish a folder; inline files still
  work. The environment must reach the bucket's endpoint.
- People use the public artifacts API (`artifact.list` of a space, newest
  first; `artifact.get`; `artifact.archive`), from the app, the SDK and
  `ren artifacts`. Archiving stops serving the artifact, hides it, and refuses
  its next upload or deploy; Ren keeps its source and data.
- One tool for each job. An agent publishes, reads, stops and follows an
  artifact with the `opencode` tools above, as its brain, and finds the space's
  artifacts with Ren MCP's `artifact_list`, as the person in the chat. Ren MCP
  hides `artifact_get` and `artifact_archive`: `artifact_read` reads, and
  archiving is a person's choice in the app. An agent's `artifact_delete`
  stops serving, and publishing again serves the artifact at the same URL.

When OpenCode takes bytes or file references, Ren removes its plugin, enables
OpenCode's, and registers Ren as an OpenCode artifact provider. The tool names
stay the same, so transcripts and clients do not change. OpenCode would also
need an idea of a deployment that is still in progress, and records that are
not per brain.

### Next: artifacts in the app

1. A `session_id` column on `artifact`, set by the deploy that created it, and
   a chat filter on `artifact.list`, so a chat lists its own artifacts.
2. A chat card for an artifact that a chat created or updated, beside
   `show_file`'s, that reads live status from that API. The tools are in code
   mode, so the agent calls them inside `execute`: find
   `.artifact_create` and `.artifact_update` in the `execute` call's
   `toolCalls` metadata, as `AppConnect` finds `.app_request_connect`, as well
   as a direct `opencode_artifact_create` or `opencode_artifact_update` call.
3. The space's Artifacts page and a chat's artifacts panel, as in v1.
4. The site's artifacts page (`concepts/artifacts.mdx`) describes the
   Artifacts page, its card menu (Open, Copy link, Archive) and
   `ren artifacts get <space-id> <artifact-id>`. Check it against what ships,
   and change one or the other: the CLI takes `ren artifacts get <artifact>`,
   and its help says "slug or ID", although artifacts have no slug.
5. Move v1's artifacts: each one's files into a source archive, a row and a
   deployment, at the same URL where that is possible.

## Next: refactor, then useren.site

- [artifact-refactor.md](artifact-refactor.md): a deployment table, async stop and archive, the check in the run,
  stale-version refusal, results sent to the chat, provider state in Postgres, Cloudflare direct upload.
- [artifact-sites.md](artifact-sites.md), stacked on it: Workers for Platforms and `https://<label>.useren.site/`.

## Phase 4 — user-supplied providers

A provider registry, configuration, credential validation, and selection per
artifact. Provider migration is a separate operation.
