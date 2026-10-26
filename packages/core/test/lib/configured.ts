export * as Configured from "./configured.js"

import { Shared } from "@ren/cell/testing"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { Effect, Layer } from "effect"
import { Access } from "../../src/access.js"
import { BrainRegistry } from "../../src/brain-registry.js"
import { EgressControl } from "../../src/egress-control.js"
import { Models } from "../../src/models.js"
import { Session } from "../../src/session.js"
import { SessionRunner } from "../../src/session/runner.js"
import { SessionSync } from "../../src/session-sync.js"
import { Space } from "../../src/space.js"
import { SpaceProvisioning } from "../../src/space/provisioning.js"
import { TranscriptCodec } from "../../src/transcript-codec.js"
import { Host } from "./host.js"
import { Seed } from "./seed.js"

export const stub = Shared.stub()

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") }, stub.url)

// oxlint-disable-next-line ren/no-comments -- Every brain gets the stub model with the key sk-configured.
export const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    inference: Shared.inference(),
    revision: Effect.succeed("test"),
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () => Effect.succeed(configured),
  }),
)

export const runnerLayer = Layer.mergeAll(SessionRunner.layer, SessionSync.layer).pipe(
  Layer.provideMerge(BrainRegistry.layer),
  Layer.provideMerge(Host.layer({}, models)),
  Layer.provideMerge(Testing.layer),
)

export const sessionLayer = Layer.mergeAll(Session.layer, Space.layer, SpaceProvisioning.layer).pipe(
  Layer.provideMerge(SessionRunner.layer),
  Layer.provideMerge(BrainRegistry.layer),
  Layer.provideMerge(TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } })),
  Layer.provideMerge(Host.layer({}, models)),
  Layer.provideMerge(models),
  Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)),
  Layer.provideMerge(Testing.layer),
)

export const page = { page: 1, pageSize: 50 }

export const member = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  role: "member" | "admin" = "member",
) {
  const provisioning = yield* SpaceProvisioning.Service
  const seeded = yield* Seed.user()
  const memberId = yield* Seed.member(organizationId, seeded.id, role)
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  return { userId: seeded.id, organizationId, roles: [role], memberId }
})
