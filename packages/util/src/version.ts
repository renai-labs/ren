export * as Version from "./version.js"

declare const REN_VERSION: string | undefined

export const current = typeof REN_VERSION === "string" ? REN_VERSION : "local"
