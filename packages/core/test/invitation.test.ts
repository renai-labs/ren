import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Effect, Layer } from "effect"
import { Invitation } from "../src/invitation.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Invitation.layer.pipe(Layer.provideMerge(Testing.layer)))

describe("Invitation.preview", () => {
  it.live("identifies expired, accepted and otherwise unavailable invitations", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      const organizationId = yield* Seed.organization()
      const inviterId = (yield* Seed.user()).id
      const previews = yield* Effect.forEach(
        [
          { expiresAt: new Date(Date.now() - 60_000) },
          { status: "accepted" },
          { status: "canceled" },
          { status: "rejected" },
          { status: "some-future-status" },
        ],
        (invitation) =>
          Effect.flatMap(Seed.invitation({ organizationId, inviterId, ...invitation }), invitations.preview),
      )
      expect(previews.map((preview) => preview.state)).toEqual([
        "expired",
        "accepted",
        "unavailable",
        "unavailable",
        "unavailable",
      ])
    }),
  )

  it.live("returns an invalid state for an unknown invitation", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      expect(yield* invitations.preview("inv_unknown")).toEqual({ state: "invalid", organization: null, inviter: null })
    }),
  )
})
