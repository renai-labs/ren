export * as Release from "./release.js"

import pkg from "../package.json"

declare const REN_CLI_VERSION: string | undefined
declare const REN_CLI_API_URL: string | undefined
declare const REN_CLI_RELEASE_HOST: string | undefined

export const compiled = typeof REN_CLI_VERSION === "string"

export const version = typeof REN_CLI_VERSION === "string" ? REN_CLI_VERSION : pkg.version

export const apiUrl = typeof REN_CLI_API_URL === "string" ? REN_CLI_API_URL : "http://localhost:4000"

export const host = typeof REN_CLI_RELEASE_HOST === "string" ? REN_CLI_RELEASE_HOST : "https://useren.ai"
