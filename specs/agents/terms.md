# Agents: terms

The terms and marks that the documents in this folder use. The main document is [v1.md](v1.md).

The document is written in ASD-STE100 Simplified Technical English.

## 1. Terms

| Term              | Meaning                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Settings          | Instructions, a model with its variant, and permissions. Org defaults, space defaults, agents and session overrides have this shape. |
| org defaults      | The Settings of an organization. There is one for each org.                                                                          |
| space defaults    | The Settings of a space. There is one for each space.                                                                                |
| agent             | A Settings with a name, a description and the flag `isSubagent`. It belongs to the org.                                              |
| primary agent     | An agent with `isSubagent` false. A user selects it when a session starts.                                                           |
| subagent          | An agent with `isSubagent` true. The main agent starts it during a session.                                                          |
| Ren               | The agent of every session with no explicit agent. A system Settings row that operators seed.                                        |
| owner space       | The one space that owns an agent. Its members edit the agent. It is always a member.                                                 |
| membership        | An agent in a space that is not its owner. The agent is available in a space only as owner or member.                                |
| session overrides | The Settings that people put on one session after it starts.                                                                         |
| layer             | One step of the waterfall: Ren, org defaults, space defaults, agent, or session overrides.                                           |
| attribution       | The agent or Ren that a turn belongs to, with the overrides of that turn.                                                            |
| waterfall         | The order of the layers, and the rules that combine them.                                                                            |
| resolve           | Calculate the settings of a session from its layers.                                                                                 |
| resolved settings | The result of resolve. The cell gets only this.                                                                                      |
| rule              | One permission: `{ action, resource, effect }`.                                                                                      |
| rule list         | A set of rules. The order has no effect. OpenCode calls this a ruleset.                                                              |
| effect            | `ask` or `deny`. Allow is the default, not a rule.                                                                                   |
| strictest         | A matching `deny` wins over a matching `ask`. With no match, the call is allowed.                                                    |
| headless session  | A session that nobody watches, for example a schedule. The start input has `interactive` false.                                      |
| cell              | The Durable Object that holds the brain (OpenCode) of one root session and its subagents.                                            |
| adapter           | The code in the cell that changes resolved settings into calls to one harness. Today the harness is OpenCode.                        |
| push              | Ren sends new resolved settings to a cell that is open.                                                                              |
| pull              | The cell asks Ren for the resolved settings.                                                                                         |
| step              | One model call or one tool call inside a turn.                                                                                       |
| turn              | The work of the brain from one user message until the session is idle.                                                               |

## 2. How we made a decision

| How        | Meaning                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| EXPLICIT   | We asked a question, and the product owner gave the answer.                                           |
| CONSTRAINT | The product owner gave a rule without a question.                                                     |
| IMPLICIT   | The design needs it, and nobody objected. It comes from an explicit decision. **Review these first.** |
| CHANGED    | A later answer replaced an earlier answer. The table shows both.                                      |
