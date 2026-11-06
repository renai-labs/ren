export * as IntakeSources from "./intake-sources.js"

import { BrainRegistry } from "@ren/core/brain-registry"
import { ChannelInstalls } from "@ren/core/channel-installs"
import { ChannelIntake } from "@ren/core/channel-intake"
import { ChannelProvider } from "@ren/core/channel-provider"
import { Intake } from "@ren/core/intake"
import { PullRequest } from "@ren/core/pull-request"
import { SessionRunner } from "@ren/core/session/runner"
import { SlackTaskActions } from "@ren/core/slack-task-actions"
import { Task } from "@ren/core/task"
import { WebhookIntake } from "@ren/core/webhook-intake"
import { Effect, Layer } from "effect"

export const layer = Intake.sources(
  Effect.gen(function* () {
    const registry = yield* ChannelProvider.Registry
    return [...(yield* Effect.forEach(registry.providers, ChannelIntake.source)), yield* WebhookIntake.source]
  }),
).pipe(
  Layer.provide(SlackTaskActions.layer),
  Layer.provide([Task.layer.pipe(Layer.provideMerge(SessionRunner.layer)), ChannelInstalls.layer]),
  Layer.provide([BrainRegistry.layer, PullRequest.layer]),
)
