export * as FileTabs from "./file-tabs.js"

export interface Tab {
  readonly path: string
  readonly preview: boolean
  readonly line?: number
}

export interface State {
  readonly tabs: ReadonlyArray<Tab>
  readonly active: string | undefined
}

export const limit = 10

export const empty: State = { tabs: [], active: undefined }

export const open = (
  state: State,
  path: string,
  options?: { readonly pin?: boolean; readonly line?: number },
): State => {
  const pin = options?.pin ?? false
  const line = options?.line
  const existing = state.tabs.find((tab) => tab.path === path)
  if (existing)
    return {
      tabs: state.tabs.map((tab) =>
        tab.path === path ? { path, preview: tab.preview && !pin, ...(line ? { line } : {}) } : tab,
      ),
      active: path,
    }
  const next: Tab = { path, preview: !pin, ...(line ? { line } : {}) }
  const replaced = pin ? -1 : state.tabs.findIndex((tab) => tab.preview)
  if (replaced >= 0) return { tabs: state.tabs.map((tab, index) => (index === replaced ? next : tab)), active: path }
  const added = [...state.tabs, next]
  if (added.length <= limit) return { tabs: added, active: path }
  const dropped = added.slice(0, -1)
  const oldest = dropped.find((tab) => tab.preview) ?? dropped.at(0)
  return { tabs: added.filter((tab) => tab !== oldest), active: path }
}

export const pin = (state: State, path: string): State => ({
  ...state,
  tabs: state.tabs.map((tab) => (tab.path === path ? { path, preview: false } : tab)),
})

export const close = (state: State, path: string): State => {
  const index = state.tabs.findIndex((tab) => tab.path === path)
  if (index < 0) return state
  const tabs = state.tabs.filter((tab) => tab.path !== path)
  return { tabs, active: state.active === path ? tabs[Math.min(index, tabs.length - 1)]?.path : state.active }
}
