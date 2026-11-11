import { BunServices } from "@effect/platform-bun"
import { Config, Effect } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const program = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  if (process.env.REN_ARTIFACT_SMOKE_DRY_RUN === "1") {
    const version = yield* spawner
      .string(ChildProcess.make(process.env.ARTIFACT_NODE ?? "node", ["--version"], { forceKillAfter: "3 seconds" }))
      .pipe(Effect.timeout("5 seconds"))
    yield* Effect.log(
      `Node ${version.trim()}; Wrangler ${fileURLToPath(import.meta.resolve("wrangler/package.json"))}. No Cloudflare calls or deployments performed.`,
    )
    return
  }
  if (process.env.REN_ARTIFACT_SMOKE_APPROVED !== "1")
    return yield* Effect.die(
      new Error("Set REN_ARTIFACT_SMOKE_APPROVED=1 only after approval for ordinary Free Worker integration tests"),
    )
  const config = yield* Config.all({
    account: Config.NonEmptyString("CLOUDFLARE_ACCOUNT_ID"),
    token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
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
            },
          }),
        )
        .pipe(Effect.timeout("10 minutes"))
      if (code !== 0) return yield* Effect.die(new Error(`Cloudflare integration failed: ${file}`))
    }),
  )
  yield* Effect.log(
    "Real Ren workflow/brain tests passed against ordinary Workers. No WFP, paid-plan or DNS changes. Test Workers/data remain retained behind stopped responses.",
  )
})

await Effect.runPromise(program.pipe(Effect.provide(BunServices.layer)))
