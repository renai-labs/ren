# Piece A: Brain identity and scope

Status: spec written. Decisions: E4, E5, E12, E13, E14, E15, E16, E17, E92 (README §6).

## Goal

Each session belongs to one brain. Ren records the brain when it creates the session. A brain serves one session (scope `session`) or the sessions of one space (scope `space`). A child session uses the brain of its parent.

Not in this piece:

- Tokens that name the brain: piece C.
- Routing a request to a brain by its id: pieces B and D. `BrainHost` does not change in this piece.
- Sandbox state on the brain row (provider, binding, generation): piece D.

## Model

```
 space  sp_1   brain_scope = space
   ├── brain  brn_<random>       scope = space    ◀── agent_session S1.brain_id
   │                                              ◀── agent_session S2.brain_id
   │                                              ◀── agent_session S2c.brain_id   (child of S2)
 space  sp_2   brain_scope = session
   ├── brain  brn_<S3 suffix>    scope = session  ◀── agent_session S3.brain_id
   └── brain  brn_<S4 suffix>    scope = session  ◀── agent_session S4.brain_id
```

```
 Session.create ─▶ SessionRunner.create ─▶ BrainRegistry.assign ─[tx 1]─▶ brain row ─▶ Brain.ID
                                        ├─[tx 2]─▶ insert agent_session(brain_id)
                                        └─▶ DurableRunner.ensure("start:<sessionId>")   (piece D, E68)
 SessionSync.startUpload, new child ─▶ insert agent_session(brain_id = parent.brain_id)
 Environments.access ─▶ environment token { brain: agent_session.brain_id }
```

## Scope switch

Two rules:

1. Ren sets a session's brain when it creates the session. A later scope switch never moves a session to a different brain.
2. A space has at most one space brain, and Ren never replaces it. Each switch to `space` finds the same brain again.

Example: one space, with these steps in this order.

| Step | Event                                     | Scope used | Brain of the new session | `brain` rows after the step |
| ---- | ----------------------------------------- | ---------- | ------------------------ | --------------------------- |
| 1    | Ren creates session S1                    | space      | `brn_X` (new)            | `brn_X` (space)             |
| 2    | Ren creates session S2                    | space      | `brn_X` (found)          | `brn_X`                     |
| 3    | The owner switches the space to `session` | —          | —                        | no change                   |
| 4    | Ren creates session S3                    | session    | `brn_S3` (new)           | `brn_X`, `brn_S3` (session) |
| 5    | The owner switches the space to `space`   | —          | —                        | no change                   |
| 6    | Ren creates session S5                    | space      | `brn_X` (found)          | `brn_X`, `brn_S3`           |

Result:

| Brain    | Sessions   | Disk                                                                                       |
| -------- | ---------- | ------------------------------------------------------------------------------------------ |
| `brn_X`  | S1, S2, S5 | One shared disk. S5's shell can reach the files of S1 and S2; its file tools cannot (E92). |
| `brn_S3` | S3         | Its own disk. S3 stays on this brain after the switch back.                                |

More results of the two rules:

- A child session uses its parent's brain, also when the space has switched scope since the parent was created.
- A turn that runs during a switch continues on its session's brain.
- After a switch, one space can have one space brain and some session brains at the same time. After piece D, each brain is a separate sandbox.

## Contract changes

