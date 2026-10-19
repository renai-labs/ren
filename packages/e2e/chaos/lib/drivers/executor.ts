export * as ExecutorDriver from "./executor.js"

import type { ProcessEvent, ProcessID } from "@ren/hand-api/executor-api"
import { ExecutorClient } from "@ren/hand-api/executor-client"
import { Cause, Effect, Exit, ManagedRuntime, Predicate, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { Wait } from "../wait.js"

export const errorTag = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return "success"
  const error = Cause.squash(exit.cause)
  if (Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag)) return error._tag
  return Cause.hasInterruptsOnly(exit.cause) ? "Interrupt" : "Defect"
}

export const connect = async (url: string, token: string) => {
  const runtime = ManagedRuntime.make(FetchHttpClient.layer)
  const scope = Effect.runSync(Scope.make())
  const client = await runtime.runPromise(
    ExecutorClient.make({ url, token: Effect.succeed(token) }).pipe(Scope.provide(scope)),
  )
  const run = <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromiseExit(effect)
  const ok = async <A, E>(effect: Effect.Effect<A, E>) => {
    const exit = await run(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw new Error(`executor call failed with ${errorTag(exit)}: ${Cause.pretty(exit.cause)}`)
  }
  const output = async (id: ProcessID, ms = 30_000) => {
    const events: Array<ProcessEvent> = []
    const exit = await Wait.deadline(
      `process.output ${id}`,
      ms,
      run(
        client["process.output"]({ id }).pipe(
          Stream.takeUntil((event) => event.type === "exit"),
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
        ),
      ),
      () => `${events.length} events received`,
    )
    return {
      stdout: new TextDecoder().decode(
        Buffer.concat(events.flatMap((event) => (event.type === "stdout" ? [event.bytes] : []))),
      ),
      exit: events.find((event) => event.type === "exit"),
      error: Exit.isFailure(exit) ? errorTag(exit) : undefined,
    }
  }
  return {
    client,
    run,
    ok,
    output,
    dispose: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await runtime.dispose()
    },
  }
}

export type Driver = Awaited<ReturnType<typeof connect>>
