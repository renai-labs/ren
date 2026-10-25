export * as Primitive from "./primitive.js"

import { Actor } from "@ren/core/actor"
import { Primitive } from "@ren/core/primitive"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError } from "@ren/protocol/errors"
import { CurrentOrganization } from "@ren/protocol/middleware/active-organization"
import { CurrentUser } from "@ren/protocol/middleware/authentication"
import { Effect, Option } from "effect"
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

const notFound = (error: Primitive.NotFound) => Effect.fail(new NotFoundError({ message: error.message }))
const forbidden = (error: Primitive.Forbidden) => Effect.fail(new ForbiddenError({ message: error.message }))
const conflict = (error: Primitive.Conflict) => Effect.fail(new ConflictError({ message: error.message }))
const invalid = (error: Primitive.Invalid) =>
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
