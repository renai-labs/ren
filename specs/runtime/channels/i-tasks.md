# Piece I: task routing

Status: built (step 10). Decisions: CH42, CH43, CH51, CH52 (README §4). Closes the TODO in `specs/tasks.md:195`.

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

- `Channel.Parsed` (piece A) gains `{ _tag: "Signal", signal: Channel.Signal }`, with `Channel.Signal` = `{ kind: "pull_request_merged", install, link: { kind, key }, url }`. A signal starts no turn.
- `TaskEvent` `status` data gains an optional `automation: TaskEvent.Automation` = `{ provider: "github", cause: "pull_request_merged", url }`.
- `TaskLink.Kind` gains `github_issue` (CH45); `TaskLink.classify` reads `github.com/<owner>/<repo>/issues/<number>` into the key `<owner>/<repo>#<number>`.
- `Channel.FailureReason` gains `task_handoff` (rule 7).

### Core

- `ChannelProvider` (piece A) adds `linkOf(event)` → `Option<TaskLink.Ref>`, using the canonical keys of `TaskLink.classify` (`schema/src/task-link.ts`): Slack `<CHANNEL>:<thread ts>`, Linear `<workspace>/<KEY>`, GitHub `<owner>/<repo>#<number>` in lower case. GitHub classifies the thread URL.
- `TaskQueries.openByLink(transaction, organizationId, ref)` finds the one live, assigned task in `todo` or `in_progress` that links `ref`, then checks its agent is usable. Zero or several assigned tasks gives none, even if one agent is unusable. The result includes task context and the latest session of that agent on the task. It is a query, not a `Task.Service` method, so `ChannelRoute` keeps only `Database`, `ChannelIdentity` and the provider registry.
- `Task.Service.completeMerged(organizationId, ref, url)` → the IDs of the tasks set to `done`.
- `ChannelRoute.Route` gains `task?: { id, sessionId? }`. `Channels` depends on `Task.Service`.

## Rules

### Routing

1. `ChannelRoute` runs this step before the mapping's space and agent (piece D). It applies to a message only: a signal is handled by rule 9, and a trigger (CH50) keeps the mapping's route (CH51).
2. Exactly one open task with an agent links the thread: the space is the task's space and the agent is the task's agent. Otherwise normal routing (v1 `task/index.ts:908-920`).
3. A subtask's own links count. Its parent's links do not.
4. The sender check (piece C) runs against the task's space. Only the place's mapping can supply a fallback user; an unmapped linked thread has no fallback. The fallback user must be a member of the task's space.
5. The session is the latest session of the task's agent on this task (`task_session`), as `task.start` `continue`. With none, the incoming message and task context form one non-interactive initial turn, as in v1. Ren records `task_session` and a `started` event with mode `new`; receiving a channel message does not itself change the task status. There is no separate task-assignment turn. The event's durable session ID is reused on retries. Existing sessions receive the message with `delivery: "steer"` (CH52).
6. The thread's `channel_thread` row moves to that session (CH42); a move clears `last_reply_at`. Later messages on the thread repeat rule 2, so after a handoff they reach the new agent.
7. A failure to hand the message over sends one notice, "Couldn’t hand this message to the task’s agent. Try again in a moment." (`task_handoff`), and stops; it never falls back to normal routing (v1 `task-route.ts`, channels ledger row 41). A failure is a refused start (`Primitive` errors) or a brain that rejects the message; a failed brain keeps its `brain_failed` notice, and a brain that is unavailable is retried (CH8). The work runs in the span `Channels.routeTask` with the task ID as an attribute (channels ledger row 93).
8. A task whose agent is not usable in its space (archived agent) falls through to normal routing.

### Merge

9. GitHub's `parse` returns the signal for `pull_request` with action `closed` and `merged: true`. It reads the event before the bot-sender check, because a bot can merge (github ledger row 21). `closed` without a merge is `Ignore`.
10. `Channels.receive` handles a signal before it answers: it finds the install's organization and calls `completeMerged` in one transaction, then answers 200; a failure answers 500. No `ChannelEvent` run: the write is durable when the 200 goes out (CH5), and rule 11 makes a repeat harmless. A signal of a workspace with no install is logged and answered 200.
11. `completeMerged` locks the open tasks of the install's organization that link the pull request, sets each to `done`, and writes a `status` event with the `automation` data. The actor is none; the trail names GitHub as the actor and says "Pull request merged. Changed status from … to Done."
12. A task already `done`, `dismissed` or archived does not change. A repeated delivery therefore changes nothing.
13. A task with human review on still goes to `done`, and its review flag clears: the merge was the review.

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
3. With no session for the agent, one non-interactive initial turn contains the message and task context; `task_session` and a `started` event are recorded without changing status.
4. Two open tasks on one PR give normal routing.
5. A task with no agent gives normal routing.
6. The sender is checked against the task's space.
7. A failed hand-over sends one notice and does not fall back.
8. A merged PR sets each open linked task to `done` with the GitHub event; a done task does not change.
9. A close without a merge changes nothing; a bot merge counts.
10. A subtask's own link routes to the subtask; its parent's link does not.

Built as `core/test/channels.test.ts` "Channels and tasks" (tests 1 to 8; test 2 covers 3), `core/test/github.test.ts` (test 9 and `linkOf`) and `schema/test/task.test.ts` (`github_issue`). Test 10 is not written: the link query matches `task_link.task_id` only, so no parent link can match.
