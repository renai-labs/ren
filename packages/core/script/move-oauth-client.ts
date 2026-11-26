import { parseArgs } from "node:util"
import { SQL } from "bun"
import { Config, ConfigProvider, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Auth } from "@ren/schema/auth"
import { Credentials } from "../src/credentials.js"
import { Envelope } from "../src/envelope.js"

const usage = `Usage:
  bun --env-file=<env file> run move-oauth-client [--hold | --apply]

Moves the OAuth connections to Ren's hosted MCP servers from one Ren client ID to another, with no
sign-in again. Use it when Ren's address changes: a connection made at the old address names the old
client ID, and the hosted MCP servers accept a refresh token only from the client it was issued to.
Without a flag, the script counts the connections it would move and changes nothing. Before the
change of address, --hold takes their refresh lease for two hours, so that Ren refreshes none of them
while neither client ID works. After it, --apply moves them and gives the lease back. It reads:
  DATABASE_URL       Ren's database
  ENVELOPE_KEYS      Ren's master keys, which seal each connection
  MCP_SEALING_KEY    the hosted MCP servers' sealing key, which seals their tokens
  FROM_CLIENT_ID     the old client ID, <old REN_URL>/oauth/client.json
  TO_CLIENT_ID       the new client ID, <new REN_URL>/oauth/client.json
  TOKEN_HOST         the hosted MCP servers' host, which a moved connection's token endpoint names`

const args = parseArgs({
  options: { hold: { type: "boolean" }, apply: { type: "boolean" }, help: { type: "boolean" } },
})

// oxlint-disable-next-line ren/no-comments -- The hosted MCP servers' refresh token: `<app>_rt_` and a sealed { aud, client_id, connection }, kept for 90 days. The sealing below repeats theirs.
const RefreshToken = Schema.Struct({ aud: Schema.String, client_id: Schema.String, connection: Schema.String })
const refreshLifetime = 90 * 24 * 60 * 60
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const sealerOf = async (secret: string, app: string) => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("ren-hosted-mcp"),
      info: encoder.encode(`${app}:seal-v1`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
  const additionalData = encoder.encode("refresh")
  return {
    open: async (token: string) => {
      const bytes = Buffer.from(token, "base64url")
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData },
        key,
        bytes.subarray(12),
      )
      return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ v: RefreshToken })))(decoder.decode(plain))
        .v
    },
    seal: async (value: typeof RefreshToken.Type) => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const envelope = { v: value, exp: Math.floor(Date.now() / 1000) + refreshLifetime }
      const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData },
        key,
        encoder.encode(JSON.stringify(envelope)),
      )
      return Buffer.concat([iv, new Uint8Array(cipher)]).toString("base64url")
    },
  }
}

const SealedJson = Schema.fromJsonString(Credentials.Sealed)
const Rows = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    organization_id: Schema.String,
    value: Envelope.Sealed,
    revision: Schema.Number,
  }),
)
const encodeEnvelope = Schema.encodeSync(Schema.fromJsonString(Envelope.Sealed))

const program = Effect.gen(function* () {
  if (args.values.help) return yield* Effect.log(usage)
  const config = yield* Config.all({
    database: Config.Redacted("DATABASE_URL"),
    sealingKey: Config.Redacted("MCP_SEALING_KEY"),
    from: Config.String("FROM_CLIENT_ID"),
    to: Config.String("TO_CLIENT_ID"),
    tokenHost: Config.String("TOKEN_HOST"),
  }).pipe(
    Effect.mapError((error) => new Error(`${error.message}\n\n${usage}`)),
    Effect.orDie,
  )
  const envelope = yield* Envelope.Service
  const sql = new SQL(Redacted.value(config.database))
  const rows = Schema.decodeUnknownSync(Rows)(
    yield* Effect.promise(
      (): Promise<unknown> =>
        sql`select id, organization_id, value, revision from credential where type = 'oauth' and status = 'ok'`,
    ),
  )
  const found = yield* Effect.forEach(rows, (row) =>
    Effect.gen(function* () {
      const context = {
        organizationId: Auth.OrganizationID.make(row.organization_id),
        kind: "credential",
        id: row.id,
      } as const
      const value = Schema.decodeSync(SealedJson)(Redacted.value(yield* envelope.open(row.value, context)))
      if (value.type !== "oauth" || !value.refresh) return Option.none()
      const refresh = value.refresh
      if (refresh.clientId !== config.from || new URL(refresh.tokenEndpoint).host !== config.tokenHost)
        return Option.none()
      return Option.some({ row, context, value, refresh })
    }).pipe(Effect.orDie),
  )
  const moves = found.flatMap((entry) => Option.toArray(entry))
  yield* Effect.log(`${moves.length} of ${rows.length} OAuth connections name the old client ID at the token host.`)
  if (args.values.hold) {
    const held = yield* Effect.forEach(moves, (move) =>
      Effect.promise(
        (): Promise<unknown> =>
          sql`update credential set refresh_lease_at = now() + interval '2 hours' where id = ${move.row.id} and status = 'ok'
            returning id`,
      ).pipe(Effect.map((updated) => Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(updated).length)),
    )
    yield* Effect.promise(() => sql.close())
    return yield* Effect.log(`Held ${held.reduce((total, each) => total + each, 0)} of ${moves.length}.`)
  }
  if (!args.values.apply) return yield* Effect.log("Run again with --hold before the change, and --apply after it.")
  const moved = yield* Effect.forEach(moves, (move) =>
    Effect.gen(function* () {
      const token = Redacted.value(move.refresh.refreshToken)
      const parts = /^(.+)_rt_(.+)$/u.exec(token)
      const app = parts?.at(1)
      const sealed = parts?.at(2)
      if (!app || !sealed) return 0
      const sealer = yield* Effect.promise(() => sealerOf(Redacted.value(config.sealingKey), app))
      const opened = yield* Effect.promise(() => sealer.open(sealed))
      if (opened.client_id !== config.from) return 0
      const next = {
        ...move.value,
        refresh: {
          ...move.refresh,
          clientId: config.to,
          refreshToken: Redacted.make(
            `${app}_rt_${yield* Effect.promise(() => sealer.seal({ ...opened, client_id: config.to }))}`,
          ),
        },
      }
      const value = yield* envelope.seal(Redacted.make(Schema.encodeSync(SealedJson)(next)), move.context)
      const updated = yield* Effect.promise(
        (): Promise<unknown> =>
          sql`update credential set value = ${encodeEnvelope(value)}::jsonb, revision = revision + 1, refresh_lease_at = null, updated_at = now()
            where id = ${move.row.id} and revision = ${move.row.revision} returning id`,
      )
      return Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(updated).length
    }).pipe(Effect.orDie),
  )
  yield* Effect.promise(() => sql.close())
  const count = moved.reduce((total, each) => total + each, 0)
  yield* Effect.log(`Moved ${count} of ${moves.length}. Run again to retry a connection that changed meanwhile.`)
})

await Effect.runPromise(
  program.pipe(Effect.provide(Envelope.layerLocal.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv()))))),
)
