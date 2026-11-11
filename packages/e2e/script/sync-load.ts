// oxlint-disable-next-line ren/no-comments -- Chaos row 58: the brains of the spaces whose name starts with <prefix> each sync one message of the largest size Ren takes (Sync.maxBodyBytes), all at once, to a running Ren; the script prints the answers (503 above the bytes in flight that Ren allows) and Ren's memory before, at the peak and after. Run it with the server's env files, after a chat has started a brain in each space: bun --env-file=<server.env> --env-file=<secrets> script/sync-load.ts <prefix>
import { BrainClient } from "@ren/core/brain-client"
import { Signer } from "@ren/core/signer"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Sync } from "@ren/schema/sync"
import { Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"

const Env = Schema.Struct({ DATABASE_URL: Schema.String, PORT: Schema.NumberFromString })

const Rows = Schema.Array(
  Schema.Struct({
    id: Brain.ID,
    generation: Schema.Number,
    organization_id: Auth.OrganizationID,
    session_id: Schema.String,
  }),
)
const env = Schema.decodeUnknownSync(Env)(Bun.env)
const prefix = process.argv[2]
if (!prefix) throw new Error("usage: sync-load.ts <space name prefix>")
const ren = `http://localhost:${env.PORT}`

const rows = Schema.decodeUnknownSync(Rows)(
  await new Bun.SQL(env.DATABASE_URL)`
  select b.id, b.generation, b.organization_id, (select s.id from agent_session s where s.space_id = b.space_id order by s.id limit 1) as session_id
  from brain b join space p on p.id = b.space_id
  where p.name like ${`${prefix}%`}`,
)
const brains = await Effect.runPromise(
  Effect.gen(function* () {
    const client = yield* BrainClient.Service
    return yield* Effect.forEach(rows, (row) =>
      Effect.map(
        client.hostToken({ brainId: row.id, generation: row.generation, organizationId: row.organization_id }),
        (token) => ({ sessionId: row.session_id, token }),
      ),
    )
  }).pipe(Effect.provide(BrainClient.layer.pipe(Layer.provide([Signer.layerLocal, FetchHttpClient.layer])))),
)

const server = Bun.spawnSync(["lsof", "-nP", `-iTCP:${env.PORT}`, "-sTCP:LISTEN", "-t"])
  .stdout.toString()
  .trim()
  .split("\n")
  .at(0)
const memory = () =>
  Number(
    Bun.spawnSync(["ps", "-o", "rss=", "-p", server ?? ""])
      .stdout.toString()
      .trim(),
  ) / 1024
const samples: Array<number> = []
const sampling = setInterval(() => samples.push(memory()), 250)
await Bun.sleep(3000)
const baseline = Math.max(...samples)

// oxlint-disable-next-line ren/no-comments -- One row of the largest size that Ren takes in one request (Sync.maxBodyBytes), less room for the envelope.
const text = "x".repeat(Sync.maxBodyBytes - 1024)
const opened = await Promise.all(
  brains.map(async (brain) => {
    const headers = { authorization: `Bearer ${brain.token}`, "content-type": "application/json" }
    const started = await fetch(`${ren}/host/sync/sessions/${brain.sessionId}/uploads`, {
      method: "POST",
      headers,
      body: JSON.stringify({ harness: "opencode", parentId: null }),
    })
    const upload = Schema.decodeUnknownSync(Schema.Struct({ upload: Schema.Int }))(await started.json()).upload
    const body = JSON.stringify({
      messages: [
        {
          id: `msg_load_${crypto.randomUUID()}`,
          session_id: brain.sessionId,
          type: "user",
          seq: 1,
          data: JSON.stringify({ text }),
        },
      ],
    })
    return { url: `${ren}/host/sync/sessions/${brain.sessionId}/uploads/${upload}/messages`, headers, body }
  }),
)
const sent = Date.now()
const statuses = await Promise.all(
  opened.map((each) =>
    fetch(each.url, { method: "POST", headers: each.headers, body: each.body }).then((response) => response.status),
  ),
)
const took = Date.now() - sent
await Bun.sleep(30_000)
clearInterval(sampling)
console.log(
  JSON.stringify({
    brains: brains.length,
    bytesEach: opened.at(0)?.body.length,
    statuses: Object.fromEntries(
      [...new Set(statuses)].map((status) => [status, statuses.filter((each) => each === status).length]),
    ),
    sentInMs: took,
    memoryMB: {
      baseline: Math.round(baseline),
      peak: Math.round(Math.max(...samples)),
      after30s: Math.round(samples.at(-1) ?? 0),
    },
  }),
)
