export * as Relay from "./relay.js"

import { Effect } from "effect"
import { connect, createServer, type Socket } from "node:net"

export interface Instance {
  readonly url: string
  readonly cut: Effect.Effect<void>
  readonly freeze: Effect.Effect<void>
  readonly refuse: (refusing: boolean) => Effect.Effect<void>
  readonly target: (port: number) => Effect.Effect<void>
}

interface Pair {
  readonly client: Socket
  readonly upstream: Socket
}

export const portOf = (url: string) => Number(new URL(url).port)

const destroy = (pair: Pair) => {
  pair.client.destroy()
  pair.upstream.destroy()
}

export const make = (port: number) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const state = { port, refusing: false }
      const live = new Set<Pair>()
      const frozen = new Set<Pair>()
      const server = createServer((client) => {
        if (state.refusing) {
          client.destroy()
          return
        }
        const pair = { client, upstream: connect(state.port, "127.0.0.1") }
        const close = () => {
          live.delete(pair)
          destroy(pair)
        }
        live.add(pair)
        client.on("error", close).on("close", close)
        pair.upstream.on("error", close).on("close", close)
        client.pipe(pair.upstream)
        pair.upstream.pipe(client)
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      const instance: Instance = {
        url: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`,
        cut: Effect.sync(() => {
          for (const pair of live) destroy(pair)
        }),
        freeze: Effect.sync(() => {
          for (const pair of live) {
            live.delete(pair)
            frozen.add(pair)
            pair.client.unpipe(pair.upstream)
            pair.upstream.unpipe(pair.client)
            pair.client.pause()
            pair.upstream.pause()
          }
        }),
        refuse: (refusing) =>
          Effect.sync(() => {
            state.refusing = refusing
          }),
        target: (next) =>
          Effect.sync(() => {
            state.port = next
          }),
      }
      return { server, instance, pairs: () => [...live, ...frozen] }
    }),
    (relay) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const pair of relay.pairs()) destroy(pair)
            relay.server.close(() => resolve())
          }),
      ),
  ).pipe(Effect.map((relay) => relay.instance))
