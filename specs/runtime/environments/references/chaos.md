# Brains, hands and machines: chaos tests

The tests of [the spec](../README.md). Each pull request adds the rows that its change touches, and passes them before it merges (EN39).

## How the tests run

| Kind   | Where                                                                                                                                                                                                                                                   | Time                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Unit   | `core` tests with real Postgres and `TestClock`. No real waits.                                                                                                                                                                                         | the package's `bun run test`                 |
| Local  | `packages/e2e/chaos` with the local or Docker provider and the fault proxy (`chaos/lib/faults/proxy.ts`)                                                                                                                                                | `bun run chaos`                              |
| Live   | The local `ren-stack` with brains and hands in real E2B sandboxes behind the real egress                                                                                                                                                                | the user approves the sandboxes once per run |
| Seeded | Random orders of the events below, replayed from a seed, on the local provider (`core/test/machine-lifecycle.seeded.slow.test.ts`). It checks I1, I2, I3, I11 and I12; each pull request that builds the behaviour of another invariant adds its check. | each pull request                            |
| Soak   | 1 hour live, with fewer kinds of events. Checks I1–I13.                                                                                                                                                                                                 | before the last merge                        |

How each fault is made:

| Fault                                  | How                                                      |
| -------------------------------------- | -------------------------------------------------------- |
| E2B API errors (5xx, 429, timeouts)    | the fault proxy between Ren and the E2B API              |
| A killed or paused machine             | the E2B API                                              |
| A hung brain                           | `kill -STOP` on the brain process, or also on `start.sh` |
| Memory or disk full                    | a command in the sandbox (`stress`, `fallocate`)         |
| Ren → brain cut, brain → hand cut      | the fault proxy                                          |
| Ren down, Ren restart, two Ren servers | stop or start the server process                         |
| Egress restart                         | restart the egress process                               |
| Timers (retries, 5 min, keep-alive)    | `TestClock`                                              |

## Invariants

| ID  | Rule                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | A machine id has at most one live machine per generation. Machines of older generations are gone within 1 h.                                                    |
| I2  | Every state has an exit: `failed` has its retry timer, `capacity` waits, and each other state ends within its time limit.                                       |
| I3  | Ren replaces a machine only when it is asleep and outdated in a way that in-place cannot fix, Gone, frozen, silent for 5 min, or after 3 failed in-place steps. |
| I4  | Every chat on a replaced machine shows the "files reset" notice when it is restored.                                                                            |
| I5  | An interrupted turn continues exactly once.                                                                                                                     |
| I6  | A waiting message is delivered exactly once.                                                                                                                    |
| I7  | After a machine's next wake, no tool runs on a template other than the space's current choice.                                                                  |
| I8  | No tool call works with an expired token. After Ren comes back, calls work within 30 s.                                                                         |
| I9  | A `limited` machine never reaches a host that is not on its list.                                                                                               |
| I10 | No machine runs for more than 1 h without a row in Ren's database.                                                                                              |
| I11 | An unknown answer never destroys a machine: a provider error, an unreadable status or an unreadable version means keep.                                         |
| I12 | Nothing is destroyed because a list does not show it.                                                                                                           |
| I13 | A process restart or a replace never lands on a turn that started after Ren decided it.                                                                         |

## Rows

### Brain machine

| #   | Case                                                                | Expected                                                                                                                                                                                  | Kind         |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | The brain does not answer within 120 s, 3 times                     | `failed`; the first access after 10 min reaches `ready` (unit: `core/test/machine-lifecycle.test.ts`)                                                                                     | unit + live  |
| 2   | E2B API errors for 10 s during a boot                               | `failed` (known limit, EN18); the timed retry recovers                                                                                                                                    | live         |
| 3   | The machine is killed mid-turn                                      | Next use: Gone, replace. The turn continues once, the notice shows, waiting messages are sent. Local: `core/test/restore.slow.test.ts`.                                                   | live         |
| 4   | The brain process is stopped for 70 s                               | `start.sh` restarts it. No replace.                                                                                                                                                       | live         |
| 5   | The brain and `start.sh` are stopped for 6 min                      | Replaced (EN17)                                                                                                                                                                           | live         |
| 6   | Ren → brain cut for 6 min while the brain still pulls               | Replaced (known risk, EN17)                                                                                                                                                               | live         |
| 7   | A tool uses too much memory                                         | The tools' cap stops it. The brain answers. No replace.                                                                                                                                   | live         |
| 8   | The disk is full                                                    | The brain answers or is replaced. It never stays stuck.                                                                                                                                   | live         |
| 9   | A restore of 52 chats, 1,783 messages, 24 MB (fake data, see below) | Report the import time and the longest stall of the brain's thread. It must be under 60 s. The import into OpenCode is measured locally (`brain-runtime/test/restore-size.slow.test.ts`). | local + live |
| 10  | One 9 MB message                                                    | It syncs as a stand-in; the rest of the chat syncs (EN37; `server/test/opencode-sync.test.ts`)                                                                                            | local        |
| 11  | The keep-alive ends while idle, then a wake                         | Files kept                                                                                                                                                                                | live         |

### Bundles

| #   | Case                                      | Expected                                                             | Kind  |
| --- | ----------------------------------------- | -------------------------------------------------------------------- | ----- |
| 12  | A new brain bundle; an asleep brain wakes | Updated in place. Files kept. A background process survives.         | live  |
| 13  | A new executor bundle                     | The executor restarts; background processes stop (expected)          | live  |
| 14  | The bundle fetch fails 3 times            | Replace (unit: `core/test/machine-lifecycle.test.ts`)                | live  |
| 15  | Ren is killed during `updating`           | The update ends. One machine.                                        | live  |
| 16  | A new OpenCode version, then a rollback   | The local database is rebuilt from Postgres; the history is the same | live  |
| 17  | An old and a new Ren server side by side  | A machine never moves to an older bundle                             | local |

