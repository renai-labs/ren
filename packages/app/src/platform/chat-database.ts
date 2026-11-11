export * as ChatDatabase from "./chat-database.js"

import { Option, Schema } from "effect"
import type { Platform } from "./platform.js"

const meta = "meta"
const bodies = "bodies"

const version = 1

const totalBytes = 100 * 1024 * 1024

const Meta = Schema.Struct({
  userId: Schema.String,
  sessionID: Schema.String,
  tier: Schema.Int,
  usedAt: Schema.Finite,
  bytes: Schema.Int,
  version: Schema.Int,
})
type Meta = typeof Meta.Type

const Metas = Schema.Array(Meta)

const result = <A>(request: IDBRequest<A>) =>
  new Promise<A>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () => reject(request.error ?? new Error("The chat cache request failed")))
  })

const done = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve())
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("The chat cache write failed")))
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("The chat cache write failed")))
  })

const evictions = (entries: ReadonlyArray<Meta>, limit: number) => {
  const order = entries.toSorted((a, b) => b.tier - a.tier || a.usedAt - b.usedAt)
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  return order.reduce<{ readonly left: number; readonly removed: ReadonlyArray<Meta> }>(
    (state, entry) =>
      state.left > limit ? { left: state.left - entry.bytes, removed: [...state.removed, entry] } : state,
    { left: total, removed: [] },
  ).removed
}

export function open(): Promise<Platform.ChatCache | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined)
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("ren-chats", version)
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(meta)
      request.result.createObjectStore(bodies)
    })
    request.addEventListener("blocked", () => reject(new Error("Another tab holds an older chat cache")))
    void result(request).then(resolve, reject)
  })
    .then((database): Platform.ChatCache => {
      database.addEventListener("versionchange", () => database.close())
      const state = { off: false }
      const guard = <A>(work: () => Promise<A>) =>
        state.off
          ? Promise.resolve()
          : work().then(
              (value) => value,
              () => {
                state.off = true
              },
            )
      const metas = (transaction: IDBTransaction) =>
        result(transaction.objectStore(meta).getAll()).then((all) =>
          Option.getOrElse(Schema.decodeUnknownOption(Metas)(all), () => []),
        )
      const drop = (transaction: IDBTransaction, entries: ReadonlyArray<Meta>) => {
        for (const entry of entries) {
          transaction.objectStore(meta).delete([entry.userId, entry.sessionID])
          transaction.objectStore(bodies).delete([entry.userId, entry.sessionID])
        }
      }
      return {
        read: (userId, sessionID) =>
          guard(async () => {
            const transaction = database.transaction([meta, bodies], "readwrite")
            const known = Schema.decodeUnknownOption(Meta)(
              await result(transaction.objectStore(meta).get([userId, sessionID])),
            )
            const body = Schema.decodeUnknownOption(Schema.String)(
              await result<unknown>(transaction.objectStore(bodies).get([userId, sessionID])),
            )
            if (Option.isNone(known) || Option.isNone(body) || known.value.version !== version) {
              if (Option.isSome(known)) drop(transaction, [known.value])
              await done(transaction)
              return
            }
            transaction.objectStore(meta).put({ ...known.value, usedAt: Date.now() }, [userId, sessionID])
            await done(transaction)
            return body.value
          }),
        write: (userId, sessionID, entry) =>
          guard(async () => {
            const transaction = database.transaction([meta, bodies], "readwrite")
            const all = await metas(transaction)
            const previous = all.find((each) => each.userId === userId && each.sessionID === sessionID)
            const next = {
              userId,
              sessionID,
              tier: Math.min(entry.tier, previous?.tier ?? entry.tier),
              usedAt: Date.now(),
              bytes: entry.body.length,
              version,
            }
            transaction.objectStore(meta).put(next, [userId, sessionID])
            transaction.objectStore(bodies).put(entry.body, [userId, sessionID])
            drop(transaction, evictions([...all.filter((each) => each !== previous), next], totalBytes))
            await done(transaction)
          }),
        remove: (userId, sessionID) =>
          guard(async () => {
            const transaction = database.transaction([meta, bodies], "readwrite")
            transaction.objectStore(meta).delete([userId, sessionID])
            transaction.objectStore(bodies).delete([userId, sessionID])
            await done(transaction)
          }),
        forget: (keep) =>
          guard(async () => {
            const transaction = database.transaction([meta, bodies], "readwrite")
            drop(
              transaction,
              (await metas(transaction)).filter((each) => each.userId !== keep),
            )
            await done(transaction)
          }),
      }
    })
    .catch(() => undefined)
}
