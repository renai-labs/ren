export * as Release from "./release.js"

import pkg from "../package.json"

declare const REN2_VERSION: string | undefined
declare const REN2_API_URL: string | undefined
declare const REN2_RELEASE_HOST: string | undefined

export const compiled = typeof REN2_VERSION === "string"

export const version = typeof REN2_VERSION === "string" ? REN2_VERSION : pkg.version

export const apiUrl = typeof REN2_API_URL === "string" ? REN2_API_URL : "http://localhost:4000"

export const host = typeof REN2_RELEASE_HOST === "string" ? REN2_RELEASE_HOST : "https://v2.useren.ai"
