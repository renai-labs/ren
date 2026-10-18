# Agents: OpenCode facts

What the adapter relies on in OpenCode 2. Version `2.0.27` in `packages/cell`. Source read: `~/Documents/opencode`, branch `beta`. Main document: [v1.md](v1.md). Section numbers such as 9.1 point to [system design](system-design.md).

The document is written in ASD-STE100 Simplified Technical English.

## 1. Permissions

| Fact                                                                                                      | Source                                            | Used by  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------- |
| A rule is `{ action, resource, effect }`. Effect is `allow`, `ask` or `deny`. Both fields take wildcards. | `packages/schema/src/permission.ts`               | P2       |
| `evaluate` joins all lists and takes the last match. No match gives `ask`.                                | `packages/core/src/permission.ts` `evaluate`      | P7, 9.1  |
| `merge` is a plain join of lists. The sort in 9.1 makes the last match the strictest.                     | `packages/core/src/permission.ts` `merge`         | 9.1      |
| The rules of a call are the agent rules, then the session rules.                                          | `packages/core/src/permission.ts` `configured`    | 9.1      |
| A deny from the joined list stops before any hook.                                                        | `packages/core/src/permission.ts` `evaluateInput` | 9.2      |
| Plugins can change the effect through `permission.hook` `evaluate`.                                       | `@opencode/plugin` `effect/permission.d.ts`       | 9.2      |
| An MCP tool has the action `<server>_<tool>` and the resource `*`.                                        | `packages/core/src/tool/mcp.ts`                   | P9       |
| A tool is hidden when the last rule for its action has resource `*` and effect `deny`.                    | `packages/core/src/tool.ts` `whollyDisabled`      | P10, 9.2 |
| Starting a subagent checks the action `subagent` with the agent id as resource.                           | `packages/core/src/tool/plugin/subagent.ts`       | P2       |

## 2. Agents

| Fact                                                                                                           | Source                                        | Used by |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------- |
| An agent has `model`, `system`, `description`, `mode` (`primary`, `subagent`, `all`), `hidden`, `permissions`. | `packages/schema/src/agent.ts`                | A5, S7  |
| `agent.transform` gives `list`, `get`, `default`, `update`, `remove`. `update` creates a missing agent.        | `packages/core/src/agent.ts` editor `update`  | S7, 9   |
| A new agent starts with `* * allow`, ask for `external_directory`, and ask for `.env` reads.                   | `packages/schema/src/agent.ts` `Info.default` | P7      |
| The built-in agents come from the plugin `opencode.agent`.                                                     | `packages/core/src/plugin/agent.ts`           | S7      |

## 3. Subagent sessions

| Fact                                                                                         | Source                                               | Used by        |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------- |
| A child session gets no permissions from its parent session. Only its own agent rules apply. | `packages/core/src/tool/plugin/subagent.ts` `create` | S4             |
| Child model: the model of the call, then the agent model, then the parent model.             | `packages/core/src/tool/plugin/subagent.ts`          | S2             |
| An agent with mode `primary` cannot run as a subagent.                                       | `packages/core/src/tool/plugin/subagent.ts`          | A5             |
| The subagent tool lists only agents that the parent does not deny.                           | `packages/core/src/tool/plugin/subagent.ts` hook     | 6 (edge cases) |
| Default depth is 1. A subagent cannot start a subagent.                                      | `experimental.subagent_depth`                        | —              |

## 4. To check before the build

| ID  | Question                                                                           | Why                                          |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| O1  | Does `agent.system` replace the base prompt, or add to it?                         | Subagent instructions go into `system`.      |
| O2  | Does `session.switchModel` apply at the next step inside a running turn?           | L3.                                          |
| O3  | Does a change to instruction entries apply at the next step inside a running turn? | L3.                                          |
| O4  | Does `agent.reload` change the rules of a child session that runs now?             | S5, L3.                                      |
| O5  | Does `agent.reload` apply new agent permissions to a session that runs now?        | L3: permissions apply at the next tool call. |
