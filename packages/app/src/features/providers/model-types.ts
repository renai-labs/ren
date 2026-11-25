export * as ModelTypes from "./model-types.js"

// oxlint-disable-next-line ren/no-comments -- The model types a provider can offer (`Models.Type`), in the order the pages show them.
export const labels: ReadonlyArray<readonly [string, string]> = [
  ["chat", "Chat"],
  ["image", "Image"],
  ["speech", "Voice"],
  ["transcription", "Transcription"],
  ["realtime", "Realtime"],
  ["video", "Video"],
  ["decision", "Decisions"],
]

export const labelOf = (type: string) => labels.find((each) => each[0] === type)?.[1] ?? type

export const total = (counts: Readonly<Record<string, number>>) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0)

export const countText = (count: number) => (count === 1 ? "1 model" : `${count} models`)

// oxlint-disable-next-line ren/no-comments -- "Chat 287 · Image 2": the types a provider has, in page order.
export const summary = (counts: Readonly<Record<string, number>>) =>
  labels.flatMap((each) => ((counts[each[0]] ?? 0) > 0 ? [`${each[1]} ${counts[each[0]]}`] : [])).join(" · ")
