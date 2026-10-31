# Tasks: pending

Phase 1 (tasks, labels, links, comments, the trail, assign, start, human review, the factory order, the agent tools, the list, board and detail UI) and subtasks are built.

Words: the **factory order** is the space field `agentOrder`, an ordered list of the space's agents. It sets the board's column order. It does not limit which agent can have a task.

## 1. Handoff to the next agent

`task_assign` with no `agentId` gives the task to the next agent in the factory order. Today `Task.AssignInput` refuses a call with neither an agent nor an owner (`schema/src/task.ts:226`).

Packages: `core`, `server`.

## 2. Drag and drop on the board

A drop between board columns does `assign` with `start: "none"`. Today the board has no drag and drop (`app/src/features/tasks/task-board.tsx`).

Packages: `ui`, `app`.

## 3. Review start as a flag

The decision on a human review takes `start: "continue" | "none"`. The default is the constant `Task.reviewStart = "continue"` (`core/src/task.ts:44`), and no other code assumes it. When the `FeatureFlags` service exists ([`runtime/README.md`](runtime/README.md)), a flag targeted by space replaces the constant, and the flag goes in that file's table. The app sends no `start` unless the user changes it, so it follows the default.

## 4. Later

- **The factory dashboard.** It gets its own spec before it is built. The design mock shows, for one space and a period: counts in a sentence, the cost, a daily activity grid, a "Needs you" list, and time, cost, tokens and runs for each stage, as an average per task. Phase 1 records the data:

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

  Cost and tokens are per session, not per visit. A subtask's sessions and events belong to the subtask, and the subtask names its parent, so the dashboard can count a subtask in its own totals, in its parent's, or in both. The dashboard spec decides.

- **The agent graph DSL.** Edges between agents, back edges and loop counts. Until then any agent can hand off to any usable agent, and the space instructions describe the flow.
