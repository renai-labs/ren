# Agents: edge cases

> Historical expectations for the original proposal. The [current contract](contract.md) supersedes this table where it differs; these rows are not a current acceptance-test list.

Each case gives the expected behavior and the decision it comes from. Main document: [v1.md](v1.md). Cases marked PE are proposed expectations that need approval.

The document is written in ASD-STE100 Simplified Technical English.

## 1. Agents, ownership and membership

| Case                                                                    | Expected                                                                                     | Source |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| A member opens the picker in a space with no primary agents.            | The picker shows only "Ren".                                                                 | W8     |
| A member asks for an agent that is not a member of any of their spaces. | `NotFound`. The member does not learn that the agent exists.                                 | O3     |
| A member of a non-owner space edits an agent.                           | `Forbidden`. They can read its settings.                                                     | C3, O4 |
| A member creates an agent in a space they are not in.                   | `NotFound` for the space.                                                                    | C3     |
| Two agents in one org get the same name.                                | `Conflict`.                                                                                  | A8     |
| A member adds an agent to a space they are not a member of.             | `Forbidden`, unless they are an org admin.                                                   | C4     |
| An agent is added to its owner space.                                   | Nothing changes. The owner is always a member. No row is written.                            | O1, O2 |
| An agent is added to the same space twice.                              | The second add returns the existing membership.                                              | PE     |
| An attempt to remove the owner space membership.                        | `Conflict`. Move ownership first, or archive the agent.                                      | O1     |
| Ownership moves to a space that is already a member.                    | Its membership row goes. The old owner gets a membership row.                                | O5     |
| Ownership moves to a space that is not a member.                        | It becomes owner and member. The old owner gets a membership row.                            | O5     |
| A space that owns a live agent is archived.                             | `Conflict`. The error names the agents.                                                      | O6     |
| An agent is archived.                                                   | Its memberships go in the same transaction. Running sessions continue as Ren with overrides. | A6, W9 |
| An agent changes from primary to subagent while sessions use it.        | Those sessions continue as Ren. It shows in the subagent list of its spaces.                 | PE, Q4 |
| An agent moves to a new owner. A session in a third space uses it.      | No change. Membership decides, not ownership.                                                | PE, Q6 |

## 2. Waterfall

| Case                                                      | Expected                                                                                  | Source |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| No org row, no space row, no agent, no overrides.         | Ren's instructions and model. No rules.                                                   | N1, P7 |
| An agent session. No layer sets a model.                  | Ren's model. Ren's instructions are not sent.                                             | N6     |
| The Ren row is changed by an operator.                    | Every Ren session gets it at its next step. Agent sessions get only a new fallback model. | L1, N5 |
| A layer has `instructions` as an empty text.              | The key is not sent. An empty text is the same as no text.                                | PE     |
| The space sets a model. The agent sets none.              | The space model wins.                                                                     | M2     |
| The agent sets a model. A member edits the session model. | The session model wins. The UI shows `Build · edited`.                                    | M2, W5 |
| A member edits the session after its agent is archived.   | The edit works. The session shows as Ren with its overrides.                              | W9, T5 |
| A member tries to change the agent of a running session.  | Refused. The agent is fixed at start.                                                     | W2     |

## 3. Model

| Case                                                             | Expected                                                            | Source |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| A write names a model that is not in the catalog.                | Refused. The error names the model.                                 | M4     |
| A write names a variant that the model does not offer.           | Refused. The error names the model and the variant.                 | M4     |
| The resolved model leaves the catalog while the session is idle. | The next turn fails. The error names the model.                     | M5     |
| The resolved model leaves the catalog during a turn.             | The next step fails with the same error.                            | M5, L3 |
| Ren's model is not in the catalog.                               | The start fails. The operator fixes the row.                        | PE, Q5 |
| The catalog is not available at resolve.                         | `Models.Unavailable`. It is not the same error as an unknown model. | PE     |

## 4. Permissions

| Case                                                                        | Expected                                                             | Source |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| A write has a rule with effect `allow`.                                     | Refused. Only `ask` and `deny` exist.                                | P11    |
| Space: `shell "git push*" deny`. Agent: `webfetch * ask`.                   | Both apply. `git push` is denied. `webfetch` asks.                   | P5     |
| Org: `webfetch * ask`. Session: `webfetch * deny`.                          | Deny. The stricter match wins.                                       | P5     |
| Two layers have the same rule.                                              | It applies once. The union removes duplicates.                       | P5     |
| No rule matches.                                                            | Allow.                                                               | P7     |
| A headless session meets `ask`.                                             | Deny, with a message that tells the model why.                       | P8     |
| A rule names an MCP that the space does not have.                           | No effect.                                                           | P9     |
| One layer has `linear_* * deny`.                                            | The model does not see the Linear tools.                             | P10    |
| One layer has `shell * deny` and another has `shell "git push*" deny`.      | The model does not see `shell`. The `*` deny is last after the sort. | P10    |
| One layer denies `shell` only for `git push*`.                              | The model sees `shell`. Only that call is denied.                    | P10    |
| The space adds a new MCP. A read-only agent has denies for edit tools only. | The agent can call the new MCP. Deny lists do not block new tools.   | P11    |
| A member removes a rule that the member added to the session layer.         | The rule goes. Rules of other layers stay.                           | PE, Q3 |
| A rule list has a malformed rule (empty action).                            | Refused at write. The cell never gets it.                            | PE     |

## 5. Live settings

| Case                                                            | Expected                                                                   | Source |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| An admin changes the org model while 3 sessions run.            | Each session uses the new model at its next step.                          | L1, L3 |
| A push fails.                                                   | The write succeeds. The cell gets the change at its next pull.             | L2     |
| A push and a pull deliver the same version.                     | The cell applies it once.                                                  | PE     |
| A push arrives with an older version than the cell has.         | The cell ignores it. The version must be ordered, or the cell pulls again. | PE     |
| A space change affects 1000 sessions, and 10 cells are open.    | Push only to sessions with recent activity. The rest pull when they open.  | PE     |
| Two members edit the overrides of one session at the same time. | The second write that names an old version gets `Conflict`.                | PE, Q2 |
| A permission becomes stricter during a tool call.               | The running call completes. The next call uses the new rules.              | L3     |
| A subagent runs when the parent session permissions change.     | The subagent uses the new rules at its next tool call.                     | S5, L3 |

Open: the window for "recent activity". Proposal: a session with a message or a host request in the last 15 minutes.

## 6. Subagents

| Case                                                         | Expected                                                                      | Source |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------ |
| A space has no subagents.                                    | No subagent tool.                                                             | S6     |
| A subagent joins the space while a session runs.             | The main agent can start it after the next push or pull.                      | S1, L1 |
| A subagent is detached while its child session runs.         | The child finishes its turn. It cannot start again.                           | PE     |
| The parent denies `shell`. The subagent has no `shell` rule. | Denied in the subagent. The rules of the parent apply.                        | S4     |
| A layer has `subagent explore deny`.                         | The main agent cannot start `explore`. The tool description does not list it. | P2     |
| A subagent sets no model.                                    | Space model, then org model, then Ren's model. Not the main agent's model.    | S2     |

## 7. Built-in OpenCode agents

| Case                                          | Expected                                                   | Source |
| --------------------------------------------- | ---------------------------------------------------------- | ------ |
| A session opens.                              | `build`, `plan`, `general` and `explore` are gone.         | S7     |
| OpenCode makes a title or a compaction.       | The hidden helpers work, with the session model.           | S7     |
| An upstream update adds a new built-in agent. | A test lists the agents after open and fails on a new one. | PE     |
