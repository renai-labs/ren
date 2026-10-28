import { describe, expect } from "bun:test"
import { EnvironmentClient } from "@ren/environment-api/environment-client"
import { EnvironmentToken } from "@ren/environment-api/environment-token"
import { ExecutorVariables } from "@ren/environment-api/executor-variables"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Effect, Layer, Schedule } from "effect"
import { FetchHttpClient } from "effect/http"
import { testEffect } from "./lib/effect.js"
import { Image } from "./lib/image.js"
import { TestEnvironment } from "./lib/test-environment.js"

const hasDocker = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

const it = testEffect(FetchHttpClient.layer.pipe(Layer.orDie))

const docker = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["docker", ...args])
  if (result.exitCode !== 0) throw new Error(`docker ${args.at(0) ?? ""}: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

const remote = (placeholder: string, prefix = "org_1/drives/org/") => ({
  type: "s3" as const,
  bucket: "drives",
  prefix,
  region: "us-east-1",
  endpoint: "http://127.0.0.1:9100",
  placeholder,
})

const started = Effect.gen(function* () {
  const image = yield* Effect.promise(Image.buildMounting)
  const environmentId = Environment.ID.create()
  const variables = ExecutorVariables.make(environmentId, [TestEnvironment.keys.publicKey])
  const container = docker([
    "run",
    "--detach",
    "--publish",
    "127.0.0.1::4100",
    "--device",
    "/dev/fuse",
    "--cap-add",
    "SYS_ADMIN",
    "--security-opt",
    "apparmor=unconfined",
    ...Object.keys(variables).flatMap((name) => ["--env", `${name}=${variables[name] ?? ""}`]),
    image,
  ])
  yield* Effect.addFinalizer(() => Effect.sync(() => docker(["rm", "--force", container])))
  const exec = (script: string) => docker(["exec", container, "sh", "-c", script])
  exec(
    "mkdir -p /tmp/s3/drives/org_1/drives/org /tmp/s3/drives/org_1/drives/spaces/spc_1 && echo 'from the drive' > /tmp/s3/drives/org_1/drives/org/notes.txt",
  )
  docker([
    "exec",
    "--detach",
    container,
    "rclone",
    "serve",
    "s3",
    "/tmp/s3",
    "--addr",
    "127.0.0.1:9100",
    "--auth-key",
    "drive-key,drive-key",
  ])
  const token = yield* EnvironmentToken.sign(TestEnvironment.keys.privateKey, {
    environment: environmentId,
    brain: Brain.ID.create(),
    exp: Math.floor(Date.now() / 1000) + 600,
  })
  const client = yield* EnvironmentClient.make({
    url: new URL(`http://${docker(["port", container, "4100/tcp"]).split("\n").at(0) ?? ""}`),
    token: Effect.succeed(token),
  })
  const hello = yield* client["executor.hello"]().pipe(
    Effect.retry({ schedule: Schedule.spaced("200 millis"), times: 100 }),
  )
  return { exec, client, hello }
})

describe.skipIf(!hasDocker)("drives.mount", () => {
  it.live(
    "mounts a drive once however often it is asked, even while rclone is slow, mounts it again after rclone dies, and fails with rclone's error when the keys are refused or with the error of a folder it cannot make",
    () =>
      Effect.gen(function* () {
        const environment = yield* started
        const exec = environment.exec
        const client = environment.client
        expect(environment.hello.mount).toBe(true)
        const rclones = () => exec("pgrep -f '^rclone mount' | wc -l")
        const read = client["files.read"]({ path: "/tmp/drives/org/notes.txt" }).pipe(
          Effect.map((result) => new TextDecoder().decode(result.bytes)),
        )
        const org = { path: "/tmp/drives/org", remote: remote("drive-key"), access: "read" as const }

        yield* client["drives.mount"](org)
        const first = exec("pgrep -f '^rclone mount'")
        yield* client["drives.mount"](org)
        expect(exec("pgrep -f '^rclone mount'")).toBe(first)
        expect(yield* read).toBe("from the drive\n")

        exec("pkill -STOP -f '^rclone mount'")
        yield* client["drives.mount"](org)
        exec("pkill -CONT -f '^rclone mount'")
        expect(exec("pgrep -f '^rclone mount'")).toBe(first)

        exec("pkill -9 -f '^rclone mount'")
        yield* client["drives.mount"](org)
        expect(rclones()).toBe("1")
        expect(yield* read).toBe("from the drive\n")

        const refused = yield* client["drives.mount"]({
          ...org,
          path: "/tmp/drives/refused",
          remote: remote("wrong"),
        }).pipe(Effect.flip)
        expect(refused._tag).toBe("MountError")
        expect(refused.message).toContain("403")

        exec("touch /tmp/file")
        const unmade = yield* client["drives.mount"]({ ...org, path: "/tmp/file/drive" }).pipe(Effect.flip)
        expect(unmade._tag).toBe("MountError")
        expect(unmade.message).toContain("ENOTDIR")
      }),
    300_000,
  )

  it.live(
    "a read-only drive refuses writes; mounted again writable, it uploads what is written in it within seconds",
    () =>
      Effect.gen(function* () {
        const environment = yield* started
        const client = environment.client
        const space = { path: "/tmp/drives/space", remote: remote("drive-key", "org_1/drives/spaces/spc_1/") }
        const write = client["files.write"]({
          path: "/tmp/drives/space/reports/q3.md",
          bytes: new TextEncoder().encode("by the agent\n"),
        })

        yield* client["drives.mount"]({ ...space, access: "read" })
        expect((yield* Effect.flip(write))._tag).toBe("FileSystemError")

        yield* client["drives.mount"]({ ...space, access: "write" })
        yield* write
        const uploaded = Effect.try(() =>
          environment.exec("cat /tmp/s3/drives/org_1/drives/spaces/spc_1/reports/q3.md"),
        ).pipe(Effect.retry({ schedule: Schedule.spaced("500 millis"), times: 40 }))
        expect(yield* uploaded).toBe("by the agent")
      }),
    300_000,
  )
})
