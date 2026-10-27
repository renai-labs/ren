export * as Credentials from "./credentials.js"

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { Directories } from "../directories.js"

export interface Credential extends Schema.Schema.Type<typeof Credential> {}
export const Credential = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
})

const Stored = Schema.fromJsonString(Schema.Record(Schema.String, Credential))

export class Service extends Context.Service<
  Service,
  {
    readonly get: (server: URL) => Effect.Effect<Credential | undefined, Error>
    readonly set: (server: URL, credential: Credential) => Effect.Effect<void, Error>
    readonly remove: (server: URL) => Effect.Effect<void, Error>
  }
>()("@ren/cli/Credentials") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = Directories.config()
    const file = path.join(directory, "credentials.json")
    const read = Effect.gen(function* () {
      if (!(yield* fs.exists(file))) return {}
      return yield* Schema.decodeEffect(Stored)(yield* fs.readFileString(file)).pipe(
        Effect.mapError(() => new Error(`Invalid credentials in ${file}. Run ren2 login.`)),
      )
    })
    const write = Effect.fn("Credentials.write")(function* (stored: typeof Stored.Type) {
      yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 })
      const temporary = `${file}.${process.pid}`
      yield* fs.writeFileString(temporary, yield* Schema.encodeEffect(Stored)(stored), { mode: 0o600 })
      yield* fs.rename(temporary, file)
    })
    return {
      get: (server) => Effect.map(read, (stored) => stored[server.origin]),
      set: Effect.fn("Credentials.set")(function* (server, credential) {
        yield* write({ ...(yield* read), [server.origin]: credential })
      }),
      remove: Effect.fn("Credentials.remove")(function* (server) {
        const stored = yield* read
        yield* write(Object.fromEntries(Object.entries(stored).filter((entry) => entry.at(0) !== server.origin)))
      }),
    }
  }),
)
