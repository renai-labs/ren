export * as Version from "./version.js"

import pkg from "../package.json"

declare const REN2_VERSION: string | undefined

export const value = typeof REN2_VERSION === "string" ? REN2_VERSION : pkg.version
