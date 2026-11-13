export * as ArtifactSamples from "./artifact-samples.js"

import { expect } from "bun:test"
import { Effect, Option, Schedule } from "effect"
import { Database } from "@ren/db/database"
import { Artifact } from "@ren/schema/artifact"
import { eq } from "drizzle-orm"
import { Artifacts } from "../../src/artifacts.js"
import { DurableRunner } from "../../src/durable-runner.js"

export const files = async (name: string) => {
  const root = new URL(`../fixtures/artifacts/${name}/`, import.meta.url).pathname
  const paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true }))
  return Object.fromEntries(
    await Promise.all(
      paths
        .filter((path) => path !== "wrangler.jsonc")
        .map(async (path): Promise<[string, Uint8Array]> => [
          path.replace(/^public\//u, ""),
          new Uint8Array(await Bun.file(`${root}${path}`).arrayBuffer()),
        ]),
    ),
  )
}

export const archive = (files: Readonly<Record<string, Uint8Array | string>>) =>
  new Bun.Archive(Object.fromEntries(Object.entries(files).map((entry) => [`artifact/${entry[0]}`, entry[1]])), {
    compress: "gzip",
  }).bytes()

export const published = Effect.fnUntraced(function* (
  artifacts: Artifacts.Interface,
  owner: Artifacts.Owner,
  id: Artifact.ID,
) {
  const link = yield* artifacts.download(owner, id)
  return yield* Effect.promise(async () =>
    Object.fromEntries(
      await Promise.all(
        [...(await new Bun.Archive(await (await fetch(link.url)).bytes()).files()).values()].map(
          async (file) => [file.name.slice(file.name.indexOf("/") + 1), await file.bytes()] as const,
        ),
      ),
    ),
  )
})

export const deploy = (
  artifacts: Artifacts.Interface,
  owner: Artifacts.Owner,
  id: Artifact.ID,
  input: {
    readonly deploymentId: Artifact.DeploymentID
    readonly title: string
    readonly config: Artifact.Config
    readonly files: Readonly<Record<string, Uint8Array>>
    readonly baseDeploymentId?: Artifact.DeploymentID
  },
) =>
  Effect.gen(function* () {
    const base =
      input.baseDeploymentId ??
      Option.getOrNull(yield* artifacts.read(owner, id).pipe(Effect.option))?.publishedDeploymentId
    const upload = yield* artifacts.upload(owner, id)
    const files = Object.fromEntries(Object.entries(input.files).filter((entry) => entry[0] !== Artifact.manifestPath))
    const body = yield* Effect.promise(() =>
      archive(
        input.config.durableObjects
          ? { ...files, [Artifact.manifestPath]: JSON.stringify({ durableObjects: input.config.durableObjects }) }
          : files,
      ),
    )
    const put = yield* Effect.promise(() => fetch(upload.url, { method: "PUT", body }))
    expect(put.status).toBe(200)
    return yield* artifacts.deploy(owner, id, {
      deploymentId: input.deploymentId,
      title: input.title,
      entry: input.config.entry,
      uploadId: upload.uploadId,
      ...(base && { baseDeploymentId: base }),
    })
  })

// oxlint-disable-next-line ren/no-comments -- Waits for the end of the run that holds the artifact's claim, through the engine's own completion signal.
export const idle = (id: Artifact.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const pending = (yield* database.db
      .select({ id: Database.Schema.artifact_deployment.id, kind: Database.Schema.artifact_deployment.kind })
      .from(Database.Schema.artifact)
      .innerJoin(
        Database.Schema.artifact_deployment,
        eq(Database.Schema.artifact_deployment.id, Database.Schema.artifact.pending_deployment_id),
      )
      .where(eq(Database.Schema.artifact.id, id))).at(0)
    if (pending)
      yield* DurableRunner.join(pending.kind === "stop" ? Artifacts.StopRun : Artifacts.DeployRun, {
        id,
        deploymentId: pending.id,
      })
    const after = (yield* database.db
      .select()
      .from(Database.Schema.artifact)
      .where(eq(Database.Schema.artifact.id, id))).at(0)
    expect(after?.pending_deployment_id).toBeNull()
  })

export const pages = (origin: string) =>
  Effect.gen(function* () {
    const report = yield* Effect.promise(() => fetch(`${origin}/report.html`).then((response) => response.text()))
    const dashboard = yield* Effect.promise(() => fetch(origin).then((response) => response.text()))
    const metrics = yield* Effect.promise(() => fetch(`${origin}/api/metrics`).then((response) => response.text()))
    expect(report).toContain("Quarterly operating report")
    expect(dashboard).toContain("Operations dashboard")
    expect(metrics).toContain("18420")
    expect((yield* Effect.promise(() => fetch(`${origin}/api/missing`))).status).toBe(404)
  })

export const retained = (origin: string, version: string) =>
  Effect.gen(function* () {
    const entries = yield* Effect.promise(() => fetch(`${origin}/api/entries`).then((response) => response.text()))
    expect(entries).toContain("Persistent")
    expect(entries).toContain(`"version":"${version}"`)
    expect(yield* Effect.promise(() => fetch(`${origin}/api/messages`).then((response) => response.text()))).toContain(
      "Durable hello",
    )
  })

