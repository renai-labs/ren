export * as RenInferenceRemoval from "./ren-inference-removal.js"

import { Auth } from "@ren/schema/auth"
import { Context, Effect, Layer } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { DurableRunner } from "./durable-runner.js"
import { RenInference } from "./ren-inference.js"

export interface Interface {
  readonly forgetMember: (input: {
    readonly organizationId: Auth.OrganizationID
    readonly memberId: typeof Auth.MemberID.Type
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/RenInferenceRemoval") {}

// oxlint-disable-next-line ren/no-comments -- One durable run per removed membership, so the Ren Inference Service forgets the member even when it is down at removal time. The member id is unique per membership, so a person who rejoins and leaves again runs again.
const ForgetMemberRun = DurableRunner.make("RenInferenceForgetMember", {
  payload: { organizationId: Auth.OrganizationID, memberId: Auth.MemberID },
  idempotencyKey: (payload) => `ren-inference-forget-member:${payload.memberId}`,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const inference = yield* RenInference.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    yield* DurableRunner.register(ForgetMemberRun, (payload) =>
      DurableRunner.supervise(
        `ren-inference-forget-member:${payload.memberId}`,
        inference.removeMember(payload.organizationId, payload.memberId),
      ),
    )
    return Service.of({
      forgetMember: Effect.fn("RenInferenceRemoval.forgetMember")(function* (input) {
        yield* DurableRunner.ensure(ForgetMemberRun, input).pipe(
          Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        )
      }),
    })
  }),
)
