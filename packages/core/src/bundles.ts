export * as Bundles from "./bundles.js"

import { Database } from "@ren/db/database"
import { Bundle } from "@ren/schema/bundle"
import { Signature } from "@ren/schema/signature"
import { eq, sql } from "drizzle-orm"
import { Clock, Config, Context, DateTime, Duration, Effect, Layer, Option, Schema } from "effect"
import { join } from "node:path"
import { Signer } from "./signer.js"

export class NotFound extends Schema.TaggedError<NotFound>()("Bundles.NotFound", { message: Schema.String }) {}

export interface Interface {
  readonly current: (kind: Bundle.Kind) => Effect.Effect<Option.Option<Bundle.Info>>
  // oxlint-disable-next-line ren/no-comments -- A token that lets a machine download one bundle from Ren for 15 min.
  readonly token: (bundle: Pick<Bundle.Info, "kind" | "version">) => Effect.Effect<string>
  // oxlint-disable-next-line ren/no-comments -- The archive on this server's disk, for a valid token of that bundle. A server that does not have it answers NotFound; the machine asks again later.
  readonly file: (token: string, bundle: Pick<Bundle.Info, "kind" | "version">) => Effect.Effect<string, NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Bundles") {}

const tokenLifetime = Duration.minutes(15)

const Claims = Schema.Struct({
  kid: Schema.String,
  exp: Schema.Int,
  typ: Schema.Literal("bundle"),
  kind: Bundle.Kind,
  version: Bundle.Version,
})

const bundles = Database.Schema.bundle

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const signer = yield* Signer.Service
    const directory = yield* Config.option(Config.String("REN_BUNDLES"))
    // oxlint-disable-next-line ren/no-comments -- At start, the bundles this server was built with become current when they are a later build (EN29), or when this server has no file for the current one: after a rollback, machines must still get code that a running server serves.
    const built = yield* Option.match(directory, {
      onNone: () => Effect.succeed(Option.none<Bundle.Manifest>()),
      onSome: (path) =>
        Effect.promise(() => Bun.file(join(path, "manifest.json")).text()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Bundle.Manifest))),
          Effect.map(Option.some),
          Effect.orDie,
        ),
    })
    if (Option.isSome(built))
      yield* Effect.forEach(
        built.value.bundles,
        (bundle) =>
          database.db
            .insert(bundles)
            .values({
              kind: bundle.kind,
              version: bundle.version,
              sha256: bundle.sha256,
              built_at: DateTime.toDateUtc(built.value.builtAt),
            })
            .onConflictDoUpdate({
              target: bundles.kind,
              set: {
                version: sql`excluded.version`,
                sha256: sql`excluded.sha256`,
                built_at: sql`excluded.built_at`,
              },
              setWhere: sql`${bundles.built_at} < excluded.built_at or ${bundles.version} not in (${sql.join(
                built.value.bundles.map((each) => sql`${each.version}`),
                sql`, `,
              )})`,
            })
            .pipe(Effect.orDie),
        { discard: true },
      )
    const has = (bundle: Pick<Bundle.Info, "kind" | "version">) =>
      Option.exists(built, (manifest) =>
        manifest.bundles.some((each) => each.kind === bundle.kind && each.version === bundle.version),
      )

    return Service.of({
      current: Effect.fn("Bundles.current")(function* (kind: Bundle.Kind) {
        const row = (yield* database.db.select().from(bundles).where(eq(bundles.kind, kind)).pipe(Effect.orDie)).at(0)
        return Option.map(Option.fromNullishOr(row), (found) => ({
          kind: found.kind,
          version: found.version,
          sha256: found.sha256,
        }))
      }),
      token: Effect.fn("Bundles.token")(function* (bundle: Pick<Bundle.Info, "kind" | "version">) {
        const exp = Math.floor(((yield* Clock.currentTimeMillis) + Duration.toMillis(tokenLifetime)) / 1000)
        return yield* signer
          .sign("brain", { typ: "bundle", kind: bundle.kind, version: bundle.version, exp })
          .pipe(Effect.orDie)
      }),
      file: Effect.fn("Bundles.file")(function* (token: string, bundle: Pick<Bundle.Info, "kind" | "version">) {
        const keys = yield* signer.publicKeys("brain").pipe(Effect.orDie)
        const claims = yield* Signature.verify(keys, Claims, token)
        const isFor = Option.exists(claims, (found) => found.kind === bundle.kind && found.version === bundle.version)
        if (!isFor || Option.isNone(directory) || !has(bundle))
          return yield* new NotFound({ message: `This server has no bundle ${bundle.kind} ${bundle.version} for you` })
        return join(directory.value, Bundle.fileOf(bundle))
      }),
    })
  }),
)
