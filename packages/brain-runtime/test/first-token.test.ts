import { expect, test } from "bun:test"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Duration, Effect, Stream } from "effect"
import { FirstToken } from "../src/first-token.js"

const a = Session.ID.create()
const b = Session.ID.create()
const subagent = Session.ID.create()
const message = SessionMessage.ID.create()

const event = (type: string, sessionID: Session.ID, created: number) => ({
  id: `${type}-${created}`,
  created,
  type,
  data: { sessionID, assistantMessageID: message, ordinal: 0 },
})

test("times each main chat's turn from its start to its first text, reasoning or tool call, once, and not a turn that ends first or a subagent's turn", async () => {
  const durations = await Effect.runPromise(
    Stream.make(
      event("session.execution.started", a, 1_000),
      event("session.execution.started", b, 1_100),
      event("session.execution.started", subagent, 1_150),
      event("session.step.started", a, 1_200),
      event("session.text.started", subagent, 1_600),
      event("session.reasoning.started", a, 1_700),
      event("session.text.started", a, 1_900),
      event("session.execution.succeeded", b, 2_000),
      event("session.text.started", b, 2_100),
      event("session.execution.started", a, 3_000),
      event("session.tool.input.started", a, 3_250),
    ).pipe(FirstToken.durations({ isMain: (sessionID) => Effect.succeed(sessionID !== subagent) }), Stream.runCollect),
  )

  expect(durations.map(Duration.toMillis)).toEqual([700, 250])
})
