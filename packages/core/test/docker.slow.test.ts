import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { HandToken } from "@ren/hand-api/hand-token"
import { HandClient } from "@ren/hand-api/hand-client"
import { Image, TestHand } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { Docker } from "../src/machine-provider/docker.js"
import { MachineProvider } from "../src/machine-provider.js"
import { testEffect } from "./lib/effect.js"

const hasDocker = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

const it = testEffect(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer))

describe.skipIf(!hasDocker)("the Docker environment provider", () => {
  it.live(
    "makes one container for an environment's generation however often it is asked, a new one for the next generation, serves Ren's executor there, and destroys it",
    () =>
      Effect.gen(function* () {
        const provider = yield* Docker.provider
        const image = yield* Effect.promise(Image.build)
        const config = yield* provider.check({ image, memoryMiB: 512 })
        const environmentId = Hand.ID.create()
        const input = {
          labels: {
            kind: "hand" as const,
            id: environmentId,
            generation: 1,
            organizationId: Auth.OrganizationID.create(),
            spaceId: Space.ID.create(),
          },
          config,
          variables: ExecutorVariables.make(environmentId, [TestHand.keys.publicKey]),
          image: Option.none(),
          network: MachineProvider.unrestricted,
        }
        const created = yield* Effect.all([provider.create(input), provider.create(input)], {
          concurrency: "unbounded",
        })
        const binding = created[0].binding
        expect(created[1].binding).toEqual(binding)
        yield* Effect.addFinalizer(() => provider.destroy(binding).pipe(Effect.ignore))
        const replaced = yield* provider.create({ ...input, labels: { ...input.labels, generation: 2 } })
        yield* Effect.addFinalizer(() => provider.destroy(replaced.binding).pipe(Effect.ignore))
        expect(replaced.binding).not.toEqual(binding)
        const url = new URL((yield* provider.connect(binding, MachineProvider.unrestricted)).url)
        const token = yield* HandToken.sign(TestHand.keys.privateKey, {
          environment: environmentId,
          brain: Brain.ID.create(),
          exp: Math.floor(Date.now() / 1000) + 60,
        })
        const client = yield* HandClient.make({ url, token: Effect.succeed(token) })
        const hello = yield* client["executor.hello"]()
        expect(hello.environmentId).toBe(environmentId)
        const written = new TextEncoder().encode("written by the executor")
        yield* client["files.write"]({ path: "session/note.txt", bytes: written })
        expect((yield* client["files.read"]({ path: "session/note.txt" })).bytes).toEqual(written)
        yield* provider.destroy(binding)
        yield* provider.destroy(binding)
        expect((yield* provider.connect(binding, MachineProvider.unrestricted).pipe(Effect.flip))._tag).toBe(
          "MachineProvider.Gone",
        )
      }),
    180_000,
  )
})
