import { BunServices } from "@effect/platform-bun"
import { Config, Effect } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const program = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  if (process.env.REN_ARTIFACT_SMOKE_DRY_RUN === "1") {
    yield* Config.all({
      account: Config.NonEmptyString("CLOUDFLARE_ACCOUNT_ID"),
      token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
      namespace: Config.NonEmptyString("ARTIFACT_CLOUDFLARE_NAMESPACE"),
      domain: Config.NonEmptyString("ARTIFACT_DOMAIN"),
    })
    yield* Effect.log(
      "Cloudflare credentials, namespace and domain are set. No Cloudflare calls or deployments performed.",
    )
    return
  }
  if (process.env.REN_ARTIFACT_SMOKE_APPROVED !== "1")
    return yield* Effect.die(
      new Error("Set REN_ARTIFACT_SMOKE_APPROVED=1 only after approval for live tests on the dispatch namespace"),
    )
  const config = yield* Config.all({
    account: Config.NonEmptyString("CLOUDFLARE_ACCOUNT_ID"),
    token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
    namespace: Config.NonEmptyString("ARTIFACT_CLOUDFLARE_NAMESPACE"),
    domain: Config.NonEmptyString("ARTIFACT_DOMAIN"),
  })
  yield* Effect.forEach(["artifacts-cloudflare.slow.test.ts", "artifacts-brain.slow.test.ts"], (file) =>
    Effect.gen(function* () {
      const code = yield* spawner
        .exitCode(
          ChildProcess.make(process.execPath, ["test", `./test/${file}`], {
            cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
            stdout: "inherit",
            stderr: "inherit",
            forceKillAfter: "3 seconds",
            extendEnv: true,
            env: {
              REN_ARTIFACT_CLOUDFLARE_LIVE: "1",
              CLOUDFLARE_ACCOUNT_ID: config.account,
              CLOUDFLARE_API_TOKEN: config.token,
              ARTIFACT_CLOUDFLARE_NAMESPACE: config.namespace,
              ARTIFACT_DOMAIN: config.domain,
            },
          }),
        )
        .pipe(Effect.timeout("10 minutes"))
      if (code !== 0) return yield* Effect.die(new Error(`Cloudflare integration failed: ${file}`))
    }),
  )
  yield* Effect.log(
    "Real Ren workflow and brain tests passed through the dispatch namespace. Test Workers and their data remain behind stopped responses.",
  )
})

await Effect.runPromise(program.pipe(Effect.provide(BunServices.layer)))
