export * as ChatKeys from "./chat-keys.js"

export const toggleShell = (event: KeyboardEvent) =>
  event.key.toLowerCase() === "x" && event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey
