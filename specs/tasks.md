# Tasks and the agent factory

Status: proposal. Nothing here is built. Linear: [REN-1442](https://linear.app/renai/issue/REN-1442/tasks).

A task is a unit of work that moves between the agents of a space. A space is the factory: its agents, in an order that the space sets, are the stages that a task moves through. This spec ports the task primitive of ren-v1 to v2 and adds what a factory needs: a human review flag, labels, subtasks, a board in factory order, and the data for a factory dashboard.

The v1 sources are `ren-v1/packages/api/src/task/` (start at `CLAUDE.md`), the v1 behaviour ledger `ren-v1/docs/specs/ledgers/tasks.md`, and the v1 UI in `ren-v1/packages/app/src/features/tasks/`. Where this spec says "as in v1", the v1 behaviour holds and the ledger row numbers (`L12`) give the detail.

## Terms

- **Task**: a record of one piece of work. It belongs to one space.
- **Agent** of a task: the agent that has the task now. It sets the task's board column. A task can have no agent.
- **Owner**: the human who is responsible for the task. A task can have no owner.
- **Factory order**: a space setting. It is an ordered list of the space's agents, for example Plan, Build, Review, QA. It sets the column order of the board and the stage order of the dashboard. It does not limit which agent can have a task.
- **Handoff**: an agent gives the task to another agent.
- **Visit**: the time from one assignment of an agent to the next change of agent. The trail derives it; nothing stores it.
- **Human review**: a flag on the task. When it is on, the task waits for a human.
- **Turn**: who must act next. Ren derives it; nothing stores it ([Who has the turn](#who-has-the-turn)).

There is no stage entity. A stage is an agent in the factory order.

## Scope and phases

| Phase        | Contents                                                                                                                                                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. v1 parity | Task, labels, links, comments, the trail, identifiers, assign and start, agent tools, the list, board and detail UI. Includes the human review flag, the factory order, and the board in factory order, because the status model depends on them. Records the data that the dashboard needs. |
| 2. Factory   | Subtasks, drag and drop on the board, a handoff to "the next agent in the order".                                                                                                                                                                                                            |
| 3. Later     | The factory dashboard (a separate spec). The agent graph DSL (back edges, loop counts). Channel routing to tasks. GitHub merge sets `done`.                                                                                                                                                  |

Out of scope: budgets and billing, product analytics (v1 L99), realtime push (the app polls, as in v1), and a board across spaces.

## Status

Status describes the whole task, never one agent. It answers one question: did the work start, and did it finish?

| Status        | Meaning                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| `todo`        | No one started the work.                                                                    |
| `in_progress` | The work started and is not finished.                                                       |
| `done`        | The work is finished.                                                                       |
| `dismissed`   | No one will do the work. It stays readable, so an agent does not suggest it again (v1 L30). |

Rules:

1. A new task is `todo`.
2. The first start by any agent sets `todo` to `in_progress`. A human or an agent can also set `in_progress`.
3. A handoff does not change the status. A task that waits for its next agent is still `in_progress`.
4. Only a human sets `done` or `dismissed`. An agent tool refuses both values. Later, a merged GitHub pull request that the task links sets `done` with the actor "system" (phase 3; v2 has no GitHub integration yet).
5. Nothing sets `todo` again automatically. A human can reopen a task to `todo` or `in_progress`.
6. When the status becomes `done` or `dismissed`, Ren turns human review off.
7. The actionable statuses are `todo` and `in_progress`. The default list shows them (v1 L32).

v1 had `in_review`. The human review flag replaces it, because a task can be in progress and wait for a human at the same time. v1 had `open`; v2 calls it `todo`, which is the label that the v1 UI already showed.

## Human review

An agent needs a person in one of two cases:

| Case                       | Example                                              | How Ren handles it                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A question during the work | "Which identity provider?" "The API key is missing." | The session's question tool or permission request, which exists already. The task derives "Needs you" from the session's state and shows the question; the answer goes into the session. No flag. |
| A review of finished work  | "Plan approval." "Ready to merge."                   | The human review flag, below.                                                                                                                                                                     |

The task stores two fields: `humanReview` (boolean) and `humanReviewReason` (text, null when off). The reason says why a person must act and what to look at, for example "Plan approval. The plan is in the description; open risks: SCIM, MFA." Its first line is what the "Needs you" list shows.

- An agent turns review on with the `task_review` tool and a reason, then ends its turn. The session does not wait: a review can take days.
- A person can also turn review on, with a reason.
- Only a person turns review off, with a decision: **Approve** (optional comment) or **Request changes** (comment required). Any member of the space who can write to the task decides; the owner is shown as the person expected to act. A message in the agent's session does not close the review.
- Mark done, dismiss and removing the agent are the normal task actions. They also turn review off, with no decision.
- Before deciding, a person can do anything: comment, edit the description, chat in the session, or check the pull request.
- The decision takes `start: "continue" | "none"`. With `continue`, Ren continues the agent's latest session with a message: the decision, the comment, and whether the description changed after the request. With `none`, the agent stays idle until someone starts it.
- The default is `continue` for now. We want to try both, so the default lives in one place in core, `Task.reviewStart`, and no other code assumes it. When the `FeatureFlags` service exists ([runtime plan §2.8](runtime/plan.md#28-feature-flags)), a flag targeted by space replaces the constant, and the flag is listed in [runtime/README.md](runtime/README.md#feature-flags). The app sends no `start` unless the user changes it, so it follows the default.
- Review does not block a handoff. It is a signal for people, not a lock.
- Turning review on again with the same reason changes nothing. A decision when no review is open is refused with a conflict.
- Turning review on writes a `review_requested` event with the reason. A decision writes a `reviewed` event with the decision and the comment. The comment is stored only on the event. The dashboard takes the "Human" time from the time between the two events.

## Who has the turn

The app shows one line for each task, derived from five signals: the status, the agent, the owner, human review, and the state of the agent's last session for this task (working, idle, error).

1. Human review is on, or the agent's session waits on a question or a permission: a human has the turn. This is the owner, or any member of the space if there is no owner.
2. Else, the task has an agent and that agent's session is working: the agent has the turn and is active.
3. Else, the task has an agent: the agent has the turn but is not working. The card shows "Idle", or "Stopped" when the session ended in an error.
4. Else, the status is `in_progress`: the owner has the turn.
5. Else: no one has the turn.

A human who works on the task in person removes the agent (rule 4). Ren cannot see work that happens outside Ren.

### Scenarios

| #   | What happens                               | Agent  | Session | Human review | Status      | Card shows                   |
| --- | ------------------------------------------ | ------ | ------- | ------------ | ----------- | ---------------------------- |
| 1   | A user creates the task                    | none   | none    | off          | todo        | Not started                  |
| 2   | The user gives it to Plan, no start        | Plan   | none    | off          | todo        | Plan · Not started           |
| 3   | The user starts Plan                       | Plan   | working | off          | in_progress | Plan is working              |
| 4   | Plan asks for plan approval                | Plan   | idle    | on           | in_progress | Needs Shrey · Plan approval  |
| 5   | Shrey approves and turns review off        | Plan   | working | off          | in_progress | Plan is working              |
| 6   | Plan hands off to Build                    | Build  | working | off          | in_progress | Build is working             |
| 7   | Build hands off to Review                  | Review | working | off          | in_progress | Review is working            |
| 8   | Review sends it back to Build              | Build  | working | off          | in_progress | Build is working             |
| 9   | Build stops with an error                  | Build  | error   | off          | in_progress | Build stopped                |
| 10  | Shrey removes the agent and works himself  | none   | none    | off          | in_progress | Shrey is working             |
| 11  | Shrey gives it back to Build and starts it | Build  | working | off          | in_progress | Build is working             |
| 12  | QA passes and asks for a merge             | QA     | idle    | on           | in_progress | Needs Shrey · Ready to merge |
| 13  | Shrey merges and marks it done             | QA     | idle    | off          | done        | Done                         |
| 14  | Shrey dismisses a task                     | any    | any     | off          | dismissed   | Dismissed                    |

## Agents and the factory order

- A task's agent is any primary agent (not a subagent) that is usable in the task's space: an agent that the space owns, an agent shared into it through `agent_membership`, or the global `ren` agent. `ren` is always usable, in every space.
- The factory order is a new space field, `agentOrder`: an ordered list of agent IDs. Each ID must be usable in the space; an update with any other ID is refused, and a repeated ID counts once. `ren` is in the order only if a user adds it. When no ID in the stored list is usable and the space owns no live primary agent, the order is the live global primary agents, which today is `[ren]`.
- `agentOrder` holds plain strings, not `Agent.ID`: `schema/agent` imports `schema/space`, so `Space.Info` cannot import `Agent.ID` without an import cycle.
- A read drops IDs that are no longer usable (an archived agent, an agent no longer shared). It does not rewrite the stored list.
- Only a user who can update the space changes the order.
- An agent that someone archives stays on its tasks. The UI shows it as archived, and a start is refused (v1 L104).

The factory order is not enforced in this iteration. Any agent can hand off to any usable agent. The DSL in phase 3 adds edges and limits. Until then, the space instructions (`Settings.instructions` of the space) describe the flow, as the v1 software-factory blueprint did, and the start message lists the order ([Start message](#start-message)).

## Assignment, handoff and start

### Assign

`task.assign` sets the agent, the owner, or both. A `null` clears a field. A call with neither field is refused (v1 L61).

| Input     | Meaning                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agentId` | The new agent, or `null` for none.                                                                                                                                                                                                   |
| `ownerId` | The new owner, or `null` for none. The owner must be a member of the task's space (v1 L62).                                                                                                                                          |
| `spaceId` | Moves the task to another space. Needed when the new agent is not usable in the current space. The caller must be a member of both spaces. An owner who is not a member of the new space is cleared, and the reply says so (v1 L64). |
| `note`    | The instruction for the receiving agent.                                                                                                                                                                                             |
| `start`   | `new`, `continue` or `none`. The default is `continue` when the agent changes, else `none` (v1 L66).                                                                                                                                 |

- **The description stays.** v1 replaced the description with the handoff instruction (v1 L65). v2 stores the `note` on the `assigned` event, shows it in the trail, and puts it in the start message. The original request is kept.
- The reply has the task, a one-line `message` that says what changed and whether an agent started, and `started` (the session, or null) (v1 L67).
- If the start fails after the assignment commits, the reply still succeeds, with `started: null`, and the message says to retry `task.start` (v1 L68).
- An agent that hands off uses the default, so the next agent starts. The app always sends `start: "none"` and offers a separate Start button. This matches "an agent's handoff starts; a human chooses".
- A subtask moves with its parent and cannot move alone ([Subtasks](#subtasks-phase-2)).

### Start

`task.start` with `mode: new | continue` starts the task's agent on it.

- It needs an actionable task (`todo` or `in_progress`) with an agent that is live and usable in the task's space. Else it is refused with a conflict.
- `new` always opens a new session (v1 L69).
- `continue` resumes the latest live session of this agent on this task, in the task's current space, or opens a new one when none exists. It is never an error (v1 L70, L71). The start message joins the session's queue, so it waits for a turn that is running.
- Each agent continues in its own session. Plan, then Build, then Plan again resumes the first Plan session (v1 L72).
- A start records the session in `task_session` and writes a `started` event with the initiator as actor and the agent, session and mode as data (v1 L79). The rows are written only after the host accepts the start, so a failed start records nothing (v1 L73).
- The first start sets `todo` to `in_progress` in the same transaction, with a `status` event after the `started` event.
- A task that an agent creates records the agent's session in `task_session` (v1 L73, L74), so a later `continue` of that agent resumes it.
- A session for the global `ren` agent is a session with no `agentId`, as today. `task_session.agent_id` still stores the `ren` agent ID, so that lookups and usage work for `ren` as for any agent.

### Start message

The start message is the first user message of a new session, or the next message of a continued one. As in v1 (v1 L80), it holds the task identifier, ID, title and description, in a `<task_assignment>` block. v2 adds:

- the `note` of the latest handoff, when there is one;
- the factory order of the space, as names and descriptions, so that the agent knows whom to hand off to;
- the decision and comment, when a person decides a review.

The note in the block says: read the task and its trail with `task_get`; work your part; when your part is complete, hand off with `task_assign`; when a person must decide, use `task_review`; never set `done` or `dismissed`; do not create a second task for the same work.

## Agent tools

v2 agents have no way to call Ren today. Tasks stay in `core` and the public API: neither `RenHostApi` nor the harness in `cell` holds task code. The tools come from the Ren MCP, a later pull request, as in v1: `server` serves it at `/mcp`, each tool is an operation of the public API with its dots changed to underscores (`task.get` is `task_get`), and a tool call runs the same handler and access checks as the public route. The MCP's token names the agent's session, and `Actor.fromSession` turns it into the actor: the session creator's membership, the session's agent and its space (v1 L41, L74).

| Tool           | Does                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `task_list`    | Lists tasks, with the filters of `task.list`, including `linkedTo` (v1 L87).                                          |
| `task_get`     | Gets a task and its timeline.                                                                                         |
| `task_create`  | Creates a task. It records the creating agent and session. It never starts an agent (v1 L24).                         |
| `task_update`  | Changes the title, description, priority, labels, due date and links, and sets the status to `todo` or `in_progress`. |
| `task_assign`  | Hands off, as `task.assign`.                                                                                          |
| `task_review`  | Turns human review on with a reason.                                                                                  |
| `task_comment` | Adds a comment.                                                                                                       |
| `label_list`   | Lists labels.                                                                                                         |

An agent reads and writes only the tasks of its own session's space. This is narrower than v1, where an agent reached every space of the session's creator (v1 L5). So an agent cannot move a task to another space: its access covers only its session's space, and `Task.assign` accepts only agents usable there. A human moves a task between spaces. An agent list must never be empty only because the caller is an agent (v1 L6).

Core's `Actor.Info` names only a user today. Task operations take an actor that is a user, or a user plus an agent and a session. Events and comments store both.

## Labels

As in v1 (v1 L89–L97):

- A label has a name (1–64 characters after trim, unique per organization ignoring case among live labels) and an optional color `#rrggbb`.
- Labels belong to the organization.
- Two system labels exist in every organization with fixed IDs: `ren-improve` (shown as "improvement") and `ren-fix` (shown as "fix"). No one changes or archives them. Other `ren-*` names are reserved.
- A caller passes label names. Each name reuses a live label or creates one. The set is replaced in one transaction. A task has at most 16 labels.
- Archiving a label removes it from every task.

## Links

As in v1 (v1 L81–L88): a task links GitHub pull requests, Linear issues, Slack threads and plain URLs. Each link has a kind and a canonical key; the pair (task, kind, key) is unique. Links change only with `addLinks` and `removeLinks`. A task has at most 32 links. The `link` events are the only record of who added or removed a link; a link row has no creator. Creating a task with links writes a `link` event for them, by the creator. The app shows links but does not add them (v1 parity).

**TODO (channels):** v1 routes a message in a linked thread to the task's agent (v1 hand-offs). v2 has no channels yet. Links are stored now; routing comes with channels.

## Subtasks (phase 2)

v1 has no subtasks. v2 adds them with the smallest model:

- A task can have a parent (`parentId`). Only one level: a subtask cannot have subtasks, and a task that has live subtasks cannot become one. A task is never its own parent.
- `create` and `update` set the parent; `update` with `parentId: null` makes a subtask a task of its own. A change writes a `parent` event on the subtask only. The parent's trail does not change.
- A subtask is in its parent's space, always. The database holds this: the parent key is (`parent_id`, `space_id`), and it cascades a parent's move to its subtasks. A parent from another space is refused.
- `assign` with a `spaceId` moves a parent and all its subtasks, archived ones included. Each live subtask gets an `assigned` event. A subtask's agent that is not usable in the new space is cleared, which turns its human review off, and a subtask's owner who is not a member of the new space is cleared. A subtask cannot move alone.
- A subtask has its own agent, owner, status, human review, priority, labels, due date and links. It moves through the factory on its own. Its links are its own, so a pull request that a subtask opens links to the subtask, and `linkedTo` finds the task that owns the link. When channels exist, routing can also look at the parent's links.
- The parent's status is not derived from its subtasks. Closing a parent leaves its subtasks as they are. `Task.Info.subtasks` holds the count, `{ total, done }`, for example "2 of 5 done": it counts live subtasks, leaves out dismissed ones, and is null when the task has no live subtasks. A subtask's `parent` holds the parent's ID, identifier and title.
- Archiving a parent archives its live subtasks, each with an `archived` event.
- The start message does not name the parent or the subtasks; an agent reads them with `task_get` and `task_list`.
- A subtask's sessions link to the subtask in `task_session`. The dashboard spec decides how a parent's totals include its subtasks; the data supports both views.
- Concurrent changes lock the parent row before a subtask row, so a task never gets a subtask while it becomes one.

## Comments and the trail

As in v1, with the changes that the ledger marks:

- A comment is Markdown, 1–20,000 characters, not blank. Only its author edits or archives it. An edit sets `editedAt` (v1 L51–L57).
- A comment's author is a user, or a user plus an agent and a session (v1 L58).
- Events are append-only and live in `task_event` (v1 L37, L39). An event's actor is a user, a user plus an agent and session, or the system.
- Event kinds: `created`, `assigned`, `started`, `status`, `review_requested`, `reviewed`, `field`, `label`, `link`, `parent` (phase 2), `archived`. v1's single `updated` event with a list of changes splits by kind (v1 L29).
- A change that changes nothing writes no event (v1 L27). A change and its event commit in one transaction, with the task row locked (v1 L28, L36).
- `assigned` stores the previous and new agent, the previous and new owner, and the note (v1 L44).
- One read, the `task-activity` list, returns events and comments, interleaved by (time, ID), oldest first (v1 L46, L52). New activity goes on the last page, so the earlier pages never move; this fixes v1 L49 with the standard page pagination.

## Identifiers

As in v1 (v1 L14–L19): each task has a permanent number in its organization, from 1. The identifier is the uppercase organization slug, a dash and the number, for example `RENAI-123`. One counter serves all spaces of an organization. The prefix is copied once from the slug, so a rename does not change it. A number is never reused. Concurrent creates never get the same number.

## Data for the factory dashboard

The dashboard has its own spec, written before it is built. The REN-1442 mock shows, for one space and a period: counts in a sentence, the cost, a daily activity grid, a "Needs you" list, and time, cost, tokens and runs for each stage, as an average per task.

This spec only makes sure that phase 1 records the data. How the dashboard computes its numbers can change later without a migration. This is how each number can come from the recorded data:

| Number                    | Source                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time per agent            | The visits of each agent, from `assigned` events, minus the time with human review on.                                                                                    |
| Human time                | The time from each `review_requested` event to the next `reviewed` event or status change.                                                                                |
| Time with no agent        | Not counted. The factory has not picked up the task yet.                                                                                                                  |
| Cost and tokens per agent | `opencode_session` rows of the sessions in `task_session` for that agent, plus their child sessions (by `root_id`).                                                       |
| Model per agent           | `opencode_session.model`. This is the session's last model. A breakdown by message needs the model of each message (`opencode_message.data`), which is opaque text today. |
| Runs per agent            | `started` events.                                                                                                                                                         |
| Counts in the sentence    | Decided in the dashboard spec. Handoffs out of each agent are one option.                                                                                                 |
| Needs you                 | Actionable tasks with human review on, oldest first, with the reason.                                                                                                     |
| Activity grid             | Task events per day in the space.                                                                                                                                         |

Cost and tokens are per session, not per visit. A session that serves two visits counts once, for its agent. This is enough for "average per task, per agent".

A subtask's sessions and events belong to the subtask, and the subtask names its parent. So the dashboard can count a subtask in its own totals, in its parent's, or in both.

This spec adds no dashboard endpoints.

## Data model

New tables in `packages/db/src/task.sql.ts`:

| Table           | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task`          | `id` (`tsk_`), `organization_id`, `space_id`, `parent_id` (phase 2; (`parent_id`, `space_id`) references the parent's (`id`, `space_id`) and cascades), `number`, `title` (1–256), `description`, `status`, `priority` (`low`, `medium`, `high`, or null), `human_review`, `human_review_reason`, `due_at`, `agent_id` (set null on delete), `owner_id` (user, set null), `created_by` (user), `created_by_agent_id`, `created_by_session_id`, `created_at`, `updated_at`, `archived_at`. Unique (`organization_id`, `number`). Indexes on (space, status), agent, and owner, for live rows. |
| `task_sequence` | `organization_id` (key), `prefix`, `last_number`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `label`         | `id` (`lbl_`), `organization_id` (null for system labels), `name`, `color`, timestamps, `archived_at`. Unique (`organization_id`, lower(`name`)) for live rows.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `task_label`    | `task_id`, `label_id`. Unique pair.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `task_link`     | `id` (`tlk_`), `task_id`, `organization_id`, `kind`, `key`, `url`, `created_at`. No creator: the `link` events record who added it. Unique (`task_id`, `kind`, `key`). Index (`organization_id`, `kind`, `key`).                                                                                                                                                                                                                                                                                                                                                                             |
| `task_comment`  | `id` (`tcm_`), `task_id`, `body`, `author_id` (user), `author_agent_id`, `author_session_id`, `edited_at`, timestamps, `archived_at`.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `task_event`    | `id` (`tev_`), `task_id` (no foreign key, so the trail outlives the task), `organization_id`, `kind`, `data` (jsonb), `actor_user_id`, `actor_agent_id`, `actor_session_id`, `created_at`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `task_session`  | `task_id`, `session_id`, `agent_id`, `created_at`. Key (`task_id`, `session_id`): one session that creates several tasks links to each of them. One row for each session that a task start opened or that created the task.                                                                                                                                                                                                                                                                                                                                                                  |

Changed tables: `space` gets `agent_order` (jsonb, an array of agent IDs, default empty).

Deleting an organization deletes all of these. Deleting a user, agent or session clears the reference and keeps the task (v1 L11, L12).

## Access

- A member of a space reads and writes the tasks of that space. Others get "not found", which never says that the task exists (v1 L2, L8).
- Writes follow the space's existing policy. Read-only roles read only (v1 L7).
- An archived task leaves every list, and a get returns not found. Its events stay (v1 L9, L10).
- `done` and `dismissed` need a user actor with no agent.
- An agent acting in a session gets only the policy statements marked `agents: true`, and only in its session's space: `Access.plan` carries the space, each policy's filter adds it, and `isAllowed` refuses a resource of another space. Any other statement denies agents, so a service that ignores the agent cannot widen its reach. Agents get every task action except `archive`, and also `task-comment.create`, `task-activity.list`, `label.list` and `space.get`. Roles still come from the session's creator, so an admin's agent has admin rights inside its space.

## API

New primitives in `@ren/schema`, with groups in `@ren/protocol` and handlers in `@ren/server`, wired as `space` is today.

| Primitive       | Operations                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task`          | `list`, `get` (by ID or identifier), `create`, `update`, `archive`; actions `assign`, `start`, `review` (turn human review on or off). Each returns the task. |
| `task-activity` | `list`: the events and comments of one task.                                                                                                                  |
| `task-comment`  | `create`, `update`, `archive`. Reads go through `task-activity`.                                                                                              |
| `label`         | `list`, `create`, `update`, `archive`.                                                                                                                        |
| `space`         | `update` takes `agentOrder`; `Space.Info` returns it.                                                                                                         |

A primitive action returns its record, so `assign` and `start` return the task, not v1's `message` and `started`. The task's `session` field (the agent's latest live session on the task, and its state: working, idle or failed) shows what started, and it also feeds the turn line. A session that the host has not synced yet counts as working. `assign` is the only action that can fail with a validation error (an agent that the space cannot use, or an owner who is not a member), so only its endpoint declares `InvalidRequestError`. The MCP's `task_assign` adds the one-line `message` (v1 L67). It takes it from `Task.handOff`, which reports whether the agent started; a start that fails does not fail the hand-off.

`task.list` filters: space, status, priority, agent, owner, label, human review, linked URL, parent (phase 2: `parentId` is a task ID for its subtasks, or `none` for tasks that are not subtasks). The default is the actionable statuses. A `status` filter wins (v1 L32, L35). Order: newest created first (v1 L34), except that a parent's subtasks list oldest first. Pages use the standard `Pagination` fields.

`task.update` rejects unknown fields, and its error names `assign` for assignment fields and `addLinks` for links (v1 L26).

`Infra.SpaceDeclaration` gets `agentOrder` (agent names) later, when `ren infra` is built. Tasks stay out of infra (`infra.md`).

## UI

The UI maps one to one to the v1 UI in `ren-v1/packages/app/src/features/tasks/`, with these substitutions:

| v1                                                 | v2                                                   |
| -------------------------------------------------- | ---------------------------------------------------- |
| Team (scope picker)                                | Space                                                |
| Project (column, group, picker, "Move to project") | Agent (column, group, picker, "Move to agent")       |
| "No project"                                       | "No agent"                                           |
| Assignee (user)                                    | Owner                                                |
| Status `In review`                                 | The "Needs review" badge and the human review filter |
| Route `/sessions/tasks`                            | `/tasks` and `/tasks/$taskId`                        |

Everything else stays as in v1: the toolbar (search, filter, display), the saved filters, the `C` hotkey, the list with groups, the bulk action bar, the create dialog with "Create more", the property controls in their three forms, the label picker with the create panel, the due date control, the link badges, the detail page with the inline title and Markdown description, the Start menu (new or continue), the activity feed with collapsed rows and session cards, the session drawer, and comments.

Additions to v1:

- **Board columns**: "No agent", then the agents in the factory order, then each other agent that has a task in view, such as `ren` when it is not in the order. A column outside the order appears only when it has a task. Done tasks stay in their last column; the default filter hides them. The board shows one space at a time, because the order belongs to a space. The list can span spaces.
- **Turn line** on each row and card: the line from [Who has the turn](#who-has-the-turn), with a live dot when an agent is working.
- **Human review**: a "Needs review" badge with the first line of the reason on rows and cards. On the detail page, a banner with the reason and two buttons, **Approve** and **Request changes**, each with a comment field and the continue choice; a menu holds Mark done, Dismiss and Take over. When the agent's session waits on a question, the banner shows the question with an **Answer** button that opens the chat's form.
- **Factory order editor**: on the space page, a "Factory" tab with a sortable list of the space's agents and `ren`. The dashboard comes to this tab later.
- **Subtasks** (phase 2): a "Sub-tasks" section on the detail page, with rows, a "done/total" count and an "Add sub-task" button that opens the create composer inline; a "Parent" property in the aside, on a task with no subtasks; the parent in the breadcrumb. In the list, a subtask nests under its parent, with tree lines, when both are in the same group, in the view's sort order. Otherwise it is a row of its own with a "› Parent" chip. A parent's row and card show the count. A "Show sub-tasks" display option, on by default, hides every subtask.
- **Drag and drop** between board columns (phase 2): a drop does `assign` with `start: "none"`.
- Sidebar: a "Tasks" link, as in v1.

## Implementation order

Each step is one pull request, in dependency order. The UI comes last. Each step writes its tests first, in the package that owns the behaviour, against a real database (root `AGENTS.md`, Testing). The `v1 L` rows that a step cites are its test list.

### Phase 1

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                | Packages                                   | Depends on             | Done when                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Schema.** `Task`, `TaskActivity`, `TaskEvent`, `TaskComment`, `TaskLink`, `Label` modules: IDs (`tsk`, `tev`, `tcm`, `tlk`, `lbl`), `Info`, inputs, `Primitive.define`. The status and priority literals. Link classification (a pure function: GitHub PR, Linear issue, Slack thread, URL). `Space.agentOrder` waits for step 4, because `Space.Info` cannot return it before the column exists. | `schema`                                   | —                      | Link classification, the link URL rule, reserved label names and the assign input have tests (v1 L81, L85, L90, L94, L61).                                    |
| 2   | **Database.** `task.sql.ts` with every table in [Data model](#data-model), `space.agent_order`, and the generated migration. The two system labels are written by `RenSettings.apply`, as the global `ren` agent is.                                                                                                                                                                                | `db`, `core` (defaults only)               | 1                      | The migration applies on a fresh database.                                                                                                                    |
| 3   | **Core: labels, tasks, comments, trail.** `Label` service. `Task` service: create (with the number), list, get, update, archive, labels, links, events, timeline. `TaskComment` service. The policies in `access.ts`. `Actor.Info` gains an optional agent and session.                                                                                                                             | `core`                                     | 2                      | v1 L1–L19, L22–L37, L44, L46–L59, L82–L98 hold in tests.                                                                                                      |
| 4   | **Core: assign, start, review, factory order.** `assign` (with a move between spaces), `start` (`new` and `continue`), `review`, `task_session`, the start message, the `ren` case through `SessionRunner.create`. The rules for `done` and `dismissed`. `Space.agentOrder` in the schema; `Space` reads and writes it and drops unusable IDs on read.                                              | `core`                                     | 3                      | v1 L24, L60–L80, L104 hold. Plan → Build → Plan resumes the first Plan session. The scenarios in [Who has the turn](#who-has-the-turn) hold as service calls. |
| 5   | **Public API.** Groups for `task`, `task-comment` and `label`, the `space` change, handlers, `routes.ts`, the contract check, and `bun run generate`.                                                                                                                                                                                                                                               | `protocol`, `server`, `client` (generated) | 4                      | The handler tests pass, and the generated clients build.                                                                                                      |
| 6   | **Agent tools.** The Ren MCP at `/mcp`, with tools generated from the public API and the actor from `Actor.fromSession`. A later pull request.                                                                                                                                                                                                                                                      | `core`, `server`                           | 5                      | An `e2e/chaos` case: an agent creates a task, hands it to a second agent, and the second agent starts in its own session.                                     |
| 7   | **UI primitives.** The status ring, priority icon, label chips and colors, link badge, board card slots, and the turn line, with stories.                                                                                                                                                                                                                                                           | `ui`, `storybook`                          | — (can start any time) | Each component has a story.                                                                                                                                   |
| 8   | **App: list and create.** `/tasks`, the sidebar link, the toolbar, filters, display options, saved filters, the list with groups, bulk actions, the create dialog, the property controls, and the label picker.                                                                                                                                                                                     | `app`                                      | 5, 7                   | The list matches v1 with the substitutions in [UI](#ui).                                                                                                      |
| 9   | **App: detail page.** `/tasks/$taskId`, the title and description editors, the properties aside, the Start menu, the human review banner, the activity feed, session cards, the session drawer, and comments.                                                                                                                                                                                       | `app`                                      | 8                      | The detail page matches v1.                                                                                                                                   |
| 10  | **App: board and factory order.** The board in factory order for one space, the "Move to agent" menu, and the "Factory" tab on the space page.                                                                                                                                                                                                                                                      | `app`                                      | 8                      | The board columns follow the space's order.                                                                                                                   |

Steps 5 and 6 can run in parallel after step 4. Step 7 can run in parallel with steps 1 to 6.

### Phase 2

| #   | Step                                                                                                                                  | Packages                                     | Depends on |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------- |
| 11  | **Subtasks** in the back end: `task.parent_id`, the rules in [Subtasks](#subtasks-phase-2), the `parent` filter, and the agent tools. | `schema`, `db`, `core`, `protocol`, `server` | Phase 1    |
| 12  | **Subtasks** in the UI.                                                                                                               | `app`                                        | 11         |
| 13  | **Handoff to the next agent** in the factory order, when `task_assign` names no agent.                                                | `core`, `server`                             | Phase 1    |
| 14  | **Drag and drop** on the board.                                                                                                       | `ui`, `app`                                  | Phase 1    |

## Open questions

None. The dashboard questions (subtask totals, the counts in the sentence) move to the dashboard spec.
