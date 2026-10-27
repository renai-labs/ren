export * as ChatTest from "./chat.js"

import { Effect, Option, type Scope, Stream, SubscriptionRef } from "effect"

export const live = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

export const until = <A>(ref: SubscriptionRef.SubscriptionRef<A>, predicate: (value: A) => boolean) =>
  SubscriptionRef.changes(ref).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
    Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () => Effect.die(new Error("The chat state never reached the expected value")),
    }),
  )
