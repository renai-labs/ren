export * as DriveHand from "./drive-hand.js"

import { HandClient } from "@ren/hand-api/hand-client"
import { HandToken } from "@ren/hand-api/hand-token"
import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Effect, Schedule } from "effect"
import { Image } from "./image.js"
import { TestHand } from "./test-hand.js"

export const hasDocker = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

const docker = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["docker", ...args])
  if (result.exitCode !== 0) throw new Error(`docker ${args.at(0) ?? ""}: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

export const endpoint = "http://127.0.0.1:9100"

export const key = "drive-key"

export const remote = (placeholder: string, prefix = "org_1/drives/org/") => ({
  type: "s3" as const,
  bucket: "drives",
  prefix,
  region: "us-east-1",
  endpoint,
  placeholder,
})

export const start = Effect.gen(function* () {
  const image = yield* Effect.promise(Image.buildMounting)
  const environmentId = Hand.ID.create()
  const variables = ExecutorVariables.make(environmentId, [TestHand.keys.publicKey])
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
    `${key},${key}`,
  ])
  const url = new URL(`http://${docker(["port", container, "4100/tcp"]).split("\n").at(0) ?? ""}`)
  const token = yield* HandToken.sign(TestHand.keys.privateKey, {
    environment: environmentId,
    brain: Brain.ID.create(),
    exp: Math.floor(Date.now() / 1000) + 600,
  })
  const client = yield* HandClient.make({ url, token: Effect.succeed(token) })
  const hello = yield* client["executor.hello"]().pipe(
    Effect.retry({ schedule: Schedule.spaced("200 millis"), times: 100 }),
  )
  return {
    environmentId,
    url,
    exec,
    client,
    hello,
    put: (object: string, text: string) =>
      exec(
        `echo '${text}' | rclone rcat --s3-no-check-bucket --s3-provider Minio --s3-region us-east-1 --s3-endpoint ${endpoint} --s3-force-path-style --s3-access-key-id ${key} --s3-secret-access-key ${key} :s3:drives/${object}`,
      ),
  }
})