export const guestbook = (origin: string) =>
  Effect.gen(function* () {
    expect(
      (yield* Effect.promise(() =>
        fetch(`${origin}/api/entries/welcome`, { method: "PUT", body: JSON.stringify({ text: "Persistent" }) }),
      )).status,
    ).toBe(200)
    yield* Effect.callback<void, Error>((resume) => {
      const first = new WebSocket(`${origin.replace(/^http/u, "ws")}/room`)
      const second = new WebSocket(`${origin.replace(/^http/u, "ws")}/room`)
      const close = Effect.sync(() => {
        first.close()
        second.close()
      })
      let opened = 0
      const onOpen = () => {
        opened += 1
        if (opened === 2) first.send("Durable hello")
      }
      first.addEventListener("open", onOpen)
      second.addEventListener("open", onOpen)
      second.addEventListener("message", (event) => {
        if (String(event.data).includes("Durable hello")) resume(close)
      })
      const fail = () => resume(close.pipe(Effect.andThen(Effect.fail(new Error("WebSocket failed")))))
      first.addEventListener("error", fail)
      second.addEventListener("error", fail)
      return close
    }).pipe(Effect.timeout("20 seconds"))
    yield* retained(origin, "1")
  })

export const edit = (origin: string) =>
  Effect.gen(function* () {
    expect(
      (yield* Effect.promise(() =>
        fetch(`${origin}/api/entries/welcome`, { method: "PUT", body: JSON.stringify({ text: "Edited" }) }),
      )).status,
    ).toBe(200)
    expect(yield* Effect.promise(() => fetch(`${origin}/api/entries`).then((response) => response.text()))).toContain(
      "Edited",
    )
    expect((yield* Effect.promise(() => fetch(`${origin}/api/entries/welcome`, { method: "DELETE" }))).status).toBe(204)
    expect(
      yield* Effect.promise(() => fetch(`${origin}/api/entries`).then((response) => response.text())),
    ).not.toContain("Edited")
    expect(yield* Effect.promise(() => fetch(`${origin}/api/messages`).then((response) => response.text()))).toContain(
      "Durable hello",
    )
  })

export const schemaUpgrade = <R, R2>(input: {
  readonly publish: (files: Artifact.Files) => Effect.Effect<Artifact.Deployment, unknown, R>
  readonly restart: (files: Artifact.Files) => Effect.Effect<string, unknown, R2>
  readonly files: Artifact.Files
  readonly origin: string
}) =>
  Effect.gen(function* () {
    let origin = input.origin
    expect(
      (yield* Effect.promise(() =>
        fetch(`${origin}/api/entries/welcome`, { method: "PUT", body: JSON.stringify({ text: "Persistent" }) }),
      )).status,
    ).toBe(200)
    const schema = () =>
      Effect.promise(async () => {
        const response = await fetch(`${origin}/api/schema`, { cache: "no-store" })
        return { status: response.status, body: await response.text() }
      }).pipe(
        Effect.repeat({ schedule: Schedule.spaced("250 millis"), until: (response) => response.status !== 404 }),
        Effect.timeout("10 seconds"),
      )
    const version = (id: number) =>
      schema().pipe(
        Effect.repeat({
          schedule: Schedule.spaced("250 millis"),
          until: (response) => response.body.includes(`"version":${id}`),
        }),
        Effect.timeout("20 seconds"),
        Effect.map((response) => response.body),
      )
    const rejected = () =>
      schema().pipe(
        Effect.repeat({ schedule: Schedule.spaced("250 millis"), until: (response) => response.status === 500 }),
        Effect.timeout("20 seconds"),
      )
    const source = new TextDecoder().decode(input.files["_worker.js"])
    expect(yield* version(1)).toContain('"version":1')
    const sql =
      'ALTER TABLE entries ADD COLUMN label TEXT NOT NULL DEFAULT "initial"; UPDATE entries SET label = "migrated";'
    const updated = {
      ...input.files,
      "_worker.js": new TextEncoder().encode(
        source.replace("\n]\n", `\n  { id: 2, sql: ${JSON.stringify(sql)} },\n]\n`),
      ),
    }
    expect((yield* input.publish(updated)).status).toBe("ready")
    const after = yield* version(2)
    expect(after).toContain('"version":2')
    expect(after).toContain('"label":"migrated"')
    origin = yield* input.restart(updated)
    expect(yield* version(2)).toBe(after)
    const brokenSql = "ALTER TABLE entries ADD COLUMN rejected TEXT; INSERT INTO nonexistent_table VALUES (1);"
    const broken = {
      ...updated,
      "_worker.js": new TextEncoder().encode(
        new TextDecoder()
          .decode(updated["_worker.js"])
          .replace("\n]\n", `\n  { id: 3, sql: ${JSON.stringify(brokenSql)} },\n]\n`),
      ),
    }
    expect((yield* input.publish(broken)).status).toBe("ready")
    expect((yield* rejected()).status).toBe(500)
    const correctedSql = 'ALTER TABLE entries ADD COLUMN rejected TEXT NOT NULL DEFAULT "corrected";'
    const corrected = {
      ...updated,
      "_worker.js": new TextEncoder().encode(
        new TextDecoder()
          .decode(updated["_worker.js"])
          .replace("\n]\n", `\n  { id: 3, sql: ${JSON.stringify(correctedSql)} },\n]\n`),
      ),
    }
    expect((yield* input.publish(corrected)).status).toBe("ready")
    const repaired = yield* version(3)
    expect(repaired).toContain('"version":3')
    expect(repaired).toContain('"rejected":"corrected"')
    expect(repaired).toContain("Persistent")
    const changed = {
      ...corrected,
      "_worker.js": new TextEncoder().encode(
        new TextDecoder()
          .decode(corrected["_worker.js"])
          .replace("CREATE TABLE IF NOT EXISTS entries", "CREATE TABLE IF NOT EXISTS entries "),
      ),
    }
    expect((yield* input.publish(changed)).status).toBe("ready")
    expect((yield* rejected()).status).toBe(500)
    expect((yield* input.publish(updated)).status).toBe("ready")
    expect((yield* rejected()).status).toBe(500)
    expect((yield* input.publish(corrected)).status).toBe("ready")
    expect(yield* version(3)).toBe(repaired)
  })
