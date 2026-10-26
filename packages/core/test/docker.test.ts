import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Docker } from "../src/environment-provider/docker.js"
import { testEffect } from "./lib/effect.js"

const hasDocker = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

const it = testEffect(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer))

describe.skipIf(!hasDocker)("the Docker environment provider", () => {
  it.live("refuses a config without an image, and says so for the form", () =>
    Effect.gen(function* () {
      const provider = yield* Docker.provider
      expect((yield* provider.check({ cpus: 1 }).pipe(Effect.flip))._tag).toBe("EnvironmentProvider.InvalidConfig")
      expect(provider.info.configSchema).toMatchObject({
        schema: { required: ["image"], properties: { image: { title: "Image" } } },
      })
    }),
  )
})
