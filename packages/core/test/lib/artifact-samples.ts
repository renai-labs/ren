export * as ArtifactSamples from "./artifact-samples.js"

import { expect } from "bun:test"
import { Effect, Schedule, Schema } from "effect"
import { Database } from "@ren/db/database"
import { Artifact } from "@ren/schema/artifact"
import { SqlClient } from "effect/sql"
import { eq } from "drizzle-orm"
import { Artifacts } from "../../src/artifacts.js"

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

export const idle = (id: Artifact.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const sql = yield* SqlClient.SqlClient
    const before = (yield* database.db
      .select()
      .from(Database.Schema.artifact)
      .where(eq(Database.Schema.artifact.id, id))).at(0)
    if (before?.active_deployment_id) {
      const messages = yield* sql<{
        readonly payload: unknown
      }>`select payload::jsonb as payload from cluster_messages where entity_type = 'Workflow/ArtifactSettle' and payload::jsonb ->> 'id' = ${id} and payload::jsonb ->> 'claimId' = ${before.active_deployment_id}`
      const payload = yield* Schema.decodeUnknownEffect(Artifacts.SettleRun.payloadSchema)(messages.at(0)?.payload)
      yield* Artifacts.SettleRun.execute(payload)
    }
    const after = (yield* database.db
      .select()
      .from(Database.Schema.artifact)
      .where(eq(Database.Schema.artifact.id, id))).at(0)
    expect(after?.active_deployment_id).toBeNull()
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
