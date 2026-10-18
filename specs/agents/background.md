# Agents: background

How this design differs from ren-v1 and from the v2 plans written before it. Main document: [v1.md](v1.md).

The document is written in ASD-STE100 Simplified Technical English.

## 1. Sources

| Source                                                   | What we read                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ren-v1/docs/specs/ledgers/settings.md`                  | 111 rows of v1 agent and settings behavior, with v2 notes.                             |
| `ren-v1/docs/specs/MAP.md`                               | `Settings` and `AgentRoles` as v2 primitives. Decisions O1 to O23.                     |
| Notion: Brains and Hands — System Design, section Agents | Agent roles, the waterfall, sub agents, tasks and channels.                            |
| `ren-v1/registry/blueprints/pods/software-factory`       | Plan, Build, Review and QA as projects.                                                |
| `specs/brain-host-roadmap.md`                            | Instruction layers composed in core. Skills, MCP and agents through plugin transforms. |
| PR #32 (`session-sync`)                                  | `agent_session` with `space_id` and `start_input`.                                     |
| OpenCode 2 source                                        | See [OpenCode facts](opencode.md).                                                     |

## 2. ren-v1

| v1                                                                                                                            | v2                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| An agent is an object with semver versions, bindings and a latest pointer.                                                    | An agent is one current Settings. No versions.                                                                              |
| An agent binds skills and MCPs.                                                                                               | The space owns skills and MCPs. An agent only changes settings.                                                             |
| Projects and pods hold defaults.                                                                                              | Org defaults and space defaults.                                                                                            |
| Agent placements put agents into projects.                                                                                    | An agent has one owner space and is a member of other spaces.                                                               |
| The meta agent `ren` is a published agent in every project. Its prompt, model, skills and facade MCPs come from the registry. | Ren is a system Settings row. It applies only to sessions without an explicit agent. No skills, no MCPs, no special powers. |
| A base prompt by model size and `REN_INSTRUCTIONS` go into every session.                                                     | One Ren text, only for Ren sessions (N4, N5).                                                                               |
| The meta agent `ren` handles channels and hands off.                                                                          | No meta agent. Channels use defaults.                                                                                       |
| Permission maps with allow, ask and deny join by pattern. The last layer wins.                                                | Deny and ask only. The rules of all layers add up. The strictest match wins.                                                |
| Settings compose when the manifest builds.                                                                                    | Settings resolve on each change and reach running sessions.                                                                 |
| A missing model falls back to the next layer without an error.                                                                | A missing model is an error that names it.                                                                                  |

The v1 failures that this design keeps out:

- A strictest-effect join blocked narrow allows inside one layer (`58c93ff3f`). Here, there are no allow rules, so no merge can lose one (P11).
- Lists read without an order changed the prompt bytes and broke the prompt cache (settings ledger row 80). Here, resolve sorts every list and hashes the result.
- A silent model fallback hid configuration errors (settings ledger rows 6, 7). Here, M4 and M5 fail with the name of the model.

## 3. Brains and Hands (B&H)

| B&H                                                                        | This design                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| An agent role is owned by one user group.                                  | An agent is owned by one space and is a member of many spaces (A4).       |
| Settings also hold harness, sub agent model, effort, skills and apps.      | Settings hold instructions, model and variant, and permissions only (A1). |
| Effort is a separate field.                                                | Model and variant are one unit (M1).                                      |
| No permission field. Access is grants and the audience intersection.       | Permissions are a field of Settings (P1).                                 |
| Final settings are frozen at chat start.                                   | Settings are live (L1).                                                   |
| A role mode is agent, sub agent or both.                                   | One flag, `isSubagent` (A5).                                              |
| A sub agent without a role uses the chat settings and the sub agent model. | A subagent is always an agent that is a member of the space (S1, S2).     |
| An agent role version is a content hash.                                   | No versions. The hash is on the resolved settings, for change detection.  |

## 4. v2 plans before this design

| Plan                                                                                                    | This design                                                                  |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Brain-host roadmap: org, space, agent and session instructions, with set, append, unset or lock by key. | Append only, fixed keys (I1 to I3). Lock is a later Layer.                   |
| Brain-host roadmap: `start` carries only the composed result.                                           | Kept. The cell gets resolved settings only (D3).                             |
| Environments end state D28: the `environment` permission is set per space, brain or session.            | The permission layers of this design carry it. It is a normal rule.          |
| `StartInput.agent` names an OpenCode agent.                                                             | Removed. `StartInput.settings` replaces `agent`, `model` and `instructions`. |
