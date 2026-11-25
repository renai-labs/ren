import { fileURLToPath } from "node:url"
import { OpenCodeHost } from "@ren/cell/testing"
import { RenRpc } from "@renai-labs/opencode/rpc"
import { Effect, Queue, Schema, Stream } from "effect"

const Outcome = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("rpc.ren.signedIn"),
    data: Schema.Struct({ attempt: Schema.String, user: RenRpc.User }),
  }),
  Schema.Struct({
    type: Schema.Literal("rpc.ren.loginFailed"),
    data: Schema.Struct({ attempt: Schema.String, message: Schema.String }),
  }),
])

const result = await Effect.gen(function* () {
  const host = yield* OpenCodeHost.make({ plugins: [fileURLToPath(new URL("../../opencode", import.meta.url))] })
  const rpc = host.client.rpc(RenRpc.Definition)
  const at = { location: host.location }
  if (process.argv.at(2) === "logout") return yield* rpc.logout({}, at)
  const events = yield* Queue.unbounded<unknown>()
  yield* host.client.event.subscribe({ types: ["rpc.ren.signedIn", "rpc.ren.loginFailed"] }).pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped,
  )
  yield* Queue.take(events)
  const attempt = crypto.randomUUID()
  const started = yield* rpc.login({ attempt }, at)
  process.stderr.write(`${started.url}\n`)
  const outcome = yield* Queue.take(events).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Outcome)),
    Effect.repeat({ until: (event) => event.data.attempt === attempt }),
  )
  return outcome.data
}).pipe(Effect.scoped, Effect.runPromise)

process.stdout.write(`${JSON.stringify(result)}\n`)
process.exitCode = "message" in result ? 1 : 0
