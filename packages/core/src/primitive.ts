export * as Primitive from "./primitive.js"

import { Primitive } from "@ren/schema/primitive"
import { Effect, Schema } from "effect"
import { Actor } from "./actor.js"

export class NotFound extends Schema.TaggedError<NotFound>()("Primitive.NotFound", { message: Schema.String }) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Primitive.Forbidden", { message: Schema.String }) {}

export class Conflict extends Schema.TaggedError<Conflict>()("Primitive.Conflict", { message: Schema.String }) {}

type Write<D extends Primitive.Definition, W extends Primitive.Write> = (
  actor: Actor.Info,
  id: D["id"]["Type"],
  input: W["input"]["Type"],
) => Effect.Effect<W["result"]["Type"], NotFound | Forbidden | Conflict>

export type Interface<D extends Primitive.Definition> = (D extends { readonly list: Primitive.List }
  ? {
      readonly list: (actor: Actor.Info, input: D["list"]["input"]["Type"]) => Effect.Effect<D["list"]["page"]["Type"]>
    }
  : unknown) &
  (D extends { readonly get: true }
    ? { readonly get: (actor: Actor.Info, idOrSlug: string) => Effect.Effect<D["info"]["Type"], NotFound> }
    : unknown) &
  (D extends { readonly create: Primitive.Write }
    ? {
        readonly create: (
          actor: Actor.Info,
          input: D["create"]["input"]["Type"],
        ) => Effect.Effect<D["create"]["result"]["Type"], Conflict>
      }
    : unknown) &
  (D extends { readonly update: Primitive.Write } ? { readonly update: Write<D, D["update"]> } : unknown) &
  (D extends { readonly archive: true }
    ? {
        readonly archive: (
          actor: Actor.Info,
          id: D["id"]["Type"],
        ) => Effect.Effect<D["info"]["Type"], NotFound | Forbidden>
      }
    : unknown) &
  (D extends { readonly actions: Readonly<Record<string, Primitive.Write>> }
    ? { readonly [Name in keyof D["actions"]]: Write<D, D["actions"][Name]> }
    : unknown)
