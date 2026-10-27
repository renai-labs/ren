import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { ExecutorVariables } from "@ren/environment-api/executor-variables"
import { EnvironmentToken } from "@ren/environment-api/environment-token"
import { EnvironmentClient } from "@ren/environment-api/environment-client"
import { Image, TestEnvironment } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Environment } from "@ren/schema/environment"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Docker } from "../src/environment-provider/docker.js"
import { testEffect } from "./lib/effect.js"

const hasDocker = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

const it = testEffect(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer))

describe.skipIf(!hasDocker)("the Docker environment provider", () => {
  it.live(
    "makes one container for an environment however often it is asked, serves Ren's executor there, and destroys it",
    () =>
      Effect.gen(function* () {
        const provider = yield* Docker.provider
        const image = yield* Effect.promise(Image.build)
        const config = yield* provider.check({ image, memoryMiB: 512 })
        const environmentId = Environment.ID.create()
        const input = {
          environmentId,
          environmentTemplateId: EnvironmentTemplate.ID.create(),
          config,
          variables: ExecutorVariables.make(environmentId, [TestEnvironment.keys.publicKey]),
        }
        const bindings = yield* Effect.all([provider.provision(input), provider.provision(input)], {
          concurrency: "unbounded",
        })
        expect(bindings[1]).toEqual(bindings[0])
        yield* Effect.addFinalizer(() => provider.destroy(bindings[0]).pipe(Effect.ignore))
        const endpoint = yield* provider.connect(bindings[0])
        const token = yield* EnvironmentToken.sign(TestEnvironment.keys.privateKey, {
          environment: input.environmentId,
          brain: Brain.ID.create(),
          exp: Math.floor(Date.now() / 1000) + 60,
        })
        const client = yield* EnvironmentClient.make({ url: endpoint.url, token: Effect.succeed(token) })
        const hello = yield* client["executor.hello"]()
        expect(hello.environmentId).toBe(input.environmentId)
        const written = new TextEncoder().encode("written by the executor")
        yield* client["files.write"]({ path: "session/note.txt", bytes: written })
        expect((yield* client["files.read"]({ path: "session/note.txt" })).bytes).toEqual(written)
        yield* provider.destroy(bindings[0])
        yield* provider.destroy(bindings[0])
        expect((yield* provider.connect(bindings[0]).pipe(Effect.flip))._tag).toBe("EnvironmentProvider.Gone")
      }),
    180_000,
  )
})
