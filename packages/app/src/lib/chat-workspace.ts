export * as ChatWorkspace from "./chat-workspace.js"

import { useEffect, useEffectEvent } from "react"
import { Schema } from "effect"
import { Platform } from "../platform/platform.js"
import { Preference } from "./preference.js"

export const Kind = Schema.Literals(["computer", "browser", "files", "changes", "activity", "terminal"])

const Tab = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  label: Schema.String,
  file: Schema.optional(
    Schema.Struct({ path: Schema.String, preview: Schema.Boolean, line: Schema.optional(Schema.Number) }),
  ),
})

const Chosen = Schema.Union([Schema.Struct({ project: Schema.String }), Schema.Struct({ file: Schema.String })])

export const Panel = Schema.Struct({
  tabs: Schema.Array(Tab),
  active: Schema.optional(Schema.String),
  expanded: Schema.Array(Schema.String),
  chosen: Schema.optional(Chosen),
})

export type Panel = typeof Panel.Type

const State = Schema.Struct({ open: Schema.Boolean, maximized: Schema.Boolean, panel: Panel })

type State = typeof State.Type

const empty: State = { open: false, maximized: false, panel: { tabs: [], expanded: [] } }

const kept = 50

// oxlint-disable-next-line ren/no-comments -- Each chat keeps its workspace panel across reloads: whether it is open or maximized, its tabs, its open folders and its project. The app keeps this for the 50 chats used last.
const memory = Preference.make(
  "chat.workspace.v1",
  Schema.Array(Schema.Struct({ id: Schema.String, state: State })),
  [],
)

const stateOf = (all: ReadonlyArray<{ readonly id: string; readonly state: State }>, id: string) =>
  all.find((entry) => entry.id === id)?.state ?? empty

const update = (storage: Platform.Storage, id: string, change: (state: State) => State) => {
  const all = memory.read(storage)
  memory.write(
    storage,
    [{ id, state: change(stateOf(all, id)) }, ...all.filter((entry) => entry.id !== id)].slice(0, kept),
  )
}

export function useWorkspace(id: string) {
  const storage = Platform.usePlatform().storage
  const state = stateOf(Preference.usePreference(memory), id)
  return {
    open: state.open,
    maximized: state.maximized,
    panel: state.panel,
    setOpen: (open: boolean) => update(storage, id, (current) => ({ ...current, open })),
    setMaximized: (maximized: boolean) => update(storage, id, (current) => ({ ...current, maximized })),
  }
}

type Chosen = typeof Chosen.Type

export function useSavePanel(
  id: string,
  open: {
    readonly tabs: ReadonlyArray<{
      readonly id: string
      readonly kind: typeof Kind.Type
      readonly label: string
      readonly file?: {
        readonly path: string
        readonly preview: boolean
        readonly line?: number | undefined
        readonly drive?: unknown
      }
    }>
    readonly active: { readonly id: string } | undefined
    readonly expanded: ReadonlyArray<string>
    readonly chosen: Chosen | undefined
  },
) {
  const storage = Platform.usePlatform().storage
  const panel: Panel = {
    tabs: open.tabs.flatMap((tab) =>
      tab.file?.drive
        ? []
        : [
            {
              id: tab.id,
              kind: tab.kind,
              label: tab.label,
              ...(tab.file && {
                file: { path: tab.file.path, preview: tab.file.preview, ...(tab.file.line && { line: tab.file.line }) },
              }),
            },
          ],
    ),
    ...(open.active && { active: open.active.id }),
    expanded: open.expanded,
    ...(open.chosen && { chosen: open.chosen }),
  }
  const save = useEffectEvent(() => update(storage, id, (current) => ({ ...current, panel })))
  const encoded = JSON.stringify(panel)
  useEffect(() => {
    save()
  }, [id, encoded])
}
