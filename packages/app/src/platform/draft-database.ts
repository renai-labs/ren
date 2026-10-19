export * as DraftDatabase from "./draft-database.js"

import { Option, Schema } from "effect"
import { DraftChunks } from "./draft-chunks.js"
import type { DraftStore } from "./draft-store.js"

const documents = "documents"
const chunks = "chunks"

const Documents = Schema.Array(Schema.String)
const Counts = Schema.Array(Schema.Int)
const ChunkKeys = Schema.Array(Schema.Tuple([Schema.String, Schema.Int]))
const Texts = Schema.Array(Schema.String)

const result = <A>(request: IDBRequest<A>) =>
  new Promise<A>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () => reject(request.error ?? new Error("The draft database request failed")))
  })

const done = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve())
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("The draft database write failed")),
    )
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("The draft database write failed")),
    )
  })

const after = (key: string, index: number) => IDBKeyRange.bound([key, index], [key, Infinity])

const decode = <S extends Schema.Decoder<unknown>>(schema: S, value: unknown) =>
  Option.getOrElse(Schema.decodeUnknownOption(schema)(value), () => [])

export function open(): Promise<DraftStore.Large | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined)
  const request = indexedDB.open("ren-drafts", 1)
  request.addEventListener("upgradeneeded", () => {
    request.result.createObjectStore(documents)
    request.result.createObjectStore(chunks)
  })
  return result(request)
    .then(async (database) => {
      const read = database.transaction([documents, chunks], "readonly")
      const loaded = await Promise.all([
        result(read.objectStore(documents).getAllKeys()),
        result(read.objectStore(documents).getAll()),
        result(read.objectStore(chunks).getAllKeys()),
        result(read.objectStore(chunks).getAll()),
      ])
      const keys = decode(Documents, loaded[0])
      const counts = decode(Counts, loaded[1])
      const texts = decode(Texts, loaded[3])
      const stored = new Map(
        decode(ChunkKeys, loaded[2]).map((key, index) => [`${key[0]}\u0000${key[1]}`, texts[index]]),
      )
      const transact = (use: (transaction: IDBTransaction) => void) =>
        Promise.resolve().then(() => {
          const transaction = database.transaction([documents, chunks], "readwrite")
          use(transaction)
          return done(transaction)
        })
      return {
        loaded: new Map(
          keys.map((key, index) => [
            key,
            DraftChunks.join(counts[index] ?? 0, (chunk) => stored.get(`${key}\u0000${chunk}`)),
          ]),
        ),
        write: (key, count, changed) =>
          transact((transaction) => {
            transaction.objectStore(documents).put(count, key)
            transaction.objectStore(chunks).delete(after(key, count))
            for (const chunk of changed) transaction.objectStore(chunks).put(chunk.text, [key, chunk.index])
          }),
        remove: (key) =>
          transact((transaction) => {
            transaction.objectStore(documents).delete(key)
            transaction.objectStore(chunks).delete(after(key, 0))
          }),
      } satisfies DraftStore.Large
    })
    .catch(() => undefined)
}
