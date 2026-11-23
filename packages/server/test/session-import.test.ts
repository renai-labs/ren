import { describe, expect } from "bun:test"
import { testEffect } from "@ren/core/testing"
import { OpenCodeFixtures } from "@ren/opencode-transcript/testing"
import { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { ApiFixture } from "./lib/api-fixture.js"

const it = testEffect(ApiFixture.layer)

describe("session.import", () => {
  it.live(
    "an OpenCode export becomes a chat of the space with the same ID, from OpenCode, whose saved history Ren serves; the export of another session is a 400",
    () =>
      Effect.gen(function* () {
        const owner = yield* ApiFixture.owner()
        const chat = OpenCodeFixtures.recordings
          .flatMap((recording) => recording.chats)
          .findLast((each) => !each.session.parent_id && each.messages.some((row) => row.type === "user"))
        if (!chat) return yield* Effect.die(new Error("No recorded chat"))
        const id = chat.session.id
        const imported = yield* owner.request("POST", `/sessions/${id}/import`, {
          spaceId: owner.spaceId,
          harness: "opencode",
          transcript: OpenCodeFixtures.exported(chat),
        })
        expect(imported.status).toBe(200)
        expect(yield* Effect.promise(() => imported.json())).toMatchObject({
          id,
          spaceId: owner.spaceId,
          origin: "opencode",
          title: chat.session.title,
        })
        const history = yield* owner.request("GET", `/sessions/${id}/messages?limit=200`)
        const items: ReadonlyArray<{ readonly id: string }> = (yield* Effect.promise(() => history.json())).items
        expect(chat.messages.filter((row) => items.some((item) => item.id === row.id)).length).toBeGreaterThan(0)
        expect(items.every((item) => chat.messages.some((row) => row.id === item.id))).toBe(true)
        const other = yield* owner.request("POST", `/sessions/${Session.ID.create()}/import`, {
          spaceId: owner.spaceId,
          harness: "opencode",
          transcript: OpenCodeFixtures.exported(chat),
        })
        expect([other.status, (yield* Effect.promise(() => other.json()))._tag]).toEqual([400, "InvalidRequestError"])
      }),
  )
})