### Templates

| #   | Case                                                  | Expected                                        | Kind |
| --- | ----------------------------------------------------- | ----------------------------------------------- | ---- |
| 18  | Save A, then B before A's build ends                  | The image is B; B builds after A ends           | unit |
| 19  | Save A, then B, then A                                | The image is A                                  | unit |
| 20  | A build fails                                         | The last `ready` image stays; the error shows   | live |
| 21  | Ren restarts mid-build                                | The build ends `ready`                          | live |
| 22  | Archive a template that a space uses                  | Refused, with the spaces                        | unit |
| 23  | A co-located template gets a new package while in use | Installed in place at the next wake; files kept | live |

### Space settings

| #   | Case                                                  | Expected                                                    | Kind |
| --- | ----------------------------------------------------- | ----------------------------------------------------------- | ---- |
| 24  | Co-located → remote                                   | At the next wake, tools go to the remote hand; notice shows | live |
| 25  | Remote template T1 → T2                               | Hands replaced at their wake                                | live |
| 26  | Hand → none                                           | Existing chats' file and shell tools refused within ~30 s   | live |
| 27  | None → hand                                           | Only new chats get tools                                    | unit |
| 28  | A co-located hand with a template of another provider | Refused                                                     | unit |
| 29  | A change while the machine is still `creating`        | Applied at its next wake                                    | unit |

### Remote hands

| #   | Case                                                                                | Expected                                                   | Kind        |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------- |
| 30  | The hand machine is killed                                                          | Gone; a new hand; notice shows                             | live        |
| 31  | Brain → hand cut                                                                    | The brain reports it; Ren checks the machine               | live        |
| 32  | A 9th chat on one hand; a chat ends its turn while another is busy                  | A new machine for the 9th; the keep-alive is not shortened | unit        |
| 33  | The hand machine fails 3 times                                                      | The timed retry recovers it                                | unit + live |
| 34  | `limited`: a listed host, an unlisted host, ngrok, a credential added later         | reach, block, block, reach at the next access              | live        |
| 35  | Full tool output, the workspace panel's files and diff, and revert on a remote hand | Each one reads and writes on the hand                      | live        |

### Ren server, egress and E2B

| #   | Case                                                        | Expected                                                                       | Kind  |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ----- |
| 36  | Ren is killed during create, replace, update or build       | No duplicate machines; leaks are gone within 1 h                               | live  |
| 37  | Two Ren servers during a wake (a deploy)                    | The wake ends. Report the delay.                                               | local |
| 38  | Ren down for 20 min mid-turn                                | Tool calls fail after the token expires and work within 30 s after Ren is back | live  |
| 39  | Ren down for 40 min mid-turn                                | Machines pause, then resume when Ren is back                                   | live  |
| 40  | Ren starts with a template whose provider is not registered | Ren refuses to start                                                           | unit  |
| 41  | The egress restarts mid-turn                                | Report what OpenCode does with the dropped model request                       | live  |
| 42  | E2B answers 429 or has no room                              | `capacity`, then recovers                                                      | live  |

### From earlier lessons

See [`lessons.md`](lessons.md).

| #   | Case                                                                   | Expected                                                                                                     | Kind  |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----- |
| 45  | A cron every 2 min on a space brain while a turn runs a 40-min command | The machine never pauses during the turn                                                                     | live  |
| 46  | Wake a brain, then read E2B's timeout                                  | Ren's value, not 300 s                                                                                       | live  |
| 48  | The destroy of an old machine fails; it keeps pulling and syncing      | Refused as a retired generation; the new data stays                                                          | live  |
| 49  | A message arrives during `updating`                                    | It runs on the new version, once                                                                             | live  |
| 50  | 30 chats access one hand at once while 20 other API requests run       | Every request answers; the connection pool never runs out                                                    | local |
| 51  | A space brain restores the 24 MB group while another chat sends        | Report the send's wait; it has a limit                                                                       | live  |
| 52  | Ren crashes between creating a hand machine and saving its row         | The next access finds it by its labels. One machine.                                                         | live  |
| 53  | A question is pending when the machine is replaced                     | The chat continues once and is not stuck on "Asking"                                                         | live  |
| 54  | The browser's clock is 1 s ahead                                       | Exactly one reply                                                                                            | live  |
| 55  | The app tab sleeps for 15 min while the brain is replaced              | It reconnects and shows the notice                                                                           | live  |
| 56  | A deploy while the app is open                                         | The next navigation loads the new code                                                                       | live  |
| 57  | Builds of 3 templates at once, and Ren is killed mid-build             | Each ends `ready` or `failed`; none stays stuck                                                              | live  |
| 58  | 20 brains each sync 8 MB at once                                       | Ren's memory stays under the server's memory (measured 1030 and 1063 MB of 1024 MB: fails; accepted for now) | live  |

Rows 43 and 44 are the seeded runs and the soak (table above).

## Restore fixture

A restore brings back one chat with all of its subagent chats (`brain-runtime/src/restore.ts:23`). Row 9 and row 51 use generated data of this shape:

| Measure         | Value                           |
| --------------- | ------------------------------- |
| Chats           | 52 (one top-level, 51 subagent) |
| Messages        | 1,783                           |
| Size            | 24 MB                           |
| Largest message | 2.8 MB                          |
