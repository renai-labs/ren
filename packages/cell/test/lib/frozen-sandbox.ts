export * as FrozenSandbox from "./frozen-sandbox.js"

import { TestHand, Relay } from "@ren/executor/testing"
import { Effect } from "effect"
import { createServer, type Socket } from "node:net"

export const make = Effect.gen(function* () {
  const machinePort = Relay.portOf(yield* TestHand.url)
  const relay = yield* Relay.make(machinePort)
  const sockets = new Set<Socket>()
  const hole = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const server = createServer((socket) => sockets.add(socket))
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      return server
    }),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => resolve())
          }),
      ),
  )
  const address = hole.address()
  const holePort = typeof address === "object" && address !== null ? address.port : 0
  return {
    url: relay.url,
    freeze: relay.freeze.pipe(Effect.andThen(relay.target(holePort))),
    thaw: relay.target(machinePort),
  }
})
