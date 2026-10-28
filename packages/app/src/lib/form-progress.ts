export * as FormProgress from "./form-progress.js"

export interface Progress {
  readonly item: string | undefined
  readonly answers: Readonly<Record<string, ReadonlyArray<string>>>
  readonly custom: Readonly<Record<string, string>>
}

export const empty: Progress = { item: undefined, answers: {}, custom: {} }

const limit = 50

const saved = new Map<string, Progress>()

export const read = (formID: string) => saved.get(formID)

export const write = (formID: string, progress: Progress) => {
  saved.delete(formID)
  saved.set(formID, progress)
  if (saved.size > limit) saved.delete(saved.keys().next().value ?? formID)
}

export const clear = (formID: string) => saved.delete(formID)

export const reset = () => saved.clear()
