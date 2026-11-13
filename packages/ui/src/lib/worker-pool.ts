import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker"
// oxlint-disable-next-line import/default -- Vite returns the worker script URL as the default export
import workerUrl from "@pierre/diffs/worker/worker.js?worker&url"

export const longLine = 1000

export const theme = { dark: "pierre-dark", light: "pierre-light" } as const

export const workerPool = () =>
  typeof window === "undefined" || typeof Worker === "undefined"
    ? undefined
    : getOrCreateWorkerPoolSingleton({
        poolOptions: { workerFactory: () => new Worker(workerUrl, { type: "module" }), poolSize: 2 },
        highlighterOptions: {
          theme,
          lineDiffType: "word-line",
          maxLineDiffLength: longLine,
          tokenizeMaxLineLength: longLine,
        },
      })
