# Piece I: task routing

Status: spec written. Decisions: CH42, CH43 (README §4). Closes the TODO in `specs/tasks.md:195`.

## Goal

A message on a thread that a task links reaches the agent that holds the task, and keeps reaching it as the task moves between agents. A merged pull request closes the tasks that link it.

Not in this piece:

- How a link is added to a task: `specs/tasks.md` §Links (agents with `task_update`; the app shows links).
- Provider parsing of the merge event: piece H.

## Model

```
 ┌──────────────────┐  linkOf(event)          ┌──────────────────────┐  exactly one open task       ┌──────────────────────┐
 │                  │  (github_pr,            │                      │  with an agent?              │                      │
 │  ChannelRoute    │   acme/web#41)          │  Tasks               │ ───────────────────────────▶ │  route to the task   │
 │  step 0          │ ──────────────────────▶ │  openByLink(org,ref) │  yes                         │  space, agent,       │
 │                  │                         │                      │                              │  continue session    │
 └──────────────────┘                         └──────────┬───────────┘                              └──────────────────────┘
                                                         │ no, or two tasks
                                                         ▼
                                              normal routing (piece D step 1)

 ┌──────────────────┐  Parsed Signal          ┌──────────────────────┐
 │  GitHub          │  pull_request_merged    │  Tasks               │  every open task linking the PR → done
 │  pull_request    │ ──────────────────────▶ │  completeMerged      │  status event: automation github, url
 │  closed, merged  │  (ref, url)             │  (org, ref, url)     │
 └──────────────────┘                         └──────────────────────┘
```

## Contract changes

### Schema

- `Channel.Parsed` (piece A) gains `{ _tag: "Signal", signal: { kind: "pull_request_merged", install: string, link: TaskLink.Ref, url: string } }`. A signal starts no turn.
- `TaskEvent` `status` data gains an optional `automation: { provider: "github", cause: "pull_request_merged", url }`.

### Core

- `TaskLink.Kind` gains `github_issue` (CH45); `TaskLink.classify` reads `github.com/<owner>/<repo>/issues/<number>` into the key `<owner>/<repo>#<number>`.
- `ChannelProvider` (piece A) adds `linkOf(event)` → `Option<TaskLink.Ref>`, using the canonical keys of `TaskLink.classify` (`schema/src/task-link.ts:54`): Slack `<CHANNEL>:<thread ts>`, Linear `<workspace>/<KEY>`, GitHub `<owner>/<repo>#<number>` in lower case.
- `Task.Service` adds:
  - `openByLink(organizationId, ref)` → `Option<{ task, agentId }>`: the one live task in `todo` or `in_progress` that links `ref` and has an agent. Zero or several gives none.
  - `completeMerged(organizationId, ref, url)` → the IDs of the tasks set to `done`.

## Rules

### Routing

1. `ChannelRoute` runs this step before the mapping (piece D). It applies to a message only; a signal is handled by rule 9.
2. Exactly one open task with an agent links the thread: the space is the task's space and the agent is the task's agent. Otherwise normal routing (v1 `task/index.ts:908-920`).
3. A subtask's own links count. Its parent's links do not.
4. The sender check (piece C) runs against the task's space. The fallback user is the mapping's, when the place has a mapping and the fallback is on; else the installer. The fallback user must be a member of the task's space.
5. The session is the latest session of the task's agent on this task (`task_session`), as `task.start` `continue`. With none, Ren starts the task with `continue` (`specs/tasks.md` §Start): it opens a session with the start message, records `task_session`, writes the `started` event and sets `todo` to `in_progress`. Then the channel message follows in the same session.
6. The thread's `channel_thread` row moves to that session (CH42). Later messages on the thread repeat rule 2, so after a handoff they reach the new agent.
7. A failure to hand the message over sends one notice, "Couldn't hand this message to the task's agent. Try again in a moment.", and stops; it never falls back to normal routing (v1 `task-route.ts`, channels ledger row 41). The work runs in the span `Channels.routeTask` with the task ID as an attribute (channels ledger row 93).
8. A task whose agent is not usable in its space (archived agent) falls through to normal routing.

### Merge

9. GitHub's `parse` returns the signal for `pull_request` with action `closed` and `merged: true`. It reads the event before the bot-sender check, because a bot can merge (github ledger row 21). `closed` without a merge is `Ignore`.
10. `completeMerged` locks the open tasks of the install's organization that link the pull request, sets each to `done`, and writes a `status` event with the `automation` data. The actor is none; the trail shows "GitHub: pull request merged".
11. A task already `done`, `dismissed` or archived does not change. A repeated delivery therefore changes nothing (and piece A's run key already dedupes it).
12. A task with human review on still goes to `done`: the merge was the review.

## Lifecycle states

| State                      | What happens                                               |
| -------------------------- | ---------------------------------------------------------- |
| Task handed off mid-thread | The next message reaches the new agent's session (rule 6). |
| Task done or dismissed     | It is not open; the thread falls back to normal routing.   |
| Agent's session archived   | Rule 5 opens a new one with `continue` semantics.          |
| Brain asleep               | Piece A rules.                                             |

## Edge cases

| #   | Case                                                  | Rule                                                   | Source                  |
| --- | ----------------------------------------------------- | ------------------------------------------------------ | ----------------------- |
| 1   | Two open tasks link one PR.                           | Normal routing (rule 2).                               | `task/index.ts:917-919` |
| 2   | `/pull/41` and `/pull/41/files` links.                | Same key from `TaskLink.classify`.                     | channels ledger row 84  |
| 3   | A bot merges the PR.                                  | It counts (rule 9).                                    | github ledger row 21    |
| 4   | A PR closed without a merge.                          | Nothing changes.                                       | github ledger row 21    |
| 5   | The task's space differs from the channel's mapping.  | The task's space wins (rule 2).                        | CH42                    |
| 6   | The sender is in the channel's space, not the task's. | Fallback or refusal against the task's space (rule 4). | `301a65f13`             |
| 7   | Handing the message over fails.                       | One notice; no normal routing (rule 7).                | channels ledger row 41  |

## Tests

1. A comment on a PR that one open task links reaches the task agent's latest session, and the thread moves there.
2. After a handoff to another agent, the next comment reaches the new agent's session.
3. With no session for the agent, a start with `continue` runs first (`task_session`, `started` event, `in_progress`), then the message.
4. Two open tasks on one PR give normal routing.
5. A task with no agent gives normal routing.
6. The sender is checked against the task's space.
7. A failed hand-over sends one notice and does not fall back.
8. A merged PR sets each open linked task to `done` with the GitHub event; a done task does not change.
9. A close without a merge changes nothing; a bot merge counts.
10. A subtask's own link routes to the subtask; its parent's link does not.
