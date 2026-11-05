import { describe, expect } from "bun:test"
import { EnvironmentClient } from "@ren/environment-api/environment-client"
import { EnvironmentToken } from "@ren/environment-api/environment-token"
import { ExecutorVariables } from "@ren/environment-api/executor-variables"
import { TestEnvironment } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Identifier } from "@ren/schema/identifier"
import { Effect, Option, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { E2BEnvironment } from "../src/environment-provider/e2b.js"
import { testEffect } from "./lib/effect.js"

// oxlint-disable-next-line ren/no-comments -- environments test 12: runs only with E2B_API_KEY and E2B_ENVIRONMENT_BASE, and makes a real E2B template and sandbox.
const isLive = Boolean(Bun.env.E2B_API_KEY && Bun.env.E2B_ENVIRONMENT_BASE)

const it = testEffect(FetchHttpClient.layer)

const outputOf = (client: EnvironmentClient.Client, script: string) =>
  Effect.gen(function* () {
    const spawned = yield* client["process.spawn"]({ command: "sh", arguments: ["-c", script] })
    const events = yield* client["process.output"]({ id: spawned.id }).pipe(Stream.runCollect)
    return events
      .flatMap((event) => (event.type === "stdout" ? [new TextDecoder().decode(event.bytes)] : []))
      .join("")
      .trim()
  })

const statusOf = (client: EnvironmentClient.Client, url: string) =>
  outputOf(client, `curl -s -o /dev/null -w '%{http_code}' --max-time 15 ${url} || true`)

describe.skipIf(!isLive)("the E2B environment provider, live", () => {
  it.live(
    "a template's packages are in its image; a limited environment reaches a listed host and cannot reach an unlisted host or an ngrok host",
    () =>
      Effect.gen(function* () {
        const provider = yield* E2BEnvironment.provider
        const build = Option.getOrThrow(provider.build)
        const environmentTemplateId = EnvironmentTemplate.ID.create()
        const config = yield* provider.check({
          packages: { apt: ["ffmpeg"], npm: ["typescript"], pip: ["requests"] },
          buildCommands: ["echo built > /home/user/built.txt"],
        })
        yield* Effect.addFinalizer(() =>
          Effect.promise(() =>
            fetch(
              `https://api.e2b.dev/templates/ren-environment-${Identifier.suffix(environmentTemplateId).toLowerCase()}`,
              { method: "DELETE", headers: { "x-api-key": Bun.env.E2B_API_KEY ?? "" } },
            ),
          ),
        )
        const image = yield* build.run({ environmentTemplateId, config, tag: "live" })
        const environmentId = Environment.ID.create()
        const network = { hosts: Option.some(["example.com", "*.github.com"]), proxy: Option.none() }
        const binding = yield* provider.provision({
          environmentId,
          environmentTemplateId,
          config,
          image: Option.some(image),
          network,
          variables: ExecutorVariables.make(environmentId, [TestEnvironment.keys.publicKey]),
        })
        yield* Effect.addFinalizer(() => provider.destroy(binding).pipe(Effect.ignore))
        const endpoint = yield* provider.connect(binding, network)
        const token = yield* EnvironmentToken.sign(TestEnvironment.keys.privateKey, {
          environment: environmentId,
          brain: Brain.ID.create(),
          exp: Math.floor(Date.now() / 1000) + 600,
        })
        const client = yield* EnvironmentClient.make({ url: endpoint.url, token: Effect.succeed(token) })
        const reached = yield* Effect.all({
          listed: statusOf(client, "https://example.com"),
          apex: statusOf(client, "https://github.com"),
          unlisted: statusOf(client, "https://example.org"),
          ngrok: statusOf(client, "https://ren-environments-test.ngrok-free.app"),
        })
        expect(reached).toEqual({ listed: "200", apex: "200", unlisted: "000", ngrok: "000" })
        const installed = yield* outputOf(
          client,
          "ffmpeg -version >/dev/null && echo ffmpeg; tsc -v; python3 -c 'import requests; print(\"requests\")'; cat /home/user/built.txt",
        )
        expect(installed.split("\n").map((line) => line.replace(/^Version .*/u, "tsc"))).toEqual([
          "ffmpeg",
          "tsc",
          "requests",
          "built",
        ])
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
    1_200_000,
  )
})
