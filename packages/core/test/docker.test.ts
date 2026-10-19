import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/hand-api/environment-token"
import { ExecutorClient } from "@ren/hand-api/executor-client"
import { Image, Sandbox } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Hand } from "@ren/schema/hand"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Docker } from "../src/hand-provider/docker.js"
import { testEffect } from "./lib/effect.js"

const hasDocker = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

const it = testEffect(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer))

describe.skipIf(!hasDocker)("the Docker hand provider", () => {
  it.live(
    "makes one container for a hand however often it is asked, serves Ren's executor there, and destroys it",
    () =>
      Effect.gen(function* () {
        const provider = yield* Docker.provider
        const image = yield* Effect.promise(Image.build)
        const config = yield* provider.check({ image, memoryMiB: 512 })
        const input = {
          handId: Hand.ID.create(),
          environmentId: Environment.ID.create(),
          config,
          publicKeys: [Sandbox.keys.publicKey] as const,
        }
        const bindings = yield* Effect.all([provider.provision(input), provider.provision(input)], {
          concurrency: "unbounded",
        })
        expect(bindings[1]).toEqual(bindings[0])
        yield* Effect.addFinalizer(() => provider.destroy(bindings[0]).pipe(Effect.ignore))
        const endpoint = yield* provider.connect(bindings[0])
        const token = yield* EnvironmentToken.sign(Sandbox.keys.privateKey, {
          env: input.environmentId,
          brain: Brain.ID.create(),
          exp: Math.floor(Date.now() / 1000) + 60,
        })
        const client = yield* ExecutorClient.make({ url: endpoint.url, token: Effect.succeed(token) })
        const hello = yield* client["executor.hello"]()
        expect(hello.environmentId).toBe(input.environmentId)
        yield* provider.destroy(bindings[0])
        yield* provider.destroy(bindings[0])
        expect((yield* provider.connect(bindings[0]).pipe(Effect.flip))._tag).toBe("HandProvider.Gone")
      }),
    180_000,
  )

  it.live("refuses a config without an image, and says so for the form", () =>
    Effect.gen(function* () {
      const provider = yield* Docker.provider
      expect((yield* provider.check({ cpus: 1 }).pipe(Effect.flip))._tag).toBe("HandProvider.InvalidConfig")
      expect(provider.info.configSchema).toMatchObject({
        schema: { required: ["image"], properties: { image: { title: "Image" } } },
      })
    }),
  )
})
