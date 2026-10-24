# ren-v1: apps and how they reached a VM

Evidence for [`../README.md`](../README.md). Code: `../ren-v1`. The ids INV and OI come from [`../../../ren-v1-hld/references/`](../../../ren-v1-hld/references/).

## How ren-v1 did apps

| Fact                                                                                                                                                  | Source                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| An app is a blueprint of kind `app`: one integration, at most one MCP server, its own skills. The add target is a project.                            | `packages/api/src/blueprint/CLAUDE.md`         |
| Adding a blueprint copies it. Nothing remembers the blueprint afterwards: no install record, no version rows, no update path.                         | same                                           |
| Skills and MCP servers are the two exceptions: they are links to the published entity, without a version pin, so a new publish reaches every project. | same                                           |
| A missing or archived source gives a `skipped[]` line in the add report, not an error.                                                                | same                                           |
| The add report lists the credential requirements that the user must connect.                                                                          | same                                           |
| Blueprint slugs are unique globally. Pushing an archived slug revives it.                                                                             | same, "Push"                                   |
| Publish also publishes every skill and MCP server that the blueprint links, so every link is always valid.                                            | same, "Publish"                                |
| After the add commits, `Pod.touchManifest` marks the pod's config as changed and pushes `ren:invalidate` to the VM.                                   | same; `ren-v1-hld/references/05-hot-reload.md` |
| The API built OpenCode's config (`opencode.json`, env, skill menu) for each pod.                                                                      | `api/src/opencode/manifest-compose.ts`         |
| An MCP definition holds no secret. Requirements are declared; values live in the vault.                                                               | `packages/api/src/mcp/CLAUDE.md`               |

## Bugs that ren-v1 fixed, and the rule each gives

| Id          | What broke                                                                                      | Rule for this spec                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| INV-33      | Some writes did not mark the pod's config as changed. The change never reached the VM.          | Every write that changes a space's catalog changes its revision.       |
| INV-34      | A forced rebuild changed the system prompt (timestamp, unordered rows). The prompt cache broke. | The same catalog gives the same bytes. Sort every list.                |
| INV-35      | Global config merged after project config, so the wrong default won.                            | Render owns the merge order of its harness.                            |
| INV-38      | A refresh disposed instances that waited for a permission. They stayed "waiting".               | Never apply a change to a busy or waiting session; apply at turn end.  |
| INV-40      | One bad skill failed the whole config.                                                          | One bad app does not block the other apps.                             |
| INV-43      | Facade MCP tools were allowed when no agent bound them.                                         | Deny by default; an agent gets an app's tools only when it has access. |
| INV-48      | `my-mcp` and `my--mcp` gave the same env name; one MCP got the other's secret.                  | The harness's name rule decides a clash, so Render checks clashes.     |
| `8e819b7fb` | A published skill version lost its `requiredCredentials`.                                       | Requirements are part of the release content.                          |
| `a2f28d600` | The VM did not re-copy a skill when the chosen version changed.                                 | A content change changes the revision.                                 |
| `5b0af935b` | Archive of a skill and its versions was not one transaction, and did not say what it broke.     | Archive is one transaction and names what depends on it.               |
| `a5b848497` | A duplicate version leaked an SQL error.                                                        | A duplicate version is a 409 with a message.                           |
