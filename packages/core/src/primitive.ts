export * as Primitive from "./primitive.js"

import { Primitive } from "@ren/schema/primitive"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Cause, Effect, Option, Schema } from "effect"
import { SqlError } from "effect/sql"
import { Actor } from "./actor.js"

export const action = Primitive.action

export class NotFound extends Schema.TaggedError<NotFound>()("Primitive.NotFound", { message: Schema.String }) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Primitive.Forbidden", { message: Schema.String }) {}

export class Conflict extends Schema.TaggedError<Conflict>()("Primitive.Conflict", { message: Schema.String }) {}

export class Invalid extends Schema.TaggedError<Invalid>()("Primitive.Invalid", {
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

export const uniqueConflict =
  (constraint: string, message: string) =>
  (error: EffectDrizzleQueryError): Effect.Effect<never, Conflict | EffectDrizzleQueryError> => {
    const failure = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none()
    const isMatchingUniqueViolation =
      Option.isSome(failure) &&
      SqlError.isSqlError(failure.value) &&
      failure.value.reason._tag === "UniqueViolation" &&
      failure.value.reason.constraint === constraint
    return isMatchingUniqueViolation ? Effect.fail(new Conflict({ message })) : Effect.fail(error)
  }

type Input<Operation> = Operation extends { readonly input: Schema.Top } ? Operation["input"]["Type"] : never

type Result<Operation> = Operation extends { readonly result: Schema.Top } ? Operation["result"]["Type"] : never

type Page<Operation> = Operation extends { readonly page: Schema.Top } ? Operation["page"]["Type"] : never

interface Methods<D extends Primitive.Definition> {
  readonly list: (actor: Actor.Info, input: Input<D["list"]>) => Effect.Effect<Page<D["list"]>>
  readonly get: (actor: Actor.Info, idOrSlug: string) => Effect.Effect<D["info"]["Type"], NotFound>
  readonly create: (
    actor: Actor.Info,
    input: Input<D["create"]>,
  ) => Effect.Effect<Result<D["create"]>, NotFound | Forbidden | Conflict | Invalid>
  readonly update: (
    actor: Actor.Info,
    id: D["id"]["Type"],
    input: Input<D["update"]>,
  ) => Effect.Effect<Result<D["update"]>, NotFound | Forbidden | Conflict | Invalid>
  readonly archive: (
    actor: Actor.Info,
    id: D["id"]["Type"],
  ) => Effect.Effect<D["info"]["Type"], NotFound | Forbidden | Conflict>
}

type Actions<D extends Primitive.Definition> = {
  readonly [Name in keyof D["actions"]]: (
    actor: Actor.Info,
    id: D["id"]["Type"],
    input: Input<D["actions"][Name]>,
  ) => Effect.Effect<Result<D["actions"][Name]>, NotFound | Forbidden | Conflict>
}

export type Interface<D extends Primitive.Definition> = Pick<Methods<D>, keyof D & keyof Methods<D>> & Actions<D>
