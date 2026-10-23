export * as ModelSource from "./model-source.js"

import { Shared } from "@ren/cell/testing"
import { Testing } from "@ren/db/testing"
import { Session } from "@ren/schema/session"
import { Effect, Layer } from "effect"
import { Brains } from "../../src/brains.js"
import { BrainRegistry } from "../../src/brain-registry.js"
import { Models } from "../../src/models.js"
import { SessionRunner } from "../../src/session/runner.js"
import { Host } from "./host.js"
import { Seed } from "./seed.js"

export const stub = Shared.stub()
const hourMs = 60 * 60_000

export const access = (apiKeys: Parameters<typeof Shared.access>[0], baseUrl = stub.url) =>
  Shared.access(apiKeys, baseUrl)
export const lasting = (value: string) => Shared.apiKey(value, Date.now() + 6 * hourMs)

export const source: { access: Models.Access } = { access: access({ stub: lasting("sk-initial") }) }

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.sync(() => Models.catalog(source.access)),
    grant: () => Effect.sync(() => source.access),
  }),
)

export const layer = SessionRunner.layer.pipe(
  Layer.provideMerge(BrainRegistry.layer),
  Layer.provideMerge(Host.layer({}, models)),
  Layer.provideMerge(Testing.layer),
)

export const chat = Effect.fnUntraced(function* (initial: Models.Access) {
  source.access = initial
  const sessions = yield* SessionRunner.Service
  const owner = yield* Seed.owner()
  const sessionId = Session.ID.create()
  const opened = stub.script()
  yield* sessions.create(owner, {
    sessionId,
    harness: "opencode",
    interactive: true,
    initialMessage: {
      messageId: Session.MessageID.create(),
      prompt: { text: `open ${opened.marker}` },
      sender: { userId: owner.createdBy },
    },
  })
  yield* Effect.promise(() => opened.called())
  const brainId = (yield* sessions.get(sessionId)).brainId
  const restart = (input: Partial<Session.StartInput>, text: string) =>
    Brains.Service.use((brain) =>
      brain.start(
        {
          sessionId,
          harness: "opencode",
          interactive: true,
          ...input,
          initialMessage: {
            messageId: Session.MessageID.create(),
            prompt: { text },
            sender: { userId: owner.createdBy },
          },
        },
        { organizationId: owner.organizationId, spaceId: owner.spaceId, brainId },
      ),
    )
  const send = (text: string) =>
    sessions.send({
      sessionId,
      messageId: Session.MessageID.create(),
      prompt: { text },
      delivery: "queue",
      sender: { userId: owner.createdBy },
    })
  return { sessionId, restart, send }
})
