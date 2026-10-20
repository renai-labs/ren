export * as SessionTitle from "./session-title.js"

export const untitled = "New chat"

const placeholder = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function display(title: string | null | undefined, fallback: string) {
  if (!title || placeholder.test(title)) return fallback
  return title
}
