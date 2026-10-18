# Agents: roadmap

Work after v1 that uses agents. Each item gives what it needs and how agents fit. Main document: [v1.md](v1.md). Decisions R1 to R8 are in [v1.md](v1.md#810-decisions-for-later).

The document is written in ASD-STE100 Simplified Technical English.

## 1. Task board

v1 reference: the Software Factory blueprint (`ren-v1/registry/blueprints/pods/software-factory`). Each step was a v1 project with a model, instructions, skills, MCPs and `bash` deny patterns. In v2 each step is an agent, and the skills and MCPs belong to the space.

```

    task T (owned by a space)
       │
       │  assign: space Factory + agent Plan       ──▶  session p1   (Plan)
       │  assign: space Factory + agent Build      ──▶  session b1   (Build)
       │  assign: space Factory + agent Review     ──▶  session r1   (Review)
       │  assign: space Factory + agent Build,
       │          start = continue                 ──▶  session b1 again
       │
       ▼
    "continue" = last session of (T, Build) in the events of T
                 overrides removed
                 resolved with the current Build settings
                 busy → the message waits in the queue
                 no session found → new session

```

| Needs                                                   | How agents fit                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| Tasks primitive: owner space, status, assignee, events. | The assignee is a space and an optional agent (R1).                 |
| Task events that record the session of each start.      | "Continue" finds the session by (task, agent) from the events (R2). |
| `Session.continue(sessionId, agentId)` in core.         | Clears overrides (R3), resolves, sends with delivery `queue` (R4).  |
| A rule for an agent that is gone.                       | The session continues as Ren (R5). It keeps its own space (R6).     |
| A start of a new session from a task, with no person.   | The session is headless. `ask` becomes `deny` (P8).                 |

Open:

- Can the assignee space differ from the task's owner space?
- Who may assign a task to an agent: members of the assignee space, or of the owner space?

## 2. Slack and other channels

```

    @ren in a place
       │
       ├── DM                      ──▶  personal space of the sender
       ├── mapped channel          ──▶  its space
       └── unmapped channel        ──▶  first org space (General)
                                          │
                                          ▼
                                   org + space defaults, no agent (R7, R8)
                                   headless: ask becomes deny

```

| Needs                                                           | How agents fit                                |
| --------------------------------------------------------------- | --------------------------------------------- |
| A Slack install, place mapping (place → space), account links.  | None. Slack sessions are Ren sessions (R7).   |
| One `reply` tool for the place of the session.                  | A space rule can deny it like any other tool. |
| A thread that a task links goes to the session of the assignee. | Uses the task "continue" path of section 1.   |

## 3. Personal space

A DM needs to find the personal space of a user. Today the provisioning makes a space named "<name>'s Personal Space" (`packages/core/src/space/provisioning.ts`), but nothing marks it as personal.

| Needs                                                             | How agents fit                                    |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| A `kind` column on `space`: `organization`, `personal`, `shared`. | None. Personal space defaults are space defaults. |
| A rule that a personal space has exactly one member.              | Agents in a personal space are for one user only. |

## 4. Attribution storage

The model is in [v1.md](v1.md#7-attribution) (T1 to T7). How Ren stores it is open.

| Needs                                                                    | Proposal                                                                                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each assistant turn knows its agent or Ren, and the overrides in effect. | The cell writes `{ agentId, settingsVersion }` into the message metadata. Sync (PR #32) carries it. Ren keeps each version, so it can show the overrides. |
| Each user message knows its sender.                                      | `Session.SendInput.sender` exists. The cell keeps it on the message.                                                                                      |
| Cost per sender and per agent or Ren.                                    | The model request carries the sender as the LiteLLM user, and the agent or Ren as a tag.                                                                  |
| Task activity names the agent that acted.                                | The task event takes the attribution of the turn that wrote it.                                                                                           |

## 5. Later ideas

These are not decided.

- An agent picker in Slack, for example `@ren review`. Decision R7 says no for now.
- Skills or MCPs on an agent. Decision A2 says no for now.
- Lock keys in instructions, so that a layer can replace an unlocked key. This is a new `InstructionsMerge` Layer.
- A view that shows which layer gave each rule. Core can keep the layer of each rule. The cell does not need it.
- Allowlists ("only these tools"), if deny lists fail open too often. A per-layer `only` set of actions, intersected across layers. It stays flat. This is a new `PermissionsMerge` Layer.
