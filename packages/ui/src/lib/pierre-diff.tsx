import { type ReactNode, useCallback, useMemo, useSyncExternalStore } from "react"
// ast-grep-ignore: no-import-alias -- the React Virtualizer component below has the same name
import { Virtualizer as WindowVirtualizer } from "@pierre/diffs"
import { MultiFileDiff, PatchDiff, Virtualizer, VirtualizerContext, WorkerPoolContext } from "@pierre/diffs/react"
import { getOrCreateWorkerPoolSingleton, terminateWorkerPoolSingleton } from "@pierre/diffs/worker"
import type { WorkerPoolManager } from "@pierre/diffs/worker"
// oxlint-disable-next-line import/default -- Vite returns the worker script URL as the default export
import workerUrl from "@pierre/diffs/worker/worker.js?worker&url"

export type Source =
  | { readonly kind: "contents"; readonly before: string; readonly after: string; readonly cacheKey: string }
  | { readonly kind: "patch"; readonly patch: string }

const longLine = 1000

const theme = { dark: "pierre-dark", light: "pierre-light" } as const

const css = `
* { --diffs-bg: var(--background) !important; }
[data-diff] {
  --diffs-bg-addition-emphasis-override: var(--diff-addition-word);
  --diffs-bg-deletion-emphasis-override: var(--diff-deletion-word);
  --diffs-font-family: var(--font-mono);
}
`

const shared = {
  theme,
  diffStyle: "unified",
  diffIndicators: "bars",
  lineDiffType: "word-line",
  maxLineDiffLength: longLine,
  tokenizeMaxLineLength: longLine,
  overflow: "wrap",
  disableFileHeader: true,
  expansionLineCount: 20,
  unsafeCSS: css,
} as const

let pool: WorkerPoolManager | undefined
let holders = 0
const listeners = new Set<() => void>()

const setPool = (next: WorkerPoolManager | undefined) => {
  pool = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

const currentPool = () => pool

export function retainWorkers() {
  if (typeof Worker === "undefined") return () => undefined
  holders += 1
  setPool(
    getOrCreateWorkerPoolSingleton({
      poolOptions: { workerFactory: () => new Worker(workerUrl, { type: "module" }), poolSize: 2 },
      highlighterOptions: {
        theme,
        lineDiffType: "word-line",
        maxLineDiffLength: longLine,
        tokenizeMaxLineLength: longLine,
      },
    }),
  )
  let released = false
  return () => {
    if (released) return
    released = true
    holders -= 1
    if (holders > 0) return
    setPool(undefined)
    terminateWorkerPoolSingleton()
  }
}

const scrollable = (value: string) => value === "auto" || value === "scroll" || value === "overlay"

function InheritedWindow(props: { children: ReactNode }) {
  const virtualizer = useMemo(() => (typeof window === "undefined" ? undefined : new WindowVirtualizer()), [])
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        virtualizer?.cleanUp()
        return
      }
      let root = node.parentElement
      while (root && !scrollable(getComputedStyle(root).overflowY)) root = root.parentElement
      virtualizer?.setup(root ?? document)
    },
    [virtualizer],
  )
  return (
    <VirtualizerContext.Provider value={virtualizer}>
      <div ref={ref}>{props.children}</div>
    </VirtualizerContext.Provider>
  )
}

function Windowed(props: { capped: boolean; windowed: boolean; children: ReactNode }) {
  if (props.windowed && props.capped)
    return <Virtualizer className="max-h-120 overflow-auto overscroll-contain">{props.children}</Virtualizer>
  if (props.windowed) return <InheritedWindow>{props.children}</InheritedWindow>
  if (props.capped) return <div className="max-h-120 overflow-y-auto overscroll-contain">{props.children}</div>
  return props.children
}

const contents = (path: string, source: Extract<Source, { kind: "contents" }>) => {
  const oldFile = { name: path, contents: source.before, cacheKey: `${source.cacheKey}:before` }
  const newFile = { name: path, contents: source.after, cacheKey: `${source.cacheKey}:after` }
  if (!source.before) return { oldFile: null, newFile }
  return source.after ? { oldFile, newFile } : { oldFile, newFile: null }
}

export function PierreDiff(props: {
  path: string
  source: Source
  theme: "system" | "light" | "dark"
  capped: boolean
  windowed: boolean
}) {
  const source = props.source
  const workers = useSyncExternalStore(subscribe, currentPool, () => undefined)
  const className = "bg-transparent!"
  const options = { ...shared, themeType: props.theme }
  const diff =
    source.kind === "patch" ? (
      <PatchDiff className={className} patch={source.patch} options={{ ...options, hunkSeparators: "simple" }} />
    ) : (
      <MultiFileDiff
        className={className}
        {...contents(props.path, source)}
        options={{ ...options, hunkSeparators: "line-info-basic" }}
      />
    )
  return (
    <WorkerPoolContext.Provider value={workers}>
      <Windowed capped={props.capped} windowed={props.windowed}>
        {diff}
      </Windowed>
    </WorkerPoolContext.Provider>
  )
}