| Package  | Change                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema` | `Brain.Scope = Schema.Literals(["session", "space"])` in `src/brain.ts`. `Brain.ofSession` stays: `assign` uses it for scope `session`.                    |
| `schema` | `Space.Info.brainScope: Brain.Scope`. `Space.UpdateInput.brainScope: Schema.optional(Brain.Scope)` (`src/space.ts:19`, `:50`).                             |
| `db`     | New `src/brain.sql.ts`, see below.                                                                                                                         |
| `db`     | `space.brain_scope`: `text().$type<Brain.Scope>().notNull().default("space")` (`src/space.sql.ts:13`).                                                     |
| `db`     | `agent_session.brain_id`: `text().$type<Brain.ID>().notNull()`, references `brain.id` with `onDelete: "cascade"`, with an index (`src/session.sql.ts:23`). |
| `db`     | One generated migration. No data migration (E13).                                                                                                          |
| `core`   | New `BrainRegistry` service, see below.                                                                                                                    |
| `core`   | `SessionRunner.create` calls `assign` before its transaction and writes `brain_id` (`src/session/runner.ts:74`).                                           |
| `core`   | `SessionSync.startUpload` writes `brain_id: parent.brain_id` for a new child (`src/session-sync.ts:131-140`).                                              |
| `core`   | `Space.update` writes `brain_scope` (`src/space.ts:182`). `Space` maps `brain_scope` to `brainScope` in `Info`.                                            |
| `core`   | `Environments.assign` joins `agent_session` and returns `brainId`. The token's `brain` claim is that `brainId` (`src/environments.ts:128`, `:268`).        |
| `server` | Adds `BrainRegistry.layer` in `src/main.ts`. Run `bun run generate` from the repo root for the Space API change.                                           |
| `app`    | A scope switch in `src/features/spaces/space-overview.tsx`, see below.                                                                                     |

`brain` table:

| Column            | Type                          | Rule                                            |
| ----------------- | ----------------------------- | ----------------------------------------------- |
| `id`              | `text`, `Brain.ID`            | primary key                                     |
| `organization_id` | `text`, `Auth.OrganizationID` | not null, references `organization.id`, cascade |
| `space_id`        | `text`, `Space.ID`            | not null, references `space.id`, cascade        |
| `scope`           | `text`, `Brain.Scope`         | not null                                        |
| `created_at`      | `timestamp`                   | not null, default now                           |

Index: unique `brain_space_id_uidx` on `(space_id)` where `scope = 'space'`. It allows one space brain per space.

Piece C adds `key_ids`; piece D adds `provider`, `binding`, `generation`, `phase`, `keep_alive_until` and `last_progress_at`. See their specs.

## Services and layers

```ts
export interface Interface {
  readonly assign: (placement: {
    readonly organizationId: Auth.OrganizationID
    readonly spaceId: Space.ID
    readonly sessionId: Session.ID
  }) => Effect.Effect<Brain.ID>
}
export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainRegistry") {}
export const layer: Layer.Layer<Service, never, Database.Service>
```

File: `packages/core/src/brain-registry.ts`. One layer. Scope is data in `space.brain_scope`, not a layer.

`assign` runs in one transaction:

1. Read `space.brain_scope` for `spaceId`.
2. Scope `session`: insert `brain(id = Brain.ofSession(sessionId), scope = session)`, `ON CONFLICT DO NOTHING`. Return that id.
3. Scope `space`: insert `brain(id = Brain.ID.create(), scope = space)`, `ON CONFLICT (space_id) WHERE scope = 'space' DO NOTHING`. Then select the space brain of `spaceId` and return its id.

`assign` has no typed errors. A database error is a defect. The caller checks the space before the call (`Session.create`, `src/session.ts:154-168`).

## App

- In `space-overview.tsx`, add a third `Field.Root` row below "Description". It holds a `Switch` from `@ren/ui/switch`.
- The switch is on when `brainScope` is `session`. A change calls `save({ brainScope })`, the same path as name and description.
- Only a user who can update the space (`canUpdate`) can change it. Other users see the value as text.
- Copy is a proposal. Use the `interface` skill to confirm it before you implement. Label: "Separate workspace per chat". Help text: "New chats without a template get their own machine. Existing chats keep theirs." The switch applies only to chats without an environment template (README E20).

## Lifecycle states

This piece adds database rows and starts no process. The states asleep, waking, mid-turn, down and restarting do not apply. A scope change during a turn does not change that turn, because the session's brain does not change after create.

## Edge cases

| Case                                                                                  | Result                                                                                                                 |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Two creates in one space with no brain, at the same time                              | The unique index gives one row. Both sessions get its id.                                                              |
| A create with a session id that exists (`AlreadyExists`)                              | Scope `session`: `assign` finds the same row. Scope `space`: `assign` returns the space brain.                         |
| `assign` succeeds, then the session insert fails                                      | At most one brain row with no session. No VM exists: the brain run starts only after the session row is written (E68). |
| Code that needs one user for a brain (ren-v1 INV-9: a shared pod got an empty config) | The `brain` row has no user. Pieces B and H do not read one user from a brain.                                         |
| The space switches `space` → `session` → `space`                                      | See "Scope switch". The first space brain serves the sessions of both `space` periods.                                 |
| A child session arrives through sync                                                  | It gets the parent's `brain_id`, even when the space has changed scope since.                                          |

## Tests

Write each test first. Each test must fail before its change.

| #   | File                               | Test                                                                                                                                                                                                                                     |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `core/test/brain-registry.test.ts` | Scope `space`: two sessions of one space get one brain. The table has one row for that space. A session of a second space gets a different brain (ren-v1 INV-66: sessions leaked across pods).                                           |
| 2   | `core/test/brain-registry.test.ts` | Scope `session`: each session gets `brn_<session suffix>`. A second `assign` for one session gives the same id and no new row.                                                                                                           |
| 3   | `core/test/brain-registry.test.ts` | Race: two `assign` calls at the same time in one space with scope `space` give one row and one id.                                                                                                                                       |
| 4   | `core/test/brain-registry.test.ts` | Scope switch, steps 1–6 of "Scope switch": S1 and S2 keep `brn_X`, S3 gets `brn_S3`, and S5 gets `brn_X` again.                                                                                                                          |
| 5   | `core/test/session-runner.test.ts` | Add to "create stores a root session…" (`:49`): the stored row has the brain id that `assign` gives.                                                                                                                                     |
| 6   | `core/test/session-runner.test.ts` | Add to "create with the ID of a session that exists fails with AlreadyExists…" (`:82`): the second create adds no brain row, and the session keeps its brain (ren-v1 INV-62, INV-99: a failed create left half-written rows).            |
| 7   | `core/test/session-sync.test.ts`   | The parent is created with scope `space`. The space then switches to `session`. A child that an upload creates after the switch has its parent's `brain_id` (ren-v1 INV-55, INV-61: children from sync were rejected or recorded wrong). |
| 8   | `core/test/space.test.ts`          | Add to the existing update test (`:65`): `update` with `brainScope` returns it in `Info`.                                                                                                                                                |
| 9   | `core/test/environments.test.ts`   | Change "the first access makes an environment and a token for the session's brain" (`:120`): the `brain` claim is the session's `brain_id` in a space brain.                                                                             |

Test helper changes:

- `core/test/lib/seed.ts:120`: `Seed.session` inserts a scope `session` brain with id `Brain.ofSession(id)` before the session.
- `core/test/environments.test.ts:45`: `subjectIn` creates the session with `Seed.session`, because `Environments.assign` now joins `agent_session`.

No tests for: the column default `'space'` (a config value) or the app switch (a layout of existing components).
