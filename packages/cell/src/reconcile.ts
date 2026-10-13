export * as Reconcile from "./reconcile.js"

export interface Item {
  readonly id: string
  readonly type: "user" | "synthetic" | "compaction" | "move"
}

export interface Session {
  readonly active: boolean
  readonly inbox: ReadonlyArray<Item>
  readonly unfinished: boolean
}

export type Work =
  | { readonly _tag: "Running" }
  | { readonly _tag: "Queued"; readonly item: Item }
  | { readonly _tag: "Resuming" }
  | { readonly _tag: "Idle" }

export const work = (session: Session): Work => {
  if (session.active) return { _tag: "Running" }
  const item = session.inbox.find((candidate) => candidate.type === "user")
  if (item) return { _tag: "Queued", item }
  return session.unfinished ? { _tag: "Resuming" } : { _tag: "Idle" }
}
