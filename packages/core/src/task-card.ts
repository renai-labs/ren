export * as TaskCard from "./task-card.js"

import type { Task } from "@ren/schema/task"
import { Context, Effect, Layer } from "effect"
import { GitHubTaskCard } from "./github-task-card.js"
import { SlackTaskCard } from "./slack-task-card.js"

export interface Interface {
  readonly refresh: (taskId: Task.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/TaskCard") {}

export const layerNone = Layer.succeed(Service, Service.of({ refresh: () => Effect.void }))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const github = yield* GitHubTaskCard.Service
    const slack = yield* SlackTaskCard.Service
    return Service.of({
      refresh: (taskId) => Effect.all([github.refresh(taskId), slack.refresh(taskId)], { discard: true }),
    })
  }),
)
