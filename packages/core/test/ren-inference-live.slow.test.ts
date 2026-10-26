import { describe, expect, setDefaultTimeout } from "bun:test"
import { Testing } from "@ren/db/testing"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { Auth } from "@ren/schema/auth"
import { SessionMessage } from "@ren/schema/session/message"
import { ConfigProvider, Effect, Layer, Schedule, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../src/access.js"
import { BrainRegistry } from "../src/brain-registry.js"
import { EgressControl } from "../src/egress-control.js"
import { Models } from "../src/models.js"
import { RenInference } from "../src/ren-inference.js"
import { Session } from "../src/session.js"
import { SessionRunner } from "../src/session/runner.js"
import { Signer } from "../src/signer.js"
import { Space } from "../src/space.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { TranscriptCodec } from "../src/transcript-codec.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(300_000)

// oxlint-disable-next-line ren/no-comments -- A real Ren Inference Service, its gateway and a real model. REN_INFERENCE_LIVE_MODEL is endpoint/model as the picker lists it; REN_INFERENCE_LIVE_ORG is an organization the service serves that model to.
const live = {
  service: process.env.REN_INFERENCE_LIVE_URL ?? "",
  gateway: process.env.REN_INFERENCE_LIVE_GATEWAY ?? "",
  gatewayKey: process.env.REN_INFERENCE_LIVE_GATEWAY_KEY ?? "",
  keys: process.env.REN_INFERENCE_LIVE_KEYS ?? "",
  model: process.env.REN_INFERENCE_LIVE_MODEL ?? "",
  organization: process.env.REN_INFERENCE_LIVE_ORG ?? "",
}

const models = Models.layerRenInference.pipe(
  Layer.provideMerge(RenInference.layer),
  Layer.provide([Layer.fresh(Signer.layerLocal), FetchHttpClient.layer, Access.layer]),
  Layer.provide(Testing.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        REN_INFERENCE_URL: live.service,
        REN_INFERENCE_BRAIN_URL: live.gateway,
        REN_INFERENCE_KEYS: live.keys,
      }),
    ),
  ),
  Layer.orDie,
)

const it = testEffect(
  Layer.mergeAll(Session.layer, Space.layer, SpaceProvisioning.layer).pipe(
    Layer.provideMerge(SessionRunner.layer),
    Layer.provideMerge(BrainRegistry.layer),
    Layer.provideMerge(TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } })),
    Layer.provideMerge(Host.layer({}, models)),
    Layer.provideMerge(models),
    Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)),
    Layer.provideMerge(Testing.layer),
  ),
)

const SpendLogs = Schema.Array(
  Schema.Struct({
    end_user: Schema.NullOr(Schema.String),
    team_id: Schema.NullOr(Schema.String),
    status: Schema.String,
  }),
)

// oxlint-disable-next-line ren/no-comments -- The gateway writes its spend log in batches, so the test reads it again until the turn shows. The test checks who the turn is counted on, not the amount.
const countedOn = (memberId: string) =>
  Effect.promise(async () => {
    const response = await fetch(`${live.gateway}/spend/logs`, {
      headers: { authorization: `Bearer ${live.gatewayKey}` },
    })
    return Schema.decodeUnknownSync(SpendLogs)(await response.json()).filter((row) => row.end_user === memberId)
  }).pipe(
    Effect.filterOrFail((rows) => rows.length > 0),
    Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 60 }),
    Effect.orDie,
  )

describe.skipIf(Object.values(live).some((value) => !value))("Ren Inference Service, live (test 13)", () => {
  it.live("a turn on the real gateway is counted on the organization's team and on the member who sent it", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const spaces = yield* Space.Service
      const provisioning = yield* SpaceProvisioning.Service
      const organizationId = yield* Seed.organization(Auth.OrganizationID.make(live.organization))
      const ada = yield* Seed.user()
      const memberId = yield* Seed.member(organizationId, ada.id, "member")
      yield* provisioning.createInitialMemberships(organizationId, ada)
      const actor = { userId: ada.id, organizationId, roles: ["member"] }
      const team = yield* spaces.create(actor, { name: "Team" })
      const [providerID = "", id = ""] = live.model.split("/")
      expect(yield* sessions.models(actor, Session.ID.create())).toContainEqual(
        expect.objectContaining({ providerID, id }),
      )

      yield* sessions.create(actor, {
        id: Session.ID.create(),
        spaceId: team.id,
        model: { providerID, id },
        message: { id: SessionMessage.ID.create(), text: "Reply with the word OK and nothing else." },
      })

      expect(yield* countedOn(memberId)).toContainEqual({
        end_user: memberId,
        team_id: organizationId,
        status: "success",
      })
    }),
  )
})
