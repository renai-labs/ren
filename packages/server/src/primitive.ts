export * as Primitive from "./primitive.js"

import { Actor } from "@ren/core/actor"
import { Agent } from "@ren/core/agent"
import { App } from "@ren/core/app"
import { AppProfiles } from "@ren/core/app/profiles"
import { MachineTemplates } from "@ren/core/machine-templates"
import { OrganizationSettings } from "@ren/core/organization-settings"
import { Primitive } from "@ren/core/primitive"
import { Schedules } from "@ren/core/schedules"
import { Space } from "@ren/core/space"
import { Task } from "@ren/core/task"
import { Webhooks } from "@ren/core/webhooks"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError } from "@ren/protocol/errors"
import { CurrentOrganization } from "@ren/protocol/middleware/active-organization"
import { CurrentUser } from "@ren/protocol/middleware/authentication"
import { References } from "@ren/protocol/middleware/references"
import { Effect, Layer, Option, Ref, SchemaIssue } from "effect"
import { HttpApiError } from "effect/http-api"
import { McpCaller } from "./middleware/authentication.js"

export const currentActor = Effect.gen(function* () {
  const user = yield* CurrentUser
  const organization = yield* CurrentOrganization
  const agent = Option.flatMap(yield* Effect.serviceOption(McpCaller), (caller) => Option.fromUndefinedOr(caller.agent))
  return {
    userId: user.id,
    organizationId: organization.id,
    roles: organization.roles,
    ...(Option.isSome(agent) && { agent: agent.value }),
  } satisfies Actor.Info
})

export const references = Layer.effect(
  References,
  Effect.gen(function* () {
    const spaces = yield* Space.Service
    const agents = yield* Agent.Service
    const apps = yield* App.Service
    const profiles = yield* AppProfiles.Service
    const tasks = yield* Task.Service
    const schedules = yield* Schedules.Service
    const webhooks = yield* Webhooks.Service
    const templates = yield* MachineTemplates.Service
    const organization = yield* OrganizationSettings.Service
    const gets: Record<
      Primitive.Named,
      (actor: Actor.Info, name: string) => Effect.Effect<{ readonly id: string }, Primitive.NotFound>
    > = {
      space: spaces.get,
      agent: agents.get,
      app: apps.get,
      "app-profile": profiles.get,
      task: tasks.get,
      schedule: schedules.get,
      webhook: webhooks.get,
      "environment-template": templates.get,
      "organization-settings": organization.get,
    }
    return References.of(
      Effect.fn("References")(function* (httpEffect) {
        const actor = yield* currentActor
        const missed = yield* Ref.make(Option.none<NotFoundError>())
        const resolve = (primitive: Primitive.Named, name: string) =>
          gets[primitive](actor, name).pipe(
            Effect.map((found) => found.id),
            Effect.catchTag("Primitive.NotFound", (error) =>
              Effect.andThen(
                Ref.set(missed, Option.some(new NotFoundError({ message: error.message }))),
                Effect.fail(new SchemaIssue.InvalidValue({ message: error.message }, name)),
              ),
            ),
          )
        return yield* httpEffect.pipe(
          Effect.provideService(Primitive.Resolver, Primitive.Resolver.of({ resolve })),
          Effect.catch((error) =>
            Effect.flatMap(Ref.get(missed), (found): Effect.Effect<never, NotFoundError | typeof error> =>
              Option.isSome(found) && HttpApiError.HttpApiSchemaError.is(error)
                ? Effect.fail(found.value)
                : Effect.fail(error),
            ),
          ),
        )
      }),
    )
  }),
)

export const notFound = (error: Primitive.NotFound) => Effect.fail(new NotFoundError({ message: error.message }))
export const forbidden = (error: Primitive.Forbidden) => Effect.fail(new ForbiddenError({ message: error.message }))
export const conflict = (error: Primitive.Conflict) => Effect.fail(new ConflictError({ message: error.message }))
export const invalid = (error: Primitive.Invalid) =>
  Effect.fail(new InvalidRequestError({ message: error.message, ...(error.field && { field: error.field }) }))

export const list =
  <Input, Page>(method: (actor: Actor.Info, input: Input) => Effect.Effect<Page>) =>
  (request: { readonly query: Input }) =>
    Effect.flatMap(currentActor, (actor) => method(actor, request.query))

export const get =
  <Info>(method: (actor: Actor.Info, idOrSlug: string) => Effect.Effect<Info, Primitive.NotFound>) =>
  (request: { readonly params: { readonly idOrSlug: string } }) =>
    Effect.flatMap(currentActor, (actor) => method(actor, request.params.idOrSlug)).pipe(
      Effect.catchTag("Primitive.NotFound", notFound),
    )

export const create =
  <Input, Result>(
    method: (
      actor: Actor.Info,
      input: Input,
    ) => Effect.Effect<Result, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid>,
  ) =>
  (request: { readonly payload: Input }) =>
    Effect.flatMap(currentActor, (actor) => method(actor, request.payload)).pipe(
      Effect.catchTags({
        "Primitive.NotFound": notFound,
        "Primitive.Forbidden": forbidden,
        "Primitive.Conflict": conflict,
        "Primitive.Invalid": invalid,
      }),
    )

export const update =
  <ID, Input, Result>(
    method: (
      actor: Actor.Info,
      id: ID,
      input: Input,
    ) => Effect.Effect<Result, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid>,
  ) =>
  (request: { readonly params: { readonly id: ID }; readonly payload: Input }) =>
    Effect.flatMap(currentActor, (actor) => method(actor, request.params.id, request.payload)).pipe(
      Effect.catchTags({
        "Primitive.NotFound": notFound,
        "Primitive.Forbidden": forbidden,
        "Primitive.Conflict": conflict,
        "Primitive.Invalid": invalid,
      }),
    )

export const archive =
  <ID, Info>(
    method: (
      actor: Actor.Info,
      id: ID,
    ) => Effect.Effect<Info, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict>,
  ) =>
  (request: { readonly params: { readonly id: ID } }) =>
    Effect.flatMap(currentActor, (actor) => method(actor, request.params.id)).pipe(
      Effect.catchTags({
        "Primitive.NotFound": notFound,
        "Primitive.Forbidden": forbidden,
        "Primitive.Conflict": conflict,
      }),
    )

export const action =
  <ID, Input, Result>(
    method: (
      actor: Actor.Info,
      id: ID,
      input: Input,
    ) => Effect.Effect<Result, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict>,
  ) =>
  (request: { readonly params: { readonly id: ID }; readonly payload: Input }) =>
    Effect.flatMap(currentActor, (actor) => method(actor, request.params.id, request.payload)).pipe(
      Effect.catchTags({
        "Primitive.NotFound": notFound,
        "Primitive.Forbidden": forbidden,
        "Primitive.Conflict": conflict,
      }),
    )
