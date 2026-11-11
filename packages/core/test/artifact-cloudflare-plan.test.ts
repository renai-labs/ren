import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { ArtifactCloudflarePlan } from "../src/artifact-provider/cloudflare-plan.js"

describe("Cloudflare artifact migrations", () => {
  test("a failed addition can be omitted from the app while retaining its provisioned binding", () => {
    const input = {
      active: { NOTES: "Notes" },
      retained: { NOTES: "Notes", ROOM: "Room" },
      desired: { NOTES: "Notes" },
    }
    expect(Result.getOrThrow(ArtifactCloudflarePlan.bindings(input))).toEqual(input.retained)
    expect(
      Result.isFailure(ArtifactCloudflarePlan.bindings({ ...input, desired: { NOTES: "Notes", ROOM: "Other" } })),
    ).toBe(true)
  })
  test("recovery discards only unapplied class additions and keeps applied namespaces", () => {
    const first = Result.getOrThrow(
      ArtifactCloudflarePlan.migrations({ previous: null, objects: { NOTES: "Notes" }, migrationTag: null }),
    )
    const pending = Result.getOrThrow(
      ArtifactCloudflarePlan.migrations({
        previous: first.state,
        objects: { NOTES: "Notes", ROOM: "Room" },
        migrationTag: "ren-sqlite-1",
      }),
    )
    const unapplied = Result.getOrThrow(ArtifactCloudflarePlan.confirmed(pending.state, "ren-sqlite-1"))
    expect(unapplied.objects).toEqual({ NOTES: "Notes" })
    expect(unapplied.history).toHaveLength(1)
    const applied = Result.getOrThrow(ArtifactCloudflarePlan.confirmed(pending.state, "ren-sqlite-2"))
    expect(applied.objects).toEqual({ NOTES: "Notes", ROOM: "Room" })
    expect(applied.history).toHaveLength(2)
  })
  test("retains class history and remote acknowledgement over replays", () => {
    const initial = Result.getOrThrow(
      ArtifactCloudflarePlan.migrations({
        previous: null,
        objects: { NOTES: "Notes", ALIAS: "Notes" },
        migrationTag: null,
      }),
    )
    expect(initial.state.history.flatMap((step) => step.new_sqlite_classes)).toEqual(["Notes"])
    expect(
      Result.getOrThrow(
        ArtifactCloudflarePlan.migrations({
          previous: initial.state,
          objects: initial.state.objects,
          migrationTag: null,
        }),
      ).state.history,
    ).toEqual(initial.state.history)
    expect(
      Result.getOrThrow(
        ArtifactCloudflarePlan.migrations({
          previous: initial.state,
          objects: { NOTES: "Notes", ALIAS: "Notes" },
          migrationTag: "ren-sqlite-1",
        }),
      ).state.acknowledgedTag,
    ).toBe("ren-sqlite-1")

    const added = Result.getOrThrow(
      ArtifactCloudflarePlan.migrations({
        previous: initial.state,
        objects: { NOTES: "Notes", ALIAS: "Notes", ROOMS: "Room" },
        migrationTag: "ren-sqlite-1",
      }),
    )
    expect(added.state.history.flatMap((step) => step.new_sqlite_classes)).toEqual(["Notes", "Room"])
    expect(
      Result.getOrThrow(
        ArtifactCloudflarePlan.migrations({
          previous: added.state,
          objects: added.state.objects,
          migrationTag: "ren-sqlite-1",
        }),
      ).state.history,
    ).toEqual(added.state.history)
    expect(
      Result.getOrThrow(
        ArtifactCloudflarePlan.migrations({
          previous: added.state,
          objects: added.state.objects,
          migrationTag: "ren-sqlite-2",
        }),
      ).state.acknowledgedTag,
    ).toBe("ren-sqlite-2")
  })

  test("rejects removal, renaming and rebinding against retained provider state", () => {
    const saved = Result.getOrThrow(
      ArtifactCloudflarePlan.migrations({
        previous: null,
        objects: { NOTES: "Notes" },
        migrationTag: null,
      }),
    ).state
    for (const objects of [{}, { RENAMED: "Notes" }, { NOTES: "Other" }]) {
      expect(
        Result.isFailure(
          ArtifactCloudflarePlan.migrations({
            previous: saved,
            objects,
            migrationTag: "ren-sqlite-1",
          }),
        ),
      ).toBe(true)
    }
  })

  test("fails closed when remote migration history is missing or belongs to another writer", () => {
    const initial = Result.getOrThrow(
      ArtifactCloudflarePlan.migrations({
        previous: null,
        objects: { NOTES: "Notes" },
        migrationTag: null,
      }),
    ).state
    const saved = Result.getOrThrow(
      ArtifactCloudflarePlan.migrations({
        previous: initial,
        objects: initial.objects,
        migrationTag: "ren-sqlite-1",
      }),
    ).state
    expect(
      Result.isFailure(
        ArtifactCloudflarePlan.migrations({
          previous: saved,
          objects: saved.objects,
          migrationTag: null,
        }),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        ArtifactCloudflarePlan.migrations({
          previous: saved,
          objects: saved.objects,
          migrationTag: "foreign",
        }),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        ArtifactCloudflarePlan.migrations({
          previous: null,
          objects: saved.objects,
          migrationTag: "ren-sqlite-1",
        }),
      ),
    ).toBe(true)
  })
})
