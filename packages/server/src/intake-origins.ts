export * as IntakeOrigins from "./intake-origins.js"

import { Access } from "@ren/core/access"
import { BrainRegistry } from "@ren/core/brain-registry"
import { ChannelInstalls } from "@ren/core/channel-installs"
import { ChannelIntake } from "@ren/core/channel-intake"
import { ChannelProvider } from "@ren/core/channel-provider"
import { Intake } from "@ren/core/intake"
import { PullRequest } from "@ren/core/pull-request"
import { SessionRunner } from "@ren/core/session/runner"
import { SlackTaskActions } from "@ren/core/slack-task-actions"
import { Task } from "@ren/core/task"
import { WebhookReceiver } from "@ren/core/webhook/receiver"
import { WebhookWorker } from "@ren/core/webhook/worker"
import { Effect, Layer } from "effect"

export const layer = Layer.mergeAll(
  Intake.receivers(
    Effect.gen(function* () {
      const registry = yield* ChannelProvider.Registry
      return [...(yield* Effect.forEach(registry.providers, ChannelIntake.receiver)), yield* WebhookReceiver.make]
    }),
  ),
  Intake.workers(
    Effect.gen(function* () {
      const registry = yield* ChannelProvider.Registry
      return [...(yield* Effect.forEach(registry.providers, ChannelIntake.worker)), yield* WebhookWorker.make]
    }),
  ),
).pipe(
  Layer.provide(SlackTaskActions.layer),
  Layer.provide([Task.layer.pipe(Layer.provideMerge(SessionRunner.layer)), ChannelInstalls.layer]),
  Layer.provide([BrainRegistry.layer, PullRequest.layer, Access.layer]),
)
