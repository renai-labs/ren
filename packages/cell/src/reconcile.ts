export * as Reconcile from "./reconcile.js"

export interface Item {
  readonly id: string
  readonly type: "user" | "synthetic" | "compaction" | "move"
}

export interface Snapshot {
  readonly active: boolean
  readonly inbox: ReadonlyArray<Item>
  readonly unfinished: boolean
  readonly questionAgeMs: number | undefined
}

export type Work =
  | { readonly _tag: "Running" }
  | { readonly _tag: "Unanswered" }
  | { readonly _tag: "Queued"; readonly item: Item }
  | { readonly _tag: "Resuming" }
  | { readonly _tag: "Idle" }

export const work = (snapshot: Snapshot, parkAfterMs: number): Work => {
  if (snapshot.active && (snapshot.questionAgeMs ?? 0) >= parkAfterMs) return { _tag: "Unanswered" }
  if (snapshot.active) return { _tag: "Running" }
  const item = snapshot.inbox.find((candidate) => candidate.type === "user")
  if (item) return { _tag: "Queued", item }
  return snapshot.unfinished ? { _tag: "Resuming" } : { _tag: "Idle" }
}
