import { expect } from "bun:test"
import { EnvironmentClient } from "@ren/environment-api/environment-client"
import { Duration, Effect, Fiber, Option, Stream } from "effect"
import { Socket } from "node:net"
import { TestEnvironment } from "./lib/test-environment.js"
import { testEffect } from "./lib/effect.js"
import { TestServer } from "./lib/server.js"

const it = testEffect(TestServer.layer)

it.live(
  "keeps a silent process's output stream open past the server's idle timeout",
  () =>
    Effect.gen(function* () {
      const api = yield* TestServer.client()
      const spawned = yield* api["process.spawn"]({ command: "sh", arguments: ["-c", "sleep 12; echo late"] })
      const events = yield* api["process.output"]({ id: spawned.id }).pipe(Stream.runCollect)
      expect(events.findLast((event) => event.type !== "ping")).toEqual({ type: "exit", exitCode: 0, signal: null })
    }),
  20_000,
)

it.live(
  "releases a request whose client never ends its body or sends it a byte at a time, and serves others meanwhile",
  () =>
    Effect.gen(function* () {
      const bearer = `Bearer ${yield* TestServer.token()}`
      const address = new URL(yield* TestEnvironment.url)
      const startedAt = Date.now()
      const stalled = (options: { readonly trickle: boolean }) =>
        Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const socket = new Socket().connect(Number(address.port), address.hostname, () => {
                socket.write(
                  `POST ${EnvironmentClient.path} HTTP/1.1\r\nHost: ${address.host}\r\nAuthorization: ${bearer}\r\nContent-Type: application/ndjson\r\nContent-Length: 1000\r\n\r\n{"_tag":"Request"`,
                )
                const timer = options.trickle ? setInterval(() => socket.write(" "), 4000) : undefined
                socket.on("close", () => clearInterval(timer))
              })
              socket.on("close", () => resolve(Date.now() - startedAt))
              socket.on("error", () => socket.destroy())
            }),
        ).pipe(Effect.forkScoped)
      const silent = yield* stalled({ trickle: false })
      const slow = yield* stalled({ trickle: true })
      expect((yield* TestServer.post(TestServer.rpc("executor.hello", null), bearer)).status).toBe(200)
      const released = yield* Effect.all([Fiber.join(silent), Fiber.join(slow)]).pipe(
        Effect.timeoutOption(Duration.seconds(20)),
      )
      expect(Option.isSome(released) && released.value.every((milliseconds) => milliseconds < 15_000)).toBe(true)
      expect((yield* TestServer.post(TestServer.rpc("executor.hello", null), bearer)).status).toBe(200)
    }),
  30_000,
)
