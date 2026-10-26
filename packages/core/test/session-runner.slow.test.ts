import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Session } from "../src/session.js"
import { SessionRunner } from "../src/session/runner.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const it = testEffect(Configured.runnerLayer)

describe("SessionRunner", () => {
  it.live("create stores a root session without its initial message and starts it on the host", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionRunner.Service
      const database = yield* Database.Service
      const owner = yield* Seed.owner()
      const sessionId = Session.ID.create()
      const script = Configured.stub.script()
      const start = { sessionId, harness: "opencode" as const, title: "Plan", interactive: true }
      yield* sessions.create(owner, {
        ...start,
        initialMessage: {
          messageId: Session.MessageID.create(),
          prompt: { text: `initial ${script.marker}` },
          sender: { userId: owner.createdBy },
        },
      })
      expect((yield* Effect.promise(() => script.called())).text).toContain(script.marker)
      const rows = yield* database.db
        .select()
        .from(Database.Schema.agent_session)
        .where(eq(Database.Schema.agent_session.id, sessionId))
      expect(rows.at(0)).toMatchObject({
        parent_id: null,
        root_id: sessionId,
        start_input: start,
        sync_seq: null,
        sync_upload: 0,
      })
    }),
  )

  it.live("send to a session that the host lost starts it again from its start input, then delivers it whole", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionRunner.Service
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner, { interactive: true })
      const script = Configured.stub.script()
      const messageId = Session.MessageID.create()
      expect(
        yield* sessions.send({
          sessionId,
          messageId,
          prompt: { text: `again ${script.marker}` },
          delivery: "steer",
          sender: { userId: owner.createdBy },
          channel: { provider: "github", place: "acme/api", sender: "octocat" },
        }),
      ).toEqual({ messageId })
      const turn = yield* Effect.promise(() => script.called())
      expect(
        turn.body.messages.filter((message) => JSON.stringify(message.content ?? "").includes(script.marker)),
      ).toHaveLength(1)
      expect(turn.text).toStartWith("GitHub acme/api · octocat\n---")
    }),
  )
})
