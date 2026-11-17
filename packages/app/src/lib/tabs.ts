export * as Tabs from "./tabs.js"

import { Option, Schema } from "effect"
import { useSyncExternalStore } from "react"
import { Platform } from "../platform/platform.js"

// oxlint-disable-next-line ren/no-comments -- A tab is any page of the app with its own back and forward history. Moving around the app moves the shown tab, and "+" adds a tab.
const Tab = Schema.Struct({
  id: Schema.String,
  pinned: Schema.optional(Schema.Boolean),
  stack: Schema.Struct({ entries: Schema.Array(Schema.String), index: Schema.Number }),
})
export type Tab = typeof Tab.Type

const State = Schema.Struct({ tabs: Schema.Array(Tab), active: Schema.Number })
export type State = typeof State.Type

export type Move = "push" | "replace" | "back" | "forward"

export type Closed = { readonly tab: Tab; readonly index: number }

const empty: State = { tabs: [], active: 0 }

const make = (entries: ReadonlyArray<string>): Tab => ({
  id: crypto.randomUUID(),
  stack: { entries, index: entries.length - 1 },
})

export const hrefOf = (tab: Tab) => tab.stack.entries.at(tab.stack.index) ?? ""

export const chatOf = (href: string) => /\/sessions\/([^/?#]+)/u.exec(href)?.[1]

const pinnedCount = (tabs: ReadonlyArray<Tab>) => tabs.filter((tab) => tab.pinned).length

const shownTab = (state: State) => state.tabs.at(state.active)

const at = (tab: Tab, entries: ReadonlyArray<string>, index: number): Tab => ({
  ...tab,
  stack: { entries, index },
})

const withShown = (state: State, tab: Tab): State => ({
  ...state,
  tabs: state.tabs.map((each, index) => (index === state.active ? tab : each)),
})

// oxlint-disable-next-line ren/no-comments -- After tabs move, the tab that was shown stays shown.
const keepShown = (state: State, tabs: ReadonlyArray<Tab>): State => ({
  tabs,
  active: Math.max(
    tabs.findIndex((each) => each.id === shownTab(state)?.id),
    0,
  ),
})

// oxlint-disable-next-line ren/no-comments -- A new tab goes at the end; Back in it goes to a new chat first.
export const open = (state: State, href: string, home: string): State => ({
  tabs: [...state.tabs, make(href === home ? [href] : [home, href])],
  active: state.tabs.length,
})

const steps: Readonly<Record<Move, number>> = { push: 0, replace: 0, back: -1, forward: 1 }

// oxlint-disable-next-line ren/no-comments -- Another tab that shows this chat, which a move to the chat switches to.
const holder = (state: State, href: string) => {
  const chat = chatOf(href)
  const shown = shownTab(state)
  if (!chat || !shown || chatOf(hrefOf(shown)) === chat) return -1
  return state.tabs.findIndex((each) => chatOf(hrefOf(each)) === chat)
}

// oxlint-disable-next-line ren/no-comments -- Back and Forward step through the shown tab's own history. Going to a chat that another tab shows switches to that tab. A pinned tab keeps its chat, so going to another chat opens a new tab. Any other move changes the shown tab.
export const navigated = (state: State, href: string, move: Move, home: string): State => {
  const tab = shownTab(state)
  if (!tab) return { tabs: [make([href])], active: 0 }
  if (hrefOf(tab) === href) return state
  const stack = tab.stack
  const step = steps[move]
  if (step !== 0 && stack.entries.at(stack.index + step) === href)
    return withShown(state, at(tab, stack.entries, stack.index + step))
  if (move === "replace") return withShown(state, at(tab, stack.entries.with(stack.index, href), stack.index))
  const other = holder(state, href)
  if (other !== -1) return { ...state, active: other }
  if (tab.pinned && chatOf(href) !== chatOf(hrefOf(tab))) return open(state, href, home)
  return withShown(state, at(tab, [...stack.entries.slice(0, stack.index + 1), href], stack.index + 1))
}

// oxlint-disable-next-line ren/no-comments -- Closing keeps the shown tab when it stays; when it goes, the tab now in its place shows, else the last. Closing every tab leaves one new chat. Pinned tabs stay through "close others" and "close to the right".
export const close = (state: State, ids: ReadonlySet<string>, home: string) => {
  const closed = state.tabs.flatMap((tab, index) => (ids.has(tab.id) ? [{ tab, index }] : []))
  const tabs = state.tabs.filter((tab) => !ids.has(tab.id))
  if (tabs.length === 0) return { state: { tabs: [make([home])], active: 0 }, closed }
  const kept = tabs.findIndex((tab) => tab.id === shownTab(state)?.id)
  const active = kept === -1 ? Math.min(closed.at(0)?.index ?? 0, tabs.length - 1) : kept
  return { state: { tabs, active }, closed }
}

export const othersOf = (state: State, index: number) =>
  new Set(state.tabs.flatMap((tab, place) => (place === index || tab.pinned ? [] : [tab.id])))

export const rightOf = (state: State, index: number) =>
  new Set(state.tabs.flatMap((tab, place) => (place <= index || tab.pinned ? [] : [tab.id])))

export const reopen = (state: State, entry: Closed): State => {
  const pinned = pinnedCount(state.tabs)
  const place = entry.tab.pinned
    ? Math.min(entry.index, pinned)
    : Math.min(Math.max(entry.index, pinned), state.tabs.length)
  return { tabs: state.tabs.toSpliced(place, 0, entry.tab), active: place }
}

export const duplicate = (state: State, index: number): State => {
  const tab = state.tabs.at(index)
  if (!tab) return state
  const place = tab.pinned ? pinnedCount(state.tabs) : index + 1
  return { tabs: state.tabs.toSpliced(place, 0, { ...tab, id: crypto.randomUUID(), pinned: undefined }), active: place }
}

// oxlint-disable-next-line ren/no-comments -- Pinned tabs sit first, as icons; pinning moves a tab to the end of them, unpinning to the start of the rest.
export const pin = (state: State, index: number): State => {
  const tab = state.tabs.at(index)
  if (!tab) return state
  const rest = state.tabs.toSpliced(index, 1)
  return keepShown(state, rest.toSpliced(pinnedCount(rest), 0, { ...tab, pinned: tab.pinned ? undefined : true }))
}

export const move = (state: State, from: number, to: number): State => {
  const tab = state.tabs.at(from)
  const target = state.tabs.at(to)
  if (!tab || !target || from === to || Boolean(tab.pinned) !== Boolean(target.pinned)) return state
  return keepShown(state, state.tabs.toSpliced(from, 1).toSpliced(to, 0, tab))
}

// oxlint-disable-next-line ren/no-comments -- Each window keeps its own tabs across reloads; a new window starts from the tabs used last.
const windowKey = "shell.window-tabs.v1"
const lastKey = "shell.window-tabs.last.v1"

const codec = Schema.fromJsonString(State)
const decode = Schema.decodeUnknownOption(codec)
const encode = Schema.encodeSync(codec)

export type Stores = Pick<Platform.Info, "storage" | "windowStorage">

const listeners = new Set<() => void>()

let cached: { readonly raw: string | undefined; readonly value: State } | undefined

const stored = (stores: Stores) => {
  const own = stores.windowStorage?.get(windowKey)
  if (own !== undefined) return own
  const last = stores.storage.get(lastKey)
  if (last !== undefined) stores.windowStorage?.set(windowKey, last)
  return last
}

export const read = (stores: Stores): State => {
  const raw = stored(stores)
  if (cached === undefined || cached.raw !== raw) cached = { raw, value: Option.getOrElse(decode(raw), () => empty) }
  return cached.value
}

export const write = (stores: Stores, next: State) => {
  if (next === read(stores)) return
  const raw = encode(next)
  stores.windowStorage?.set(windowKey, raw)
  stores.storage.set(lastKey, raw)
  for (const listener of listeners) listener()
}

export const update = (stores: Stores, change: (current: State) => State) => write(stores, change(read(stores)))

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTabs() {
  const platform = Platform.usePlatform()
  return useSyncExternalStore(subscribe, () => read(platform))
}
