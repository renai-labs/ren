export * as SlackTaskActions from "./slack-task-actions.js"

import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Task as TaskSchema } from "@ren/schema/task"
import { Config, Context, Effect, Layer, Option } from "effect"
import type { Actor } from "./actor.js"
import { ChannelRoute } from "./channel-route.js"
import { Slack } from "./channel-provider/slack.js"
import { SlackApp } from "./slack-app.js"
import { Task } from "./task.js"

type Clicked = Extract<Channel.Signal, { readonly kind: "card_action" }>

export interface Interface {
  readonly act: (organizationId: Auth.OrganizationID, clicked: Clicked) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SlackTaskActions") {}

const none: Interface = { act: () => Effect.void }

export const layerNone = Layer.succeed(Service, Service.of(none))

// oxlint-disable-next-line ren/no-comments -- Slack waits 3 seconds for an answer to a click, so the action runs after it. The task API checks that the person may act on the task; Task refreshes the cards.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const routes = yield* ChannelRoute.Service
    const tasks = yield* Task.Service
    const slack = yield* SlackApp.Service
    if (Option.isNone(slack.client)) return Service.of(none)
    const client = slack.client.value
    const app = (yield* Config.String("APP_URL").pipe(Effect.orDie)).replace(/\/$/u, "")
    const scope = yield* Effect.scope

    const calls: Readonly<
      Record<
        Channel.CardAction,
        (actor: Actor.Info, id: TaskSchema.ID) => Effect.Effect<unknown, { readonly message: string }>
      >
    > = {
      approve: (actor, id) => tasks.review(actor, id, { humanReview: false, decision: "approved" }),
      start: (actor, id) => tasks.startOnce(actor, id),
      request_review: (actor, id) => tasks.review(actor, id, { humanReview: true, reason: "Requested in Slack." }),
      done: (actor, id) => tasks.update(actor, id, { status: "done" }),
      dismiss: (actor, id) => tasks.update(actor, id, { status: "dismissed" }),
      assign_to_me: (actor, id) => tasks.assign(actor, id, { ownerId: actor.userId }),
    }

    const reply = (clicked: Clicked, text: string) =>
      clicked.responseUrl
        ? client
            .respond(clicked.responseUrl, Slack.message(text))
            .pipe(Effect.catchTag("SlackApp.Failed", (error) => Effect.logWarning("A Slack click got no reply", error)))
        : Effect.void

    const act = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, clicked: Clicked) {
      const actor = yield* routes.actorOf(organizationId, {
        provider: "slack",
        install: clicked.install,
        sender: clicked.sender,
      })
      if (Option.isNone(actor))
        return yield* reply(
          clicked,
          `Connect your Ren account to act on tasks from Slack. [Connect your Ren account](${app}/settings/preferences)`,
        )
      yield* calls[clicked.action](actor.value, clicked.taskId).pipe(
        Effect.asVoid,
        Effect.catch((error) => reply(clicked, error.message)),
      )
    })

    return Service.of({
      act: (organizationId, clicked) =>
        act(organizationId, clicked).pipe(
          Effect.catchCause((cause) => Effect.logWarning(`A Slack click on ${clicked.taskId} failed`, cause)),
          Effect.withSpan("SlackTaskActions.act"),
          Effect.forkIn(scope),
          Effect.asVoid,
        ),
    })
  }),
)
