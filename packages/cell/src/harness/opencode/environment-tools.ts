export * as OpenCodeEnvironmentTools from "./environment-tools.js"

// oxlint-disable-next-line ren/no-comments -- The OpenCode tools that reach a session's environment. Before each, the references and the loaded skills are on it (R17).
export const names: ReadonlyArray<string> = ["read", "write", "edit", "patch", "glob", "grep", "shell"]
