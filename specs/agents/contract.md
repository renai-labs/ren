# Agents and layered settings

This is the current contract. The [v1 proposal](v1.md), its system design and edge-case tables are historical. In particular, push delivery, server-side merging, session instruction/permission overrides, and exclusion of Ren instructions from explicit agents were proposals, not the implemented contract.

## Ownership

An organization agent has one owner space and can join other spaces in that organization. The owner is an implicit membership; other memberships have rows. Names are unique among live agents in an organization. Ren's global agents (`ren`, `general`, `explore`) and OpenCode's hidden helper names are reserved.

Members of any participating space can read an agent. Owner-space members can edit or archive it. Adding a membership or transferring ownership requires membership in both relevant spaces. Either side can remove a non-owner membership. Organization administrators can perform these operations without joining the spaces.

An owner space cannot be archived while it owns live agents. Creation and transfer lock the destination space while checking that it is live, so a concurrent archive cannot leave a live agent owned by an archived space. Ownership transfer keeps the old owner as an ordinary member.

A session stores its selected agent ID at creation. It must be a live primary agent of the session's space. If it is archived, detached or converted into a subagent, the next settings pull falls back to Ren. Other primary agents are not offered as subagents.

## Pull protocol and merging

The brain pulls `POST /host/settings` at open, start and before user prompt admission. Ren does not push changes. The host token identifies the session; the caller cannot request another session's settings.

Ren returns the Ren, organization and space layers, plus the current primary agent and available subagents. Each layer has a content hash. The brain sends its known hashes; unchanged layers omit their settings. A missing owner layer has a null hash, and agents absent from the response are removed from the cache.

`@ren/core` reads the layers. `@ren/brain` caches and merges them. `@ren/cell` applies the result to OpenCode. The order is:

```
Ren → organization → space → primary agent → session model override
```

- Instructions concatenate in that order, omitting blank text. Ren instructions apply to explicit agents too.
- Model and variant are one unit. The last layer with a model wins; an omitted variant means the default variant, not the previously selected variant.
- Permissions are a deduplicated union. Matching denies beat asks, asks beat allows, and no match allows. An allow cannot cancel an ask or deny from another layer.
- References merge by alias; the last layer defining an alias wins. A single layer cannot repeat an alias. Subagents cannot define references.

A subagent gets Ren + organization + space + its own instructions. It inherits the primary agent's resolved model, including the session override, unless it sets its own model. Its permissions include the primary agent's permissions and its own rules.

The brain validates the resolved primary and subagent models against OpenCode's catalog, including variants. A missing primary agent or model is `Unconfigured`; an unavailable model is `UnknownModel`. Seed the Ren settings and global agents with `bun run ren:settings`.

## Session lifecycle

The cell saves the original start model, the current session override, and interactivity in the OpenCode session's `metadata.ren`.

- Repeating the same start input preserves a later client-selected override.
- A changed start model replaces the override. Removing it clears the override.
- A failed settings refresh does not commit a candidate override or cache.
- Reopening restores attachment, interactivity and the saved override before resuming suspended sessions or serving requests. Restoring an existing session is strict; failure prevents resuming it with incomplete policy.

Settings application is serialized across plugin instances. Registry reloads run only when resolved settings change. Session reconciliation also runs when the settings are identical, because attachment or persisted OpenCode state may differ.

OpenCode has one plugin instance per location. The cell shares resolved state across these instances and reloads all their agent/reference registries when it changes. Visible built-in agents are replaced; hidden title and compaction helpers remain.

Clients select models through `PUT /ren/sessions/:id/model`. OpenCode's direct model and agent switching routes are server-only. A null model clears the override. Both the runtime selection and saved metadata reflect a successful edit.

## Permissions and live changes

The permission hook evaluates Ren's rules and can only make OpenCode's decision stricter. In a non-interactive session, a matching ask becomes a deny with a reason. Whole-resource denies hide all matching tools from the model, including wildcard action names such as `linear_*`.

The subagent tool cannot choose a model: the adapter removes that parameter from both its advertised schema and its execution input. Subagents use the resolved model policy.

Prompt-admission pulls are best effort because OpenCode prompt hooks have no typed rejection API. A failed pull logs a warning and keeps the last valid settings. Starts and explicit model edits are strict. There is no background settings push or per-tool pull: an edit reaches an already-running turn when a subsequent pull applies it, not automatically at its next step.

## References

With an environment connection, the cell advertises local reference paths on the executor, not Git checkouts inside workerd. Before model dispatch it materializes missing checkouts through the same environment connection used by file and shell tools. The executor image includes Git and CA certificates.

Paths live under `/tmp/ren-references/<session-id>/<repository-and-branch-hash>`. A change of repository or branch selects a different checkout; aliases can share the same checkout. Cloning uses an intermediate directory and moves it into place only after success. Operations are serialized within the cell. Each model request checks the environment again, so replacing the environment reconstructs missing checkouts.

The adapter denies edit, write and patch operations under these paths and tells the model to use a separate clone for changes. Shell access is not a filesystem sandbox. A clone failure is logged and can be retried on the next model request. A successful checkout is cached until its identity changes or the environment loses it; upstream branch changes are not continuously fetched.

The workerd/executor end-to-end journey serves a real local Git fixture, selects a non-default branch, reads its contents with the `read` tool, checks a write denial, replaces the environment and reads the reconstructed checkout. When the cell has no environment connection, it retains OpenCode's Git-reference behavior.

## Scope

Session instruction and permission overrides, per-turn attribution storage, task-board selection and Slack integration are not implemented by this contract. See the historical roadmap for the original proposals rather than treating it as an API guarantee.
