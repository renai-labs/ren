import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { ArtifactCloudflarePlan } from "../src/artifact-provider/cloudflare-plan.js"

describe("Cloudflare artifact class identity", () => {
  test("recovery retains provisioned classes absent from the restored application", () => {
    const retained = { NOTES: "Notes", ROOM: "Room" }
    expect(
      Result.getOrThrow(
        ArtifactCloudflarePlan.bindings({ active: { NOTES: "Notes" }, retained, desired: { NOTES: "Notes" } }),
      ),
    ).toEqual(retained)
    expect(ArtifactCloudflarePlan.exports(retained)).toEqual({
      Notes: { type: "durable-object", storage: "sqlite" },
      Room: { type: "durable-object", storage: "sqlite" },
    })
  })
  test("rejects removal, renaming and rebinding of successful mappings", () => {
    const active = { NOTES: "Notes" }
    for (const desired of [{}, { RENAMED: "Notes" }, { NOTES: "Other" }]) {
      expect(Result.isFailure(ArtifactCloudflarePlan.bindings({ active, retained: active, desired }))).toBe(true)
    }
    expect(
      Result.isFailure(ArtifactCloudflarePlan.bindings({ active: {}, retained: active, desired: { NOTES: "Other" } })),
    ).toBe(true)
    expect(
      Result.isFailure(ArtifactCloudflarePlan.bindings({ active: {}, retained: {}, desired: { STATE: "default" } })),
    ).toBe(true)
  })
})
