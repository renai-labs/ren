export * as OpenCodeHost from "./opencode-host.js"

import { OpenCode } from "@opencode/client"
import { AbsolutePath } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeServer } from "../../src/harness/opencode/server.js"

export const make = Effect.fnUntraced(function* (
  config: Readonly<Record<string, unknown>>,
  options: { readonly database?: string; readonly version?: string } = {},
) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-opencode-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() =>
      ManagedRuntime.make(
        createEmbeddedRoutes({
          database: { path: options.database ?? ":memory:" },
          config: { directory, project: false, content: JSON.stringify(config) },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
          ...(options.version && { app: { version: options.version } }),
        }).pipe(Layer.provide(HttpServer.layerServices)),
      ),
    ),
    (opened) => opened.disposeEffect,
  )
  const fetch = HttpEffect.toWebHandler(Context.get(yield* runtime.contextEffect, HttpRouter.HttpRouter).asHttpEffect())
  return {
    location: { directory: AbsolutePath.make(directory) },
    client: yield* OpenCodeServer.client(fetch),
    promise: OpenCode.make({
      baseUrl: "http://opencode",
      fetch: Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          fetch(input instanceof Request ? new Request(input, init) : new Request(String(input), init)),
        { preconnect: globalThis.fetch.preconnect },
      ),
    }),
  }
})
